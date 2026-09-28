#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const MAX_NODES = 2_000;
export const MAX_RELATIONSHIPS = 5_000;
export const MAX_DEPTH = 64;
const URL_RE = /\b(?:https?|ftp|file|javascript|data):[^\s<>"']+/giu;
const EXEC_RE = /<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=/iu;

export class ImportFailure extends Error {
  constructor(message) { super(message); this.name = 'ImportFailure'; }
}

export function reject(message) { throw new ImportFailure(message); }

export function readBounded(file, limit, label = 'input') {
  if (!Number.isSafeInteger(limit) || limit < 1) reject('invalid input size limit');
  let before;
  try { before = fs.lstatSync(file, { bigint: true }); }
  catch { reject(`cannot open ${label} as a regular file`); }
  if (!before.isFile()) reject(`${label} must be a regular file; symlinks and special files are unsupported`);
  if (before.size > BigInt(limit)) reject(`${label} exceeds the ${Math.floor(limit / 1024 / 1024)} MiB limit`);

  let fd;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(file, flags);
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      reject(`${label} changed while opening; symlinks and special files are unsupported`);
    }
    if (opened.size > BigInt(limit)) reject(`${label} exceeds the ${Math.floor(limit / 1024 / 1024)} MiB limit`);

    const data = Buffer.allocUnsafe(limit + 1);
    let bytesRead = 0;
    while (bytesRead < data.length) {
      const count = fs.readSync(fd, data, bytesRead, Math.min(64 * 1024, data.length - bytesRead), null);
      if (!count) break;
      bytesRead += count;
    }
    if (bytesRead > limit) reject(`${label} exceeds the ${Math.floor(limit / 1024 / 1024)} MiB limit`);

    const after = fs.fstatSync(fd, { bigint: true });
    const pathAfter = fs.lstatSync(file, { bigint: true });
    const stable = after.dev === opened.dev && after.ino === opened.ino
      && after.size === opened.size && after.mtimeNs === opened.mtimeNs && after.ctimeNs === opened.ctimeNs
      && pathAfter.isFile() && pathAfter.dev === opened.dev && pathAfter.ino === opened.ino;
    if (!stable || BigInt(bytesRead) !== opened.size) reject(`${label} changed while being read`);
    return data.subarray(0, bytesRead);
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    reject(`cannot safely read ${label}`);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* Preserve the original read result. */ }
    }
  }
}

export function digest(data) { return createHash('sha256').update(data).digest('hex'); }

export function safeId(sourceId, used) {
  if (!sourceId) reject('diagram contains an element without an id');
  const candidate = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(sourceId)
    ? sourceId
    : `n-${digest(Buffer.from(sourceId)).slice(0, 16)}`;
  if (used.has(candidate)) reject('diagram contains duplicate or colliding element ids');
  used.add(candidate);
  return candidate;
}

export function decodeEntities(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (whole, entity) => {
    const token = entity.toLowerCase();
    if (token === 'amp') return '&';
    if (token === 'lt') return '<';
    if (token === 'gt') return '>';
    if (token === 'quot') return '"';
    if (token === 'apos') return "'";
    if (token === 'nbsp') return ' ';
    const number = token.startsWith('#x') ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10);
    try { return Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '\uFFFD'; }
    catch { return '\uFFFD'; }
  });
}

export function cleanLabel(raw) {
  const decoded = decodeEntities(String(raw));
  if (EXEC_RE.test(decoded)) reject('executable markup or event attributes in labels are unsupported');
  const urls = [...decoded.matchAll(URL_RE)].length;
  const value = decoded.replace(URL_RE, '').replace(/<br\s*\/?>|<\/(?:p|div)\s*>/giu, '\n');
  const text = value.replace(/<[^>]*>/gu, '').replace(/\r\n?/gu, '\n').replace(/\u00a0/gu, ' ');
  return { text: text.split('\n').map((line) => line.replace(/[\t ]+/gu, ' ').trim()).filter(Boolean).join('\n').slice(0, 2_000), urls };
}

export function parseAttributes(source) {
  const attributes = Object.create(null);
  const expression = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of source.matchAll(expression)) attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? '');
  return attributes;
}

export function validateInertXml(source) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) reject('DTD and entity declarations are unsupported');
  if (/<\s*(?:script|iframe|object|embed)\b|\bon[a-z]+\s*=/iu.test(source)) reject('active XML markup or event attributes are unsupported');
  if (/&(?!(?:amp|lt|gt|quot|apos|nbsp|#x[\da-f]+|#\d+);)/iu.test(source)) reject('XML contains an unsupported entity reference');
  const stack = [];
  for (const match of source.matchAll(/<\s*(\/?)\s*([A-Za-z_][\w:.-]*)\b([^>]*)>/gu)) {
    const [, closing, rawName, tail] = match;
    const name = rawName.toLowerCase();
    if (closing) {
      if (stack.pop() !== name) reject('XML element nesting is malformed');
    } else if (!/\/\s*$/u.test(tail)) {
      stack.push(name);
      if (stack.length > MAX_DEPTH) reject('XML nesting exceeds the depth limit (64)');
    }
  }
  if (stack.length) reject('XML element nesting is malformed');
}

export function emit(result) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); }

export function cli(run, toolName) {
  try { emit(run()); return 0; }
  catch (error) {
    process.stderr.write(`${toolName}: ${error instanceof ImportFailure ? error.message : 'input could not be safely parsed'}\n`);
    return 2;
  }
}
