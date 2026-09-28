import fs from 'node:fs';
import path from 'node:path';

export function canonical(location) {
  const absolute = path.resolve(location);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('symlink path refused');
  }
  return fs.realpathSync(absolute);
}
export function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(x => !x || x === '.' || x === '..')) throw new Error('expected a bounded relative path');
  const base = canonical(root);
  if (!fs.statSync(base).isDirectory()) throw new Error('root must be a directory');
  return path.join(base, relative);
}
export function readRegular(location, limit = 1048576) {
  const resolved = canonical(location);
  const before = fs.lstatSync(resolved);
  if (!before.isFile() || before.size === 0 || before.size > limit) throw new Error('expected bounded nonempty regular file');
  const fd = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) throw new Error('file changed during read');
    const bytes = Buffer.alloc(stat.size + 1);
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
    const after = fs.fstatSync(fd);
    if (size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('file changed during read');
    return bytes.subarray(0, size);
  } finally { fs.closeSync(fd); }
}
export function writeFresh(root, relative, data) {
  const file = inside(root, relative);
  const parent = canonical(path.dirname(file));
  const before = fs.statSync(parent);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
  try {
    const after = fs.statSync(canonical(parent));
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error('output parent changed');
    fs.writeFileSync(fd, data);
  } finally { fs.closeSync(fd); }
  return file;
}
