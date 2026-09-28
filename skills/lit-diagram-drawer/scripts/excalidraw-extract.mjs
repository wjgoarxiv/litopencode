#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanLabel, cli, digest, MAX_DEPTH, MAX_NODES, MAX_RELATIONSHIPS, readBounded, reject, safeId } from './import-shared.mjs';

const MAX_INPUT = 16 * 1024 * 1024;
const MAX_ELEMENTS = 10_000;
const shapes = new Map([['rectangle', 'rectangle'], ['ellipse', 'ellipse'], ['diamond', 'diamond'], ['image', 'image'], ['embeddable', 'embed'], ['iframe', 'embed']]);
const edgeTypes = new Set(['arrow', 'line']);
const frameTypes = new Set(['frame', 'magicframe']);

function checkJsonDepth(text) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '[' || character === '{') {
      depth += 1;
      if (depth > MAX_DEPTH) reject('scene nesting exceeds the depth limit (64)');
    } else if (character === ']' || character === '}') {
      depth -= 1;
      if (depth < 0) reject('scene has malformed JSON nesting');
    }
  }
  if (quoted || depth !== 0) reject('scene has malformed JSON nesting');
}

function extract(file) {
  const filename = path.basename(file);
  const name = filename.toLowerCase();
  if (!name.endsWith('.excalidraw') && !name.endsWith('.excalidraw.json')) reject('provide a saved .excalidraw scene');
  const data = readBounded(file, MAX_INPUT);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { reject('scene is not valid UTF-8 JSON'); }
  checkJsonDepth(text);
  let document;
  try { document = JSON.parse(text); } catch { reject('scene is malformed JSON'); }
  if (!document || Array.isArray(document) || document.type !== 'excalidraw') reject('input is not an Excalidraw scene');
  if (!Array.isArray(document.elements)) reject('scene has no elements array');
  if (document.elements.length > MAX_ELEMENTS) reject('element limit exceeded (max 10,000)');
  const ids = new Map();
  const used = new Set();
  const live = [];
  const discarded = { styles: 0, links: 0, urls: 0, scripts: 0, assets: 0, unsupportedElements: 0, deletedElements: 0, freehandStrokes: 0, danglingRelationships: 0 };
  const title = cleanLabel(filename.replace(/\.excalidraw(?:\.json)?$/iu, ''));
  discarded.urls += title.urls;
  for (const element of document.elements) {
    if (!element || Array.isArray(element) || typeof element !== 'object') reject('scene element must be an object');
    if (typeof element.id !== 'string' || typeof element.type !== 'string') reject('scene elements require string id and type fields');
    if (ids.has(element.id)) reject('scene contains duplicate element ids');
    ids.set(element.id, safeId(element.id, used));
    for (const key of ['x', 'y', 'width', 'height']) {
      const value = element[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) reject(`element geometry field ${key} must be finite numeric data`);
      if (Math.abs(value) > 10_000_000) reject(`element geometry field ${key} is outside the supported range`);
    }
    if (element.isDeleted === true) discarded.deletedElements += 1;
    else live.push(element);
  }
  const frameIds = new Set(live.filter((element) => frameTypes.has(element.type)).map((element) => element.id));
  const labels = new Map();
  for (const element of live) {
    if (element.type !== 'text') continue;
    if (element.text !== undefined && typeof element.text !== 'string') reject('text element content must be a string');
    const cleaned = cleanLabel(element.text ?? '');
    discarded.urls += cleaned.urls;
    if (typeof element.containerId === 'string' && ids.has(element.containerId) && cleaned.text) {
      labels.set(element.containerId, [...(labels.get(element.containerId) ?? []), cleaned.text]);
    }
  }
  const nodeIds = new Set();
  const nodes = [];
  for (const element of live) {
    if (edgeTypes.has(element.type) || (element.type === 'text' && typeof element.containerId === 'string')) continue;
    if (['selection', 'laser'].includes(element.type)) continue;
    if (element.type === 'freedraw') { discarded.freehandStrokes += 1; continue; }
    let shape;
    let kind;
    let label;
    if (frameTypes.has(element.type)) {
      shape = 'container'; kind = 'container'; label = typeof element.name === 'string' ? element.name : '';
    } else if (element.type === 'text') {
      shape = 'text'; kind = 'annotation'; label = typeof element.text === 'string' ? element.text : '';
    } else if (shapes.has(element.type)) {
      shape = shapes.get(element.type); kind = 'component'; label = '';
      if (['image', 'embeddable', 'iframe'].includes(element.type)) discarded.assets += 1;
    } else { discarded.unsupportedElements += 1; continue; }
    const cleaned = cleanLabel(label);
    discarded.urls += cleaned.urls;
    label = labels.get(element.id)?.join('\n').slice(0, 2_000) ?? cleaned.text;
    discarded.links += Number(typeof element.link === 'string' && element.link.length > 0);
    if (nodes.length >= MAX_NODES) reject('node limit exceeded (max 2,000)');
    const node = { id: ids.get(element.id), label, kind, shape };
    if (typeof element.frameId === 'string' && frameIds.has(element.frameId)) node.parentId = ids.get(element.frameId);
    nodes.push(node);
    nodeIds.add(element.id);
    discarded.styles += Number(['backgroundColor', 'strokeColor', 'strokeStyle', 'roughness'].some((key) => key in element));
  }
  const relationships = [];
  for (const element of live.filter((item) => edgeTypes.has(item.type))) {
    const from = element.startBinding?.elementId;
    const to = element.endBinding?.elementId;
    if (typeof from !== 'string' || typeof to !== 'string' || !nodeIds.has(from) || !nodeIds.has(to)) {
      discarded.danglingRelationships += 1;
      continue;
    }
    if (relationships.length >= MAX_RELATIONSHIPS) reject('relationship limit exceeded (max 5,000)');
    const cleaned = cleanLabel((labels.get(element.id) ?? []).join('\n'));
    discarded.urls += cleaned.urls;
    const start = typeof element.startArrowhead === 'string' && !['', 'none'].includes(element.startArrowhead);
    const end = typeof element.endArrowhead === 'string' && !['', 'none'].includes(element.endArrowhead);
    relationships.push({ from: ids.get(from), to: ids.get(to), label: cleaned.text, kind: element.type === 'arrow' ? 'flow' : 'association', direction: start && end ? 'both' : start ? 'reverse' : end || element.type === 'arrow' ? 'forward' : 'none' });
  }
  const groups = [];
  for (const frameId of [...frameIds].sort()) {
    const members = live.filter((element) => element.frameId === frameId && nodeIds.has(element.id));
    if (members.length) groups.push({ id: ids.get(frameId), label: nodes.find((node) => node.id === ids.get(frameId))?.label ?? 'Frame', nodeIds: members.map((item) => ids.get(item.id)) });
  }
  const sourceGroups = new Map();
  for (const element of live) {
    if (!nodeIds.has(element.id) || !Array.isArray(element.groupIds)) continue;
    for (const groupId of element.groupIds.slice(0, MAX_DEPTH)) {
      if (typeof groupId !== 'string') continue;
      if (!sourceGroups.has(groupId) && sourceGroups.size >= MAX_NODES) reject('group limit exceeded (max 2,000)');
      sourceGroups.set(groupId, [...(sourceGroups.get(groupId) ?? []), element.id]);
    }
  }
  for (const [groupId, members] of sourceGroups) {
    const id = `g-${digest(Buffer.from(groupId)).slice(0, 16)}`;
    if (used.has(id)) reject('group id collides with an element id');
    groups.push({ id, label: 'Group', nodeIds: members.map((item) => ids.get(item)) });
  }
  if (document.files && typeof document.files === 'object' && !Array.isArray(document.files)) discarded.assets += Object.keys(document.files).length;
  if (!nodes.length) reject('scene contains no supported diagram elements');
  return { schemaVersion: 1, sourceFormat: 'excalidraw', sourceDigest: digest(data), title: title.text || 'Imported diagram', suggestedType: relationships.length ? 'flowchart' : 'architecture', nodes, relationships, groups, discarded, warnings: ['Source coordinates and styling are omitted; imported labels are inert data.'] };
}

function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!file) reject('Usage: node scripts/excalidraw-extract.mjs <file.excalidraw>');
  return extract(file);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = cli(main, 'excalidraw-extract');
