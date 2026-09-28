#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { root } from './diagram-metrics.mjs';
import { checkBrief, readBrief } from './brief-contract.mjs';

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

const briefPath = option('--brief');
const diagramPath = option('--diagram');
if (args.includes('--brief') || args.includes('--diagram')) {
  if (!briefPath || !diagramPath || args.some((arg, index) => ['--brief', '--diagram'].includes(arg) && !args[index + 1])) {
    console.error('Usage: node scripts/verify-brief.mjs [--brief <brief.md> --diagram <diagram.html>]');
    process.exit(2);
  }
  try {
    const result = checkBrief(fs.readFileSync(path.resolve(diagramPath), 'utf8'), readBrief(path.resolve(briefPath)));
    const failed = result.missingNodes?.length || result.missingLabels?.length || result.missingEdges?.length
      || result.unpairedLabels?.length || result.languageMismatches?.length || result.boundaryMembership?.issues?.length;
    process.stdout.write(`${JSON.stringify({ mode: 'brief', brief: path.resolve(briefPath), diagram: path.resolve(diagramPath), result }, null, 2)}\n`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(`BRIEF_VERIFY_ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
} else {
  const folders = fs.readdirSync(path.join(root, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const results = [];
  for (const folder of folders) {
    const brief = path.join(root, 'examples', folder, 'brief.md');
    const after = path.join(root, 'examples', folder, 'after.html');
    if (!fs.existsSync(brief) || !fs.existsSync(after)) {
      results.push({ example: folder, missingFiles: [!fs.existsSync(brief) ? 'brief.md' : null, !fs.existsSync(after) ? 'after.html' : null].filter(Boolean) });
      continue;
    }
    results.push({ example: folder, ...checkBrief(fs.readFileSync(after, 'utf8'), readBrief(brief)) });
  }
  const failures = results.filter((result) => result.missingFiles || result.missingNodes?.length || result.missingLabels?.length
    || result.missingEdges?.length || result.unpairedLabels?.length || result.languageMismatches?.length || result.boundaryMembership?.issues?.length);
  process.stdout.write(`${JSON.stringify({ mode: 'examples', checked: results.length, failures, results }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}
