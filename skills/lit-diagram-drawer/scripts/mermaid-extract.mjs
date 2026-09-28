#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cleanLabel, cli, digest, MAX_DEPTH, MAX_NODES, MAX_RELATIONSHIPS, readBounded, reject, safeId } from './import-shared.mjs';

const MAX_INPUT = 4 * 1024 * 1024;
const headerPattern = /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|erDiagram)\b(.*)$/iu;
const kinds = new Map([['flowchart', 'flowchart'], ['graph', 'flowchart'], ['sequencediagram', 'sequence'], ['statediagram-v2', 'state'], ['erdiagram', 'er']]);

function readBlocks(file) {
  const data = readBounded(file, MAX_INPUT);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { reject('input is not valid UTF-8'); }
  if (['.mmd', '.mermaid'].includes(path.extname(file).toLowerCase())) return { data, blocks: [{ source, line: 1 }] };
  if (!['.md', '.markdown', '.mdown', '.mkd'].includes(path.extname(file).toLowerCase())) reject('provide .mmd, .mermaid, or Markdown');
  const blocks = [];
  let active = false;
  let fence = '';
  let lines = [];
  let firstLine = 0;
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (!active) {
      const match = /^\s*(`{3,}|~{3,})\s*mermaid\s*$/iu.exec(line);
      if (match) { active = true; fence = match[1]; lines = []; firstLine = index + 2; }
    } else if (new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`, 'u').test(line)) {
      blocks.push({ source: lines.join('\n'), line: firstLine });
      active = false;
      fence = '';
    } else lines.push(line);
  }
  if (active) reject(`unterminated Mermaid fence at line ${firstLine - 1}`);
  if (!blocks.length) reject('Markdown contains no fenced Mermaid block');
  return { data, blocks };
}

function extract(file, index = 0) {
  const { data, blocks } = readBlocks(file);
  if (!Number.isInteger(index) || index < 0 || index >= blocks.length) reject(`diagram index out of range (${blocks.length} block(s))`);
  let lines = blocks[index].source.split(/\r?\n/u);
  let firstLine = blocks[index].line;
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex((line) => line.trim() === '---');
    if (end < 0) reject('unterminated Mermaid frontmatter');
    lines = lines.slice(end + 2);
    firstLine += end + 2;
  }
  lines = lines.map((text, i) => ({ line: firstLine + i, text: text.trim() })).filter((item) => item.text && !item.text.startsWith('%%'));
  const declaration = lines.findIndex((item) => headerPattern.test(item.text));
  if (declaration < 0) reject('unsupported or missing Mermaid diagram declaration');
  const header = headerPattern.exec(lines[declaration].text);
  if (!header) reject(`malformed diagram declaration at line ${lines[declaration].line}`);
  const grammar = kinds.get(header[1].toLowerCase());
  if (!grammar) reject(`unsupported Mermaid grammar at line ${lines[declaration].line}`);
  const nodes = new Map();
  const groups = new Map();
  const relations = [];
  const stack = [];
  const fields = new Map();
  const discarded = { styles: 0, links: 0, urls: 0, scripts: 0, directives: 0, unsupportedElements: 0 };
  let title = '';
  let direction = /\b(TD|TB|BT|LR|RL)\b/iu.exec(header[2])?.[1]?.toUpperCase() ?? '';
  let entity;
  function add(id, rawLabel = '', shape = 'rectangle', kind = 'component') {
    if (!nodes.has(id)) {
      if (nodes.size >= MAX_NODES) reject('node limit exceeded (max 2,000)');
      const cleaned = cleanLabel(rawLabel || id);
      discarded.urls += cleaned.urls;
      nodes.set(id, { label: cleaned.text, shape, kind, parent: stack.at(-1) ?? null });
    } else if (rawLabel && nodes.get(id).label === id) {
      const cleaned = cleanLabel(rawLabel);
      discarded.urls += cleaned.urls;
      nodes.set(id, { ...nodes.get(id), label: cleaned.text });
    }
  }
  function connect(from, to, rawLabel, kind, arrow) {
    if (relations.length >= MAX_RELATIONSHIPS) reject('relationship limit exceeded (max 5,000)');
    const cleaned = cleanLabel(rawLabel ?? '');
    discarded.urls += cleaned.urls;
    relations.push({ from, to, label: cleaned.text, kind, direction: arrow });
  }
  for (const { line, text } of lines.slice(declaration + 1)) {
    if (text.startsWith('%%{')) { discarded.directives += 1; continue; }
    if (/^(click|href|link)\b/iu.test(text)) { discarded.links += 1; continue; }
    if (/^(style|classDef|class|linkStyle)\b/iu.test(text)) { discarded.styles += 1; continue; }
    if (text.startsWith('title ')) { const cleaned = cleanLabel(text.slice(6)); title = cleaned.text; discarded.urls += cleaned.urls; continue; }
    if (/^direction\s+/iu.test(text)) {
      direction = text.split(/\s+/u)[1].toUpperCase();
      if (!['TD', 'TB', 'BT', 'LR', 'RL'].includes(direction)) reject(`invalid direction at line ${line}`);
      continue;
    }
    if (grammar === 'flowchart') {
      if (text.toLowerCase() === 'end') { if (!stack.length) reject(`unexpected subgraph end at line ${line}`); stack.pop(); continue; }
      const sub = /^subgraph\s+([\w.-]+)(?:\s*\[([^\]]*)\])?$/iu.exec(text);
      if (sub) {
        const cleaned = cleanLabel(sub[2] || sub[1]);
        discarded.urls += cleaned.urls;
        groups.set(sub[1], cleaned.text);
        add(sub[1], cleaned.text, 'container', 'container');
        stack.push(sub[1]);
        if (stack.length > MAX_DEPTH) reject('subgraph depth exceeds 64');
        continue;
      }
      const edge = /^([\w.-]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?\s*(<-->|<--|-->|---|-\.->|==>|->|--o|--x)\s*(?:\|([^|]*)\|\s*)?([\w.-]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?$/u.exec(text);
      if (edge) {
        const [, from, leftRect, leftDiamond, leftEllipse, arrow, caption, to, rightRect, rightDiamond, rightEllipse] = edge;
        add(from, leftRect || leftDiamond || leftEllipse || from, leftDiamond ? 'diamond' : leftEllipse ? 'ellipse' : 'rectangle');
        add(to, rightRect || rightDiamond || rightEllipse || to, rightDiamond ? 'diamond' : rightEllipse ? 'ellipse' : 'rectangle');
        connect(from, to, caption, 'flow', arrow === '<-->' ? 'both' : arrow === '<--' ? 'reverse' : arrow === '---' ? 'none' : 'forward');
        continue;
      }
      const node = /^([\w.-]+)(?:\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))?$/u.exec(text);
      if (node) { add(node[1], node[2] || node[3] || node[4] || node[1], node[3] ? 'diamond' : node[4] ? 'ellipse' : 'rectangle'); continue; }
      reject(`unsupported flowchart syntax at line ${line}`);
    }
    if (grammar === 'sequence') {
      const participant = /^(?:participant|actor)\s+(?:"([^"]+)"\s+as\s+)?([\w.-]+)(?:\s+as\s+(?:"([^"]+)"|([\w.-]+)))?$/iu.exec(text);
      if (participant) { add(participant[2], participant[3] || participant[4] || participant[1] || participant[2], 'rectangle', 'participant'); continue; }
      const message = /^([\w.-]+)\s*(<<->>|<-->|->>|-->>|->|-->|-x|--x)(?:[+-])?\s*([\w.-]+)(?:\s*:\s*(.*))?$/u.exec(text);
      if (message) { const [, from, arrow, to, label] = message; add(from, from, 'rectangle', 'participant'); add(to, to, 'rectangle', 'participant'); connect(from, to, label, 'message', arrow.includes('<<') || arrow === '<-->' ? 'both' : 'forward'); continue; }
      reject(`unsupported sequence syntax at line ${line}`);
    }
    if (grammar === 'state') {
      const alias = /^state\s+"([^"]+)"\s+as\s+([\w.-]+)$/iu.exec(text);
      if (alias) { add(alias[2], alias[1], 'ellipse', 'state'); continue; }
      const transition = /^(\[\s*\*\s*\]|[\w.-]+)\s*(-->|-[.])\s*(\[\s*\*\s*\]|[\w.-]+)(?:\s*:\s*(.*))?$/u.exec(text);
      if (transition) {
        let [, from, , to, label] = transition;
        from = from.includes('*') ? 'initial' : from; to = to.includes('*') ? 'final' : to;
        add(from, from === 'initial' ? 'Initial' : from, 'ellipse', 'state'); add(to, to === 'final' ? 'Final' : to, 'ellipse', 'state');
        connect(from, to, label, 'transition', 'forward'); continue;
      }
      if (/^[\w.-]+$/u.test(text)) { add(text, text, 'ellipse', 'state'); continue; }
      reject(`unsupported state syntax at line ${line}`);
    }
    if (grammar === 'er') {
      if (text === '}') { entity = undefined; continue; }
      const declarationMatch = /^([\w.-]+)\s*\{$/u.exec(text);
      if (declarationMatch) { entity = declarationMatch[1]; fields.set(entity, []); add(entity, entity, 'rectangle', 'entity'); continue; }
      const relation = /^([\w.-]+)\s+([|}o{.]+--[|}o{.]+)\s+([\w.-]+)(?:\s*:\s*(.*))?$/u.exec(text);
      if (relation) { const [, from, cardinality, to, label] = relation; add(from, from, 'rectangle', 'entity'); add(to, to, 'rectangle', 'entity'); connect(from, to, label ? `${cardinality}: ${label}` : cardinality, 'association', 'forward'); continue; }
      const field = entity && /^[\w.-]+\s+([\w.-]+)(?:\s+\w+)?$/u.exec(text);
      if (field) { fields.get(entity).push(field[1]); continue; }
      reject(`unsupported ER syntax at line ${line}`);
    }
  }
  if (stack.length) reject('flowchart has an unterminated subgraph');
  if (entity) reject('ER diagram has an unterminated entity');
  if (!nodes.size) reject('diagram contains no supported nodes');
  const fallbackTitle = cleanLabel(path.basename(file, path.extname(file)));
  if (!title) discarded.urls += fallbackTitle.urls;
  const used = new Set();
  const ids = new Map([...nodes.keys()].map((id) => [id, safeId(id, used)]));
  const outputNodes = [...nodes].map(([id, value]) => {
    const fieldsText = fields.get(id) ?? [];
    return { id: ids.get(id), label: [value.label, ...fieldsText].filter(Boolean).join('\n').slice(0, 2_000), kind: value.kind, shape: value.shape, ...(ids.has(value.parent) ? { parentId: ids.get(value.parent) } : {}) };
  });
  const outputGroups = [...groups].filter(([id]) => [...nodes.values()].some((node) => node.parent === id)).map(([id, label]) => ({ id: ids.get(id), label, nodeIds: [...nodes].filter(([, node]) => node.parent === id).map(([nodeId]) => ids.get(nodeId)) }));
  const outputRelations = relations.filter((item) => ids.has(item.from) && ids.has(item.to)).map((item) => ({ from: ids.get(item.from), to: ids.get(item.to), label: item.label, kind: item.kind, direction: item.direction }));
  return { schemaVersion: 1, sourceFormat: 'mermaid', sourceDigest: digest(data), title: title || fallbackTitle.text || 'Imported diagram', suggestedType: grammar === 'flowchart' && outputGroups.length ? 'architecture' : grammar, nodes: outputNodes, relationships: outputRelations, groups: outputGroups, discarded, warnings: ['Source layout and styling are omitted; imported labels are inert data.', ...(direction ? [`Declared direction: ${direction}.`] : [])] };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  const index = args.indexOf('--diagram');
  const diagram = index < 0 ? 0 : Number(args[index + 1]);
  if (!file || (index >= 0 && (!args[index + 1] || !Number.isInteger(diagram)))) reject('Usage: node scripts/mermaid-extract.mjs <file.mmd|file.md> [--diagram 0]');
  return extract(file, diagram);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = cli(main, 'mermaid-extract');
