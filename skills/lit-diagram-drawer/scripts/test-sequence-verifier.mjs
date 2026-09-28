import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeFile } from './diagram-metrics.mjs';

const verifier=fileURLToPath(new URL('./verify-type.mjs',import.meta.url));
const base='<main data-type="sequence-oauth" data-variant="light"><svg id="diagram-sequence-oauth-light" viewBox="0 0 400 240"><rect x="60" y="60" width="80" height="48" data-node-id="A"/><rect x="160" y="60" width="80" height="48" data-node-id="Mid"/><rect x="260" y="60" width="80" height="48" data-node-id="B"/><path d="M100 140 H300" data-from="A" data-to="B"/><path d="M300 180 H100" data-from="B" data-to="A"/></svg></main>';
const lifelines='<line x1="100" y1="108" x2="100" y2="180" stroke-dasharray="5 5" data-lifeline-for="A"/><line x1="200" y1="108" x2="200" y2="180" stroke-dasharray="5 5" data-lifeline-for="Mid"/><line x1="300" y1="108" x2="300" y2="180" stroke-dasharray="5 5" data-lifeline-for="B"/>';
const run=(source,{measure=false}={})=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lit-sequence-verifier-'));
  try{
    const file=path.join(dir,'fixture.html');fs.writeFileSync(file,source);
    return {result:spawnSync(process.execPath,[verifier,'--type=sequence-oauth',file],{encoding:'utf8'}),metrics:measure?analyzeFile(file):null};
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
};
const missing=run(base).result;
assert.notEqual(missing.status,0,'sequence verifier rejects missing lifelines');
assert.match(missing.stderr,/SEQUENCE_LIFELINE_MISSING/,'missing lifeline finding is reported');
const valid=run(base.replace('</svg>',lifelines+'</svg>'),{measure:true});
assert.equal(valid.result.status,0,valid.result.stderr||'lifelines aligned to boxes and ordered message endpoints pass');
assert.equal(valid.metrics.arrowCrossings,0,'lifeline intersections are intentional and excluded from arrow-crossing count');
const outOfOrder=run(base.replace('<path d="M100 140 H300" data-from="A" data-to="B"/><path d="M300 180 H100" data-from="B" data-to="A"/>','<path d="M100 180 H300" data-from="A" data-to="B"/><path d="M300 140 H100" data-from="B" data-to="A"/>').replace('</svg>',lifelines+'</svg>')).result;
assert.notEqual(outOfOrder.status,0,'sequence verifier rejects messages that are not top-to-bottom');
assert.match(outOfOrder.stderr,/SEQUENCE_MESSAGE_ORDER/,'message order finding is reported');
console.log('SEQUENCE_VERIFIER_FIXTURES_PASS missing-lifeline endpoints-and-order');
