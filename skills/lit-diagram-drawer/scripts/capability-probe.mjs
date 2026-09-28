#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let browserTools;
try { browserTools = await import('../../browser-drive/scripts/capability-probe.mjs'); } catch { browserTools = undefined; }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const minimum = [0, 38, 1];

function versionParts(value) {
  const match = /^agent-browser ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(value ?? '');
  return match?.[1].split('.').map(Number) ?? null;
}

function meetsMinimum(parts) {
  if (!parts) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
  }
  return true;
}

function run(command, args) {
  return browserTools?.runCommandSync?.(command, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 })
    ?? spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 });
}

function isRegularFile(file) {
  try { return fs.lstatSync(file).isFile(); } catch { return false; }
}

function probeWriteAccess(requestedDirectory = process.cwd()) {
  const target = path.resolve(requestedDirectory);
  let directory = target;
  try {
    while (!fs.existsSync(directory) && path.dirname(directory) !== directory) directory = path.dirname(directory);
    if (!fs.statSync(directory).isDirectory()) throw new Error('nearest existing path is not a directory');
    const probe = fs.mkdtempSync(path.join(directory, '.lit-diagram-write-check-'));
    try { fs.writeFileSync(path.join(probe, 'probe.tmp'), '', { flag: 'wx' }); }
    finally { fs.rmSync(probe, { recursive: true, force: true }); }
    return { status: 'pass', detail: directory === target ? `write access verified for ${target}` : `write access verified at nearest existing parent ${directory}` };
  } catch (error) {
    return { status: 'fail', detail: `write access unavailable for ${target}: ${error.message}` };
  }
}

export function runDiagramCommand(command, args, options = {}) {
  return browserTools?.runCommandSync?.(command, args, options)
    ?? spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024, ...options });
}

export function inspectDiagramCapabilities({ writeDirectory = process.cwd() } = {}) {
  const checks = [];
  const driver = browserTools?.probeBrowserDriver?.() ?? { status: 'unavailable', version: null, command: null, detail: 'browser-drive capability probe is unavailable' };
  const driverParts = versionParts(driver.version);
  const driverReady = driver.status === 'available' && meetsMinimum(driverParts);
  const driverDetail = !driverReady && driver.status === 'available' && driverParts && !meetsMinimum(driverParts)
    ? `agent-browser ${driver.version} is older than required floor 0.38.1`
    : driver.detail;
  checks.push({
    id: 'agent-browser',
    status: driverReady ? 'pass' : 'fail',
    version: driver.version,
    detail: driverReady ? `verified floor 0.38.1 met by ${driver.version}` : driverDetail
  });

  let browserReady = false;
  let browserDetail = 'agent-browser is unavailable';
  if (driverReady && driver.command) {
    const result = run(driver.command, ['doctor', '--json']);
    let output;
    try { output = JSON.parse(result?.stdout ?? ''); } catch { output = null; }
    const chrome = output?.checks?.find((check) => check.id === 'chrome.installed')?.message ?? '';
    browserReady = result?.status === 0 && output?.success === true && /\b154\./u.test(chrome);
    browserDetail = browserReady ? 'Chrome for Testing 154 is available' : 'Chrome for Testing 154 is missing or unverified';
  }
  checks.push({ id: 'chrome-for-testing', status: browserReady ? 'pass' : 'fail', detail: browserDetail });

  const font = path.join(root, 'assets/fonts/PretendardVariable.woff2');
  const provenanceFile = path.join(root, 'assets/fonts/provenance.json');
  let fontValid = false;
  let licenseValid = false;
  try {
    const provenance = JSON.parse(fs.readFileSync(provenanceFile, 'utf8'));
    for (const [file, assign] of [['PretendardVariable.woff2', (valid) => { fontValid = valid; }], ['OFL.txt', (valid) => { licenseValid = valid; }]]) {
      const record = provenance.files?.find((item) => item.file === file);
      const bytes = fs.readFileSync(path.join(root, 'assets/fonts', file));
      assign(typeof record?.sha256 === 'string' && record.bytes === bytes.length
        && createHash('sha256').update(bytes).digest('hex') === record.sha256);
    }
  } catch {
    fontValid = false;
    licenseValid = false;
  }
  checks.push({ id: 'pretendard-font', status: fontValid ? 'pass' : 'fail', detail: fontValid ? 'font matches bundled provenance' : 'font or provenance is missing or altered' });
  checks.push({
    id: 'pretendard-license',
    status: licenseValid ? 'pass' : 'fail',
    detail: licenseValid ? 'OFL file matches bundled provenance' : 'OFL file or provenance is missing, altered, or mismatched'
  });

  const detector = path.resolve(root, '../lit-humanizer/scripts/detect.mjs');
  const rules = path.resolve(root, '../lit-humanizer/rules.json');
  const detectorReady = isRegularFile(detector) && isRegularFile(rules);
  checks.push({ id: 'lit-humanizer-detector', status: detectorReady ? 'pass' : 'fail', detail: detectorReady ? 'local detector and rule set are present' : 'local detector or rule set is missing' });

  const renderer = run('rsvg-convert', ['--version']);
  checks.push({
    id: 'rsvg-convert',
    status: renderer?.status === 0 ? 'pass' : 'optional-missing',
    detail: (renderer?.stdout || renderer?.stderr || 'not found').trim().slice(0, 200)
  });

  const writeAccess = probeWriteAccess(writeDirectory);
  checks.push({ id: 'write-access', ...writeAccess });

  return {
    ready: driverReady && browserReady && fontValid && licenseValid && detectorReady && writeAccess.status === 'pass',
    driverCommand: driverReady ? driver.command : undefined,
    checks
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectDiagramCapabilities();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}
