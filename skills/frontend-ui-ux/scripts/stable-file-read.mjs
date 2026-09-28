import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

function identity(stat) {
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    ctimeNs: stat.ctimeNs,
    mtimeNs: stat.mtimeNs,
    size: stat.size,
    mode: stat.mode
  });
}

function sameDirectory(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.ctimeNs === right.ctimeNs
    && left.mtimeNs === right.mtimeNs;
}

function sameFile(left, right) {
  return sameDirectory(left, right)
    && left.size === right.size
    && left.mode === right.mode;
}

function containedTarget(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath === "" || path.isAbsolute(relativePath)) {
    throw new Error("stable file path must be a relative path");
  }
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative === "" || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("stable file path escapes its root");
  }
  return { absoluteRoot, absoluteTarget };
}

function directoryChain(root, directory) {
  const relative = path.relative(root, directory);
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("stable file ancestor escapes its root");
  }
  const chain = [root];
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    chain.push(current);
  }
  return chain;
}

async function closeAll(entries) {
  for (const entry of [...entries].reverse()) await entry.handle.close().catch(() => {});
}

async function openAncestorChain(root, directory) {
  if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_DIRECTORY !== "number") {
    throw new Error("no-follow directory reads are unavailable");
  }
  const opened = [];
  try {
    for (const absolutePath of directoryChain(root, directory)) {
      const before = await fs.lstat(absolutePath, { bigint: true });
      if (before.isSymbolicLink() || !before.isDirectory()) {
        throw new Error(`canonical ancestor is not a regular directory: ${absolutePath}`);
      }
      const handle = await fs.open(
        absolutePath,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      const descriptor = await handle.stat({ bigint: true });
      if (!descriptor.isDirectory() || !sameDirectory(identity(before), identity(descriptor))) {
        await handle.close();
        throw new Error(`canonical ancestor identity changed before open: ${absolutePath}`);
      }
      opened.push({ absolutePath, handle, snapshot: identity(descriptor) });
    }
    return opened;
  } catch (error) {
    await closeAll(opened);
    throw error;
  }
}

async function assertAncestorsStable(opened) {
  for (const entry of opened) {
    const descriptor = await entry.handle.stat({ bigint: true });
    const named = await fs.lstat(entry.absolutePath, { bigint: true });
    if (
      !descriptor.isDirectory()
      || named.isSymbolicLink()
      || !named.isDirectory()
      || !sameDirectory(entry.snapshot, identity(descriptor))
      || !sameDirectory(entry.snapshot, identity(named))
    ) {
      throw new Error(`canonical ancestor identity changed during read: ${entry.absolutePath}`);
    }
  }
}

async function readBounded(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  const probe = Buffer.alloc(1);
  const { bytesRead: grew } = await handle.read(probe, 0, 1, size);
  if (offset !== size || grew !== 0) throw new Error("canonical file size changed during bounded read");
  return bytes;
}

export async function readStableRegularFile(root, relativePath, options = {}) {
  const maxBytes = options.maxBytes;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("stable file maxBytes must be a non-negative safe integer");
  if (typeof constants.O_NOFOLLOW !== "number") throw new Error("no-follow file reads are unavailable");

  const { absoluteRoot, absoluteTarget } = containedTarget(root, relativePath);
  const ancestors = await openAncestorChain(absoluteRoot, path.dirname(absoluteTarget));
  let handle;
  try {
    const before = await fs.lstat(absoluteTarget, { bigint: true });
    if (before.isSymbolicLink()) throw new Error(`canonical file is a symbolic link: ${relativePath}`);
    if (!before.isFile()) throw new Error(`canonical file is a special file: ${relativePath}`);
    if ((before.mode & 0o444n) === 0n) throw new Error(`canonical file is unreadable: ${relativePath}`);
    if (before.size > BigInt(maxBytes) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`canonical file exceeds the ${maxBytes}-byte read limit: ${relativePath}`);
    }

    handle = await fs.open(absoluteTarget, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(identity(before), identity(opened))) {
      throw new Error(`canonical file identity changed before descriptor read: ${relativePath}`);
    }
    const bytes = await readBounded(handle, Number(opened.size));
    if (typeof options.afterRead === "function") await options.afterRead(relativePath);

    const descriptorAfter = await handle.stat({ bigint: true });
    if (!descriptorAfter.isFile() || !sameFile(identity(opened), identity(descriptorAfter))) {
      throw new Error(`canonical file identity changed during descriptor read: ${relativePath}`);
    }
    const namedAfter = await fs.lstat(absoluteTarget, { bigint: true });
    if (namedAfter.isSymbolicLink() || !namedAfter.isFile() || !sameFile(identity(opened), identity(namedAfter))) {
      throw new Error(`canonical file identity changed after descriptor read: ${relativePath}`);
    }
    await assertAncestorsStable(ancestors);

    if (options.expectedSize !== undefined && bytes.byteLength !== options.expectedSize) {
      throw new Error(`canonical file size changed: ${relativePath}`);
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (options.expectedSha256 !== undefined && sha256 !== options.expectedSha256) {
      throw new Error(`canonical file SHA-256 changed: ${relativePath}`);
    }
    const snapshot = Object.freeze({
      root: absoluteRoot,
      relativePath,
      file: Object.freeze({ absolutePath: absoluteTarget, ...identity(opened) }),
      ancestors: Object.freeze(ancestors.map((entry) => Object.freeze({
        absolutePath: entry.absolutePath,
        ...entry.snapshot
      })))
    });
    return { bytes, sha256, snapshot };
  } finally {
    await handle?.close().catch(() => {});
    await closeAll(ancestors);
  }
}

export async function revalidateStableRegularFile(snapshot) {
  if (
    !snapshot
    || typeof snapshot !== "object"
    || typeof snapshot.root !== "string"
    || typeof snapshot.relativePath !== "string"
    || !snapshot.file
    || !Array.isArray(snapshot.ancestors)
  ) {
    throw new Error("canonical snapshot is malformed");
  }
  if (!Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.file) || !Object.isFrozen(snapshot.ancestors)) {
    throw new Error("canonical snapshot is not immutable");
  }

  const { absoluteRoot, absoluteTarget } = containedTarget(snapshot.root, snapshot.relativePath);
  if (absoluteRoot !== snapshot.root || absoluteTarget !== snapshot.file.absolutePath) {
    throw new Error(`canonical snapshot path changed: ${snapshot.relativePath}`);
  }
  const ancestors = await openAncestorChain(absoluteRoot, path.dirname(absoluteTarget));
  let handle;
  try {
    if (ancestors.length !== snapshot.ancestors.length) {
      throw new Error(`canonical ancestor chain changed after consumption: ${snapshot.relativePath}`);
    }
    for (let index = 0; index < ancestors.length; index += 1) {
      const current = ancestors[index];
      const expected = snapshot.ancestors[index];
      if (current.absolutePath !== expected.absolutePath || !sameDirectory(current.snapshot, expected)) {
        throw new Error(`canonical ancestor identity changed after consumption: ${snapshot.relativePath}`);
      }
    }

    const before = await fs.lstat(absoluteTarget, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || !sameFile(identity(before), snapshot.file)) {
      throw new Error(`canonical file identity changed after consumption: ${snapshot.relativePath}`);
    }
    handle = await fs.open(absoluteTarget, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(identity(before), identity(opened)) || !sameFile(identity(opened), snapshot.file)) {
      throw new Error(`canonical file descriptor identity changed after consumption: ${snapshot.relativePath}`);
    }
    const descriptorAfter = await handle.stat({ bigint: true });
    const namedAfter = await fs.lstat(absoluteTarget, { bigint: true });
    if (
      !descriptorAfter.isFile()
      || namedAfter.isSymbolicLink()
      || !namedAfter.isFile()
      || !sameFile(identity(opened), identity(descriptorAfter))
      || !sameFile(identity(opened), identity(namedAfter))
    ) {
      throw new Error(`canonical file identity changed during revalidation: ${snapshot.relativePath}`);
    }
    await assertAncestorsStable(ancestors);
    return true;
  } finally {
    await handle?.close().catch(() => {});
    await closeAll(ancestors);
  }
}
