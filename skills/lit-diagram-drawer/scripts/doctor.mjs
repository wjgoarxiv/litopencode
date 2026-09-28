#!/usr/bin/env node
import { inspectDiagramCapabilities } from './capability-probe.mjs';

const outputIndex = process.argv.indexOf('--out');
const writeDirectory = outputIndex >= 0 && process.argv[outputIndex + 1] ? process.argv[outputIndex + 1] : process.cwd();
const report = inspectDiagramCapabilities({ writeDirectory });
process.stdout.write(`${JSON.stringify({ ready: report.ready, checks: report.checks }, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;
