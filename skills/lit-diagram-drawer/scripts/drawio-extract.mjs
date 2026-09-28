#!/usr/bin/env node
import path from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { cleanLabel, cli, digest, MAX_NODES, MAX_RELATIONSHIPS, parseAttributes, readBounded, reject, safeId, validateInertXml } from './import-shared.mjs';

const MAX_INPUT = 16 * 1024 * 1024;
const MAX_DECODED = 32 * 1024 * 1024;
const MAX_PAGES = 1_024;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function inflate(data, raw) {
  try {
    const result = raw ? inflateRawSync(data, { maxOutputLength: MAX_DECODED + 1 }) : inflateSync(data, { maxOutputLength: MAX_DECODED + 1 });
    if (result.length > MAX_DECODED) reject('embedded draw.io page exceeds the 32 MiB decoded limit');
    return result;
  } catch { reject('embedded draw.io page has invalid or oversized compression'); }
}

function decodePage(payload) {
  const compact = payload.replace(/\s+/gu, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(compact) || compact.length % 4 === 1) reject('compressed draw.io page is not valid base64');
  const decoded = inflate(Buffer.from(compact, 'base64'), true);
  try { return decodeURIComponent(new TextDecoder('utf-8', { fatal: true }).decode(decoded)); }
  catch { reject('compressed draw.io page is malformed or not UTF-8'); }
}

function pngText(data) {
  let offset = PNG_MAGIC.length;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const end = offset + 8 + length;
    if (end + 4 > data.length) reject('PNG has a truncated metadata chunk');
    const payload = data.subarray(offset + 8, end);
    const crcInput = data.subarray(offset + 4, end);
    if (crc32(crcInput) !== data.readUInt32BE(end)) reject('PNG metadata chunk has an invalid CRC');
    offset = end + 4;
    if (['tEXt', 'zTXt', 'iTXt'].includes(type)) {
      const split = payload.indexOf(0);
      if (split < 0 || payload.toString('latin1', 0, split).toLowerCase() !== 'mxfile') continue;
      const rest = payload.subarray(split + 1);
      let value;
      if (type === 'tEXt') value = rest.toString('latin1');
      else if (type === 'zTXt') {
        if (rest[0] !== 0) reject('PNG mxfile text uses an unsupported compression method');
        value = inflate(rest.subarray(1), false).toString('utf8');
      } else {
        if (rest.length < 4 || rest[1] !== 0) reject('PNG mxfile international text is malformed');
        const fields = rest.subarray(2).toString('binary').split('\0', 2);
        const textOffset = 2 + Buffer.byteLength(fields[0] ?? '', 'binary') + 1 + Buffer.byteLength(fields[1] ?? '', 'binary') + 1;
        const body = rest.subarray(textOffset);
        value = (rest[0] === 1 ? inflate(body, false) : body).toString('utf8');
      }
      if (Buffer.byteLength(value, 'utf8') > MAX_DECODED) reject('embedded draw.io payload exceeds the decoded size limit');
      try { return decodeURIComponent(value); } catch { return value; }
    }
    if (type === 'IEND') break;
  }
  reject('PNG has no embedded mxfile diagram');
}

function sourceXml(data, file) {
  if (data.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return pngText(data);
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/u, '').trim(); }
  catch { reject('input is not valid UTF-8 draw.io XML'); }
  if (path.extname(file).toLowerCase() === '.svg' || /^<svg\b/iu.test(source)) {
    validateInertXml(source);
    const metadata = /<metadata\b([^>]*)>/iu.exec(source);
    const content = metadata && parseAttributes(metadata[1]).content;
    if (!content || !/(?:<mxfile\b|<mxGraphModel\b)/iu.test(content)) reject('SVG has no embedded draw.io diagram');
    source = content;
  }
  if (!source.startsWith('<')) reject('unsupported form; provide draw.io XML or an SVG/PNG with embedded mxfile data');
  validateInertXml(source);
  return source;
}

function pagesFrom(source, pageIndex = 0) {
  if (!Number.isInteger(pageIndex) || pageIndex < 0) reject('page index is out of range');
  const root = /^\s*<([\w:.-]+)/u.exec(source)?.[1]?.split(':').at(-1)?.toLowerCase();
  if (root === 'mxgraphmodel') {
    if (pageIndex !== 0) reject('page index is out of range (file contains 1 page)');
    return { name: '', xml: source };
  }
  if (root !== 'mxfile') reject('unsupported XML root; expected mxfile or mxGraphModel');
  let count = 0;
  let selected;
  for (const match of source.matchAll(/<diagram\b([^>]*)>([\s\S]*?)<\/diagram\s*>/giu)) {
    if (count >= MAX_PAGES) reject(`draw.io file exceeds the ${MAX_PAGES} page limit`);
    const attributes = parseAttributes(match[1]);
    if (count === pageIndex) {
      const body = match[2].trim();
      const xml = /<mxGraphModel\b/iu.test(body) ? body : decodePage(body);
      validateInertXml(xml);
      if (!/<mxGraphModel\b/iu.test(xml)) reject('draw.io page does not contain mxGraphModel');
      selected = { name: attributes.name ?? '', xml };
    }
    count += 1;
  }
  if (!count) reject('draw.io file contains no pages');
  if (!selected) reject(`page index is out of range (file contains ${count} page(s))`);
  return selected;
}

function cellsFrom(xml) {
  const cells = [];
  const covered = [];
  const wrappers = /<(?:object|UserObject)\b([^>]*)>([\s\S]*?)<\/(?:object|UserObject)\s*>/giu;
  for (const wrapper of xml.matchAll(wrappers)) {
    const cell = /<mxCell\b([^>]*)\/?\s*>/iu.exec(wrapper[2]);
    if (cell) cells.push({ ...parseAttributes(wrapper[1]), ...parseAttributes(cell[1]) });
    covered.push([wrapper.index, wrapper.index + wrapper[0].length]);
  }
  for (const match of xml.matchAll(/<mxCell\b([^>]*)\/?\s*>/giu)) {
    if (!covered.some(([start, end]) => match.index >= start && match.index < end)) cells.push(parseAttributes(match[1]));
  }
  for (const match of xml.matchAll(/<mxGeometry\b([^>]*)\/?\s*>/giu)) {
    const geometry = parseAttributes(match[1]);
    for (const key of ['x', 'y', 'width', 'height']) {
      if (geometry[key] === undefined) continue;
      const value = Number(geometry[key]);
      if (!Number.isFinite(value) || Math.abs(value) > 10_000_000) reject(`geometry field ${key} is outside the supported range`);
    }
  }
  return cells;
}

function shapeOf(style = '') {
  const raw = /(?:^|;)shape=([^;]+)/iu.exec(style)?.[1]?.toLowerCase() ?? 'rect';
  if (/rhombus|diamond/u.test(raw)) return 'diamond';
  if (/ellipse|actor/u.test(raw)) return 'ellipse';
  if (/cylinder|database/u.test(raw)) return 'cylinder';
  if (/swimlane/u.test(raw)) return 'container';
  if (/text/u.test(raw)) return 'text';
  if (/group/u.test(raw)) return 'group';
  if (/table/u.test(raw)) return 'table';
  if (/hexagon/u.test(raw)) return 'hexagon';
  if (/cloud/u.test(raw)) return 'cloud';
  if (/parallelogram/u.test(raw)) return 'parallelogram';
  if (/document/u.test(raw)) return 'document';
  if (/image/u.test(raw)) return 'image';
  return 'rectangle';
}

function extract(file, pageIndex = 0) {
  const data = readBounded(file, MAX_INPUT);
  const page = pagesFrom(sourceXml(data, file), pageIndex);
  const cells = cellsFrom(page.xml);
  if (cells.length > MAX_NODES + MAX_RELATIONSHIPS) reject('diagram exceeds the 7,000 cell limit');
  const ids = new Map();
  const used = new Set();
  for (const cell of cells) {
    if (cell.id === undefined || ids.has(cell.id)) reject('diagram contains duplicate or missing element ids');
    ids.set(cell.id, safeId(cell.id, used));
  }
  const vertices = cells.filter((cell) => cell.vertex === '1');
  const edges = cells.filter((cell) => cell.edge === '1');
  if (vertices.length > MAX_NODES || edges.length > MAX_RELATIONSHIPS) reject('diagram exceeds the node or relationship limit');
  const vertexIds = new Set(vertices.map((cell) => cell.id));
  const children = new Map();
  for (const cell of vertices) if (vertexIds.has(cell.parent)) children.set(cell.parent, [...(children.get(cell.parent) ?? []), cell.id]);
  const discarded = { styles: 0, links: 0, urls: 0, assets: 0, unsupportedElements: 0, danglingRelationships: 0 };
  const title = cleanLabel(page.name || path.basename(file, path.extname(file)) || 'Imported diagram');
  discarded.urls += title.urls;
  const nodes = vertices.map((cell) => {
    const label = cleanLabel(cell.value ?? cell.label ?? '');
    discarded.urls += label.urls;
    const shape = shapeOf(cell.style ?? '');
    discarded.styles += Number(Boolean(cell.style));
    discarded.links += Number(Boolean(cell.link || cell.href));
    discarded.assets += Number(shape === 'image' || /(?:^|;)image=/iu.test(cell.style ?? ''));
    const group = Boolean(children.get(cell.id)?.length) || shape === 'container' || shape === 'group';
    return { id: ids.get(cell.id), label: label.text, kind: group ? 'container' : 'component', shape: group ? 'container' : shape, ...(vertexIds.has(cell.parent) ? { parentId: ids.get(cell.parent) } : {}) };
  });
  const groups = vertices.filter((cell) => children.has(cell.id)).map((cell) => ({ id: ids.get(cell.id), label: nodes.find((node) => node.id === ids.get(cell.id))?.label || 'Group', nodeIds: children.get(cell.id).map((id) => ids.get(id)) }));
  const relationships = [];
  for (const edge of edges) {
    if (!vertexIds.has(edge.source) || !vertexIds.has(edge.target)) { discarded.danglingRelationships += 1; continue; }
    const label = cleanLabel(edge.value ?? '');
    discarded.urls += label.urls;
    discarded.styles += Number(Boolean(edge.style));
    discarded.links += Number(Boolean(edge.link || edge.href));
    const style = edge.style ?? '';
    const start = /(?:^|;)startArrow=(?!none(?:;|$))/iu.test(style);
    const end = /(?:^|;)endArrow=(?!none(?:;|$))/iu.test(style);
    const direction = start && end ? 'both' : start ? 'reverse' : end ? 'forward' : 'none';
    relationships.push({ from: ids.get(edge.source), to: ids.get(edge.target), label: label.text, kind: direction === 'none' ? 'association' : 'flow', direction });
  }
  return { schemaVersion: 1, sourceFormat: 'drawio', sourceDigest: digest(data), title: title.text || 'Imported diagram', suggestedType: groups.length ? 'architecture' : relationships.length ? 'flowchart' : 'architecture', nodes, relationships, groups, discarded, warnings: ['Source coordinates and styling are omitted; imported labels are inert data.'] };
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  const index = args.indexOf('--page');
  const page = index < 0 ? 0 : Number(args[index + 1]);
  if (!file || (index >= 0 && (!args[index + 1] || !Number.isInteger(page)))) reject('Usage: node scripts/drawio-extract.mjs <file.drawio|file.svg|file.png> [--page 0]');
  return extract(file, page);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = cli(main, 'drawio-extract');
