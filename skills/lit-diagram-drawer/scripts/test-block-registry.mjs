#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildBlockRegistry } from './block-registry.mjs';

const source='<svg><rect data-block-id="root" data-block-name="Request &amp; policy" data-block-input="raw request" data-block-output="decision" data-block-constraint="deny by default" data-block-assumption="authenticated" data-block-impl="src/root.ts"/><rect data-block-id="child" data-block-parent="root" data-block-name="Audit" data-block-impl="src/audit.ts"/></svg>';
const registry=buildBlockRegistry(source,'diagram.html');
assert.deepEqual(registry.blocks.map((block)=>block.id),['root','child']);
assert.equal(registry.source,'diagram.html');
assert.equal(registry.blocks[0].name,'Request & policy');
assert.equal(Object.hasOwn(registry.blocks[0],'parent'),false);
assert.equal(registry.blocks[1].parent,'root');
assert.equal(Object.hasOwn(registry.blocks[1],'input'),false);
const rejects=(fragment,code)=>assert.throws(()=>buildBlockRegistry('<svg>'+fragment+'</svg>','bad.html'),new RegExp(code));
rejects('', 'REGISTRY_BLOCKS_MISSING');
rejects('<rect data-block-id=""/>','REGISTRY_ID_REQUIRED');
rejects('<rect data-block-id="x"/><rect data-block-id="x"/>','REGISTRY_DUPLICATE_ID');
rejects('<rect data-block-id="x" data-block-parent="absent"/>','REGISTRY_PARENT_MISSING');
rejects('<rect data-block-id="x" data-block-parent="y"/><rect data-block-id="y" data-block-parent="x"/>','REGISTRY_CYCLE');
rejects('<rect data-block-id="x"/><rect data-block-id="y"/>','REGISTRY_ROOT_COUNT');
console.log('BLOCK_REGISTRY_PASS ordered projection, omitted fields/root parent, duplicate/missing/cycle/root guards');
