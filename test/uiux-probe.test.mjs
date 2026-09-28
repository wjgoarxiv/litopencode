import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('skills/frontend-ui-ux/scripts/probe.mjs');
const fixture = (name) => resolve('test/fixtures/uiux-probe', name);
const runProbe = (args, env = process.env) => {
  const out = mkdtempSync(join(tmpdir(), 'litopencode-uiux-'));
  const run = spawnSync(process.execPath, [script, ...args, '--out', out], { encoding: 'utf8', timeout: 120000, env });
  const result = JSON.parse(readFileSync(join(out, 'probe.json'), 'utf8'));
  rmSync(out, { recursive: true, force: true });
  return { run, result };
};

test('UI probe static fallback reports static defects and leaves rendered rules unverified', () => {
  const { run, result } = runProbe(['--static-only', '--path', fixture('sloppy.html')]);
  assert.equal(run.status, 2);
  assert.equal(result.manifest.exit_code, 2);
  assert.equal(result.manifest.url, null);
  assert.equal(result.manifest.browser_version, null);
  assert.ok(result.findings.some((finding) => finding.rule === 'SLOP-058'));
  assert.ok(result.findings.some((finding) => finding.rule === 'CF-503'));
  assert.ok(result.findings.every((finding) => finding.viewport === 'static' && finding.tier === 'derived' && /^(CF|RS|SLOP)-\d{3}$/u.test(finding.rule)));
  assert.ok(result.manifest.not_verified.some((entry) => entry.rule === 'CF-201'));
});

test('UI probe preserves a BLOCKED receipt and static findings when the browser command is absent', () => {
  const { run, result } = runProbe(['--path', fixture('sloppy.html')], { ...process.env, PATH: '/nonexistent-uiux-browser-path' });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /BLOCKED: browser unavailable/);
  assert.equal(result.manifest.exit_code, 2);
  assert.equal(result.manifest.screenshots.length, 0);
  assert.ok(result.findings.some((finding) => finding.rule === 'SLOP-058'));
  assert.ok(result.manifest.not_verified.some((entry) => entry.rule === 'RS-006'));
});

test('UI probe browser fixtures separate broken and clean pages', (t) => {
  const capability = spawnSync(process.execPath, [resolve('skills/browser-drive/scripts/capability-probe.mjs')], { encoding: 'utf8' });
  if (capability.status !== 0 || JSON.parse(capability.stdout).status !== 'available') {
    t.skip('agent-browser is unavailable');
    return;
  }
  const clean = runProbe(['--path', fixture('clean.html')]);
  if (clean.run.status === 2) { t.skip(`agent-browser could not open the fixture: ${clean.result.manifest.blocked_reason}`); return; }
  assert.equal(clean.run.status, 0);
  assert.equal(clean.result.findings.filter((finding) => finding.severity === 'HIGH').length, 0);
  assert.equal(clean.result.manifest.screenshots.length, 7);
  assert.deepEqual(clean.result.manifest.viewports_run, ['320', '390', '768', '1440', '390-dark', '390-reduced-motion', '1440-zoom200']);
  const sloppy = runProbe(['--path', fixture('sloppy.html')]);
  assert.equal(sloppy.run.status, 1);
  for (const rule of ['RS-006', 'RS-007', 'CF-201', 'CF-701', 'CF-503', 'SLOP-058']) {
    assert.ok(sloppy.result.findings.some((finding) => finding.rule === rule), `${rule} missing`);
  }
  assert.ok(sloppy.result.findings.filter((finding) => finding.rule === 'CF-503').every((finding) => finding.severity !== 'HIGH'));
  assert.ok(sloppy.result.findings.filter((finding) => finding.rule.startsWith('SLOP-') && finding.severity === 'HIGH').every((finding) => ['SLOP-057', 'SLOP-058', 'SLOP-059'].includes(finding.rule)));
});

test('UI probe completes the matrix under a long TMPDIR without a caller socket override', (t) => {
  const capability = spawnSync(process.execPath, [resolve('skills/browser-drive/scripts/capability-probe.mjs')], { encoding: 'utf8' });
  if (capability.status !== 0 || JSON.parse(capability.stdout).status !== 'available') {
    t.skip('agent-browser is unavailable');
    return;
  }
  const root = mkdtempSync(join(tmpdir(), 'litopencode-uiux-long-'));
  const longTmp = join(root, 'nested-temporary-directory'.repeat(5));
  mkdirSync(longTmp, { recursive: true });
  assert.ok(Buffer.byteLength(longTmp) > 103);
  try {
    const env = {
      ...process.env,
      TMPDIR: longTmp,
      HOME: longTmp,
      XDG_CONFIG_HOME: longTmp,
      XDG_DATA_HOME: longTmp,
      XDG_CACHE_HOME: longTmp,
      XDG_STATE_HOME: longTmp,
      XDG_RUNTIME_DIR: longTmp,
    };
    delete env.AGENT_BROWSER_SOCKET_DIR;
    const { run, result } = runProbe(['--path', fixture('clean.html')], env);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${result.manifest.not_verified[0]?.reason ?? result.manifest.blocked_reason}`);
    assert.equal(result.manifest.exit_code, 0);
    assert.equal(result.manifest.viewports_run.length, 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('packaged files do not match either read-only reference hash inventory', () => {
  const forbidden = JSON.parse(readFileSync(resolve('test/fixtures/uiux-forbidden-hashes.json'), 'utf8'));
  assert.equal(forbidden.length, 111);
  for (const row of forbidden) {
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(row.path && row.source);
  }
  const hashes = new Map(forbidden.map((row) => [row.sha256, row]));
  const pack = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
  for (const file of pack[0].files) {
    const digest = createHash('sha256').update(readFileSync(resolve(file.path))).digest('hex');
    const source = hashes.get(digest);
    assert.equal(source, undefined, `${file.path} matches ${source?.source}:${source?.path}`);
  }
});

test('the installed design notice credits each studied rule source', () => {
  const notice = readFileSync(resolve('skills/frontend-ui-ux/data/THIRD-PARTY-NOTICE.txt'), 'utf8');
  for (const token of ['pbakaus/impeccable', 'Paul Bakaus', 'Apache', '9d715cc', 'jakubkrehel/skills', 'Jakub Krehel', 'MIT', '267330e', 'ibelick/ui-skills', 'Julien Thibeaut']) {
    assert.ok(notice.includes(token), `missing credit anchor: ${token}`);
  }
});
