import { createHash, randomUUID } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { decodeStrictUtf8, parseStrictJson } from "./strict-json.ts";
import { containsSecret } from "./secret-shapes.ts";
import { sameStableDirectoryIdentity, sameStableStatIdentity, stableStatIdentity } from "./stable-identity.ts";

export const knowledgeKinds = ["fact", "decision", "failure", "risk", "rule", "checkpoint"] as const;
export type KnowledgeKind = (typeof knowledgeKinds)[number];
export const knowledgeStates = ["review-needed", "accepted", "rejected", "stale"] as const;
export type KnowledgeState = (typeof knowledgeStates)[number];

export type KnowledgeEvent = {
  readonly kind: KnowledgeKind;
  readonly text: string;
  readonly evidenceRef: string;
  readonly source: string;
};

export type KnowledgeRecord = {
  readonly id: string;
  readonly text: string;
  readonly kind: KnowledgeKind;
  readonly state: KnowledgeState;
  readonly timestamp: string;
  readonly provenance: {
    readonly product: "litopencode";
    readonly surface: string;
    readonly source: string;
  };
  readonly evidence: {
    readonly ref: string;
  };
};

export type KnowledgePaths = {
  readonly projectRoot: string;
  readonly runtimeDirectory: string;
  readonly directory: string;
  readonly claimsFile: string;
  readonly lockDirectory: string;
  readonly projectRootIdentity?: DirectoryIdentity;
  readonly runtimeDirectoryIdentity?: DirectoryIdentity;
  readonly directoryIdentity?: DirectoryIdentity;
};

export type KnowledgeCaptureResult =
  | { readonly status: "captured" | "duplicate"; readonly record: KnowledgeRecord }
  | { readonly status: "disabled" }
  | { readonly status: "rejected"; readonly reason: string };

export type KnowledgeReviewResult =
  | { readonly status: "updated" | "duplicate"; readonly record: KnowledgeRecord }
  | { readonly status: "blocked"; readonly reason: string };

export type KnowledgeQueryResult = {
  readonly text: string;
  readonly records: readonly KnowledgeRecord[];
  readonly budgetBytes: number;
  readonly byteLength: number;
};

export class KnowledgeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeStoreError";
  }
}

class KnowledgeFileDisappearedError extends KnowledgeStoreError {
  readonly code = "ENOENT";
}

type DirectoryIdentity = {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly ctimeMs: number | bigint;
  readonly birthtimeMs: number | bigint;
};

type FileIdentity = DirectoryIdentity & {
  readonly nlink: number | bigint;
};

type ParentIdentity = {
  readonly path: string;
  readonly identity: DirectoryIdentity;
};

type RegularFileRead = {
  readonly text: string;
  readonly identity?: FileIdentity;
};

type FileReadOptions = {
  readonly allowHardlinks?: boolean;
  readonly allowMissing?: boolean;
};

type LockOwner = {
  readonly pid: number;
  readonly nonce: string;
};

type AuthoritySnapshot = {
  readonly raw: string;
  readonly identity?: FileIdentity;
};

type RecoveryStatus = "clean" | "recovered" | "recovery-required";

type RecoveryResult = {
  readonly status: RecoveryStatus;
  readonly recovered: boolean;
  readonly recoveryRequired: boolean;
  readonly removed: readonly string[];
  readonly preserved: readonly string[];
};

const normalQueryBudgetBytes = 2048;
const hardQueryBudgetBytes = 4096;
const maximumTextBytes = 320;
const maximumTextWords = 56;
const maximumEvidenceBytes = 192;
const maximumAuthorityBytes = 8 * 1024 * 1024;
const maximumStructuredStringScanCharacters = 512;
const safeIdentifier = /^[a-z0-9][a-z0-9._/-]{0,63}$/u;
const evidenceReference = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+(?:(?::\d+(?:-\d+)?)|(?:#[A-Za-z0-9._-]+))?$/u;
const controlCharacterShape = /[\u0000-\u001F\u007F-\u009F\p{Cf}]/u;
const instructionShape = /(?:```|<\/?(?:system|assistant|developer|user|tool)\b|\b(?:ignore|disregard)\s+(?:(?:all|any|every|the)\s+)?(?:previous|prior)\s+instructions?\b|\bsystem prompt\b|\bdeveloper message\b|^(?:system|assistant|developer|user|tool)\s*:|(?:^|\n)\s*#{1,6}\s*(?:system|assistant|developer|user|tool)\s*:)/iu;
const stopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "does", "for", "from", "how", "in", "is", "it", "of", "on", "or", "the", "this", "to", "what", "where", "which", "with"]);
const noFollowReadFlags = fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW;
const noFollowCreateFlags = fsSync.constants.O_WRONLY | fsSync.constants.O_CREAT | fsSync.constants.O_EXCL | fsSync.constants.O_NOFOLLOW;
const noFollowDirectoryFlags = fsSync.constants.O_RDONLY | (fsSync.constants.O_DIRECTORY ?? 0);
type KnowledgeFileHandle = Awaited<ReturnType<typeof fs.open>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseLockOwner(value: unknown, filePath: string): LockOwner {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "pid" && key !== "nonce") ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.nonce !== "string" ||
    value.nonce.length === 0
  ) {
    throw new KnowledgeStoreError(`Malformed knowledge lock owner at ${filePath}.`);
  }
  return { pid: value.pid, nonce: value.nonce };
}

function identityOf(stat: {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly ctimeMs: number | bigint;
  readonly birthtimeMs: number | bigint;
}): DirectoryIdentity {
  return stableStatIdentity(stat);
}

function fileIdentityOf(stat: {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly nlink: number | bigint;
  readonly ctimeMs: number | bigint;
  readonly birthtimeMs: number | bigint;
}): FileIdentity {
  return Object.freeze({ ...stableStatIdentity(stat), nlink: stat.nlink });
}

function sameIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return sameStableDirectoryIdentity(stableStatIdentity(left), stableStatIdentity(right));
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return sameStableStatIdentity(stableStatIdentity(left), stableStatIdentity(right)) && left.nlink === right.nlink;
}

function isParentIdentityRace(error: unknown, parentPath: string): boolean {
  return error instanceof KnowledgeStoreError &&
    error.message === `Knowledge parent identity changed before I/O: ${parentPath}.`;
}

function assertDirectoryStat(stat: { readonly isSymbolicLink: () => boolean; readonly isDirectory: () => boolean }, filePath: string): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new KnowledgeStoreError(`Unsafe knowledge directory at ${filePath}: symbolic links and non-directories are not allowed.`);
  }
}

function syncDirectoryIdentity(filePath: string): DirectoryIdentity | undefined {
  try {
    const stat = fsSync.lstatSync(filePath);
    assertDirectoryStat(stat, filePath);
    return identityOf(stat);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isUriSchemeCharacter(code: number): boolean {
  return isAsciiLetter(code) || (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2d || code === 0x2e;
}

function isUriAuthorityDelimiter(code: number): boolean {
  return code <= 0x20 || code === 0x23 || code === 0x2f || code === 0x3f || code === 0x85 || code === 0xa0 ||
    code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function containsCredentialUriUserinfo(value: string): boolean {
  const limit = Math.min(value.length, maximumStructuredStringScanCharacters);
  let index = 0;
  while (index < limit) {
    if (!isAsciiLetter(value.charCodeAt(index))) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    while (cursor < limit && isUriSchemeCharacter(value.charCodeAt(cursor))) cursor += 1;
    if (value.charCodeAt(cursor) !== 0x3a || value.charCodeAt(cursor + 1) !== 0x2f || value.charCodeAt(cursor + 2) !== 0x2f) {
      index = cursor > index ? cursor : index + 1;
      continue;
    }
    const authorityStart = cursor + 3;
    let authorityEnd = authorityStart;
    while (authorityEnd < limit && !isUriAuthorityDelimiter(value.charCodeAt(authorityEnd))) authorityEnd += 1;
    for (let authorityIndex = authorityStart + 1; authorityIndex < authorityEnd; authorityIndex += 1) {
      if (value.charCodeAt(authorityIndex) === 0x40) return true;
    }
    index = authorityEnd;
  }
  return false;
}

function structuredStringReason(value: string): "UNSAFE_CONTROL_CHARACTERS" | "UNSAFE_URI_USERINFO" | undefined {
  if (controlCharacterShape.test(value)) return "UNSAFE_CONTROL_CHARACTERS";
  if (containsCredentialUriUserinfo(value)) return "UNSAFE_URI_USERINFO";
  return undefined;
}

function validSurface(value: string): boolean {
  return safeIdentifier.test(value) && !value.includes("..") && utf8Bytes(value) <= 64;
}

function parseKnowledgeEvent(value: unknown): { readonly event?: KnowledgeEvent; readonly reason?: string } {
  if (!isRecord(value)) return { reason: "INVALID_EVENT_OBJECT" };
  const supported = new Set(["kind", "text", "evidenceRef", "source"]);
  if (Object.keys(value).some((key) => !supported.has(key))) return { reason: "INVALID_EVENT_FIELDS" };
  if (typeof value.kind !== "string" || !knowledgeKinds.includes(value.kind as KnowledgeKind)) {
    return { reason: "INVALID_KIND" };
  }
  if (typeof value.text !== "string") return { reason: "INVALID_TEXT" };
  const textReason = structuredStringReason(value.text);
  if (textReason !== undefined) return { reason: textReason };
  const text = normalizeText(value.text);
  if (text.length === 0 || utf8Bytes(text) > maximumTextBytes || text.split(" ").length > maximumTextWords) {
    return { reason: "INVALID_TEXT_BOUNDS" };
  }
  if (instructionShape.test(text) || /[<>]/u.test(text)) return { reason: "UNSAFE_INSTRUCTION_SHAPE" };
  if (containsSecret(text)) return { reason: "UNSAFE_SECRET" };
  if (typeof value.evidenceRef !== "string") return { reason: "INVALID_EVIDENCE_REFERENCE" };
  const evidenceRef = value.evidenceRef.trim();
  const evidenceReason = structuredStringReason(evidenceRef);
  if (evidenceReason !== undefined || utf8Bytes(evidenceRef) > maximumEvidenceBytes || !evidenceReference.test(evidenceRef) || containsSecret(evidenceRef)) {
    return { reason: "INVALID_EVIDENCE_REFERENCE" };
  }
  if (typeof value.source !== "string" || structuredStringReason(value.source) !== undefined || !validSurface(value.source) || containsSecret(value.source)) {
    return { reason: "INVALID_SOURCE" };
  }
  return {
    event: {
      kind: value.kind as KnowledgeKind,
      text,
      evidenceRef,
      source: value.source
    }
  };
}

function stableKnowledgeId(event: KnowledgeEvent): string {
  const identity = JSON.stringify([event.kind, event.text.toLocaleLowerCase("en-US"), event.evidenceRef, event.source]);
  return `kn_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function isIsoTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u.exec(value);
  if (match === null) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondsText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = millisecondsText === undefined ? 0 : Number(millisecondsText);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || milliseconds > 999) {
    return false;
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second &&
    date.getUTCMilliseconds() === milliseconds;
}

function parseKnowledgeRecord(value: unknown, line: number): KnowledgeRecord {
  if (!isRecord(value)) throw new KnowledgeStoreError(`Malformed knowledge claim at line ${line}: expected an object.`);
  const supported = new Set(["id", "text", "kind", "state", "timestamp", "provenance", "evidence"]);
  const provenanceFields = new Set(["product", "surface", "source"]);
  const evidenceFields = new Set(["ref"]);
  if (Object.keys(value).some((key) => !supported.has(key))) {
    throw new KnowledgeStoreError(`Malformed knowledge claim at line ${line}: unknown fields.`);
  }
  const provenance = value.provenance;
  const evidence = value.evidence;
  if (
    typeof value.id !== "string" || !/^kn_[a-f0-9]{24}$/u.test(value.id) ||
    typeof value.text !== "string" || structuredStringReason(value.text) !== undefined || value.text.length === 0 || normalizeText(value.text) !== value.text || utf8Bytes(value.text) > maximumTextBytes || value.text.split(" ").length > maximumTextWords ||
    typeof value.kind !== "string" || !knowledgeKinds.includes(value.kind as KnowledgeKind) ||
    typeof value.state !== "string" || !knowledgeStates.includes(value.state as KnowledgeState) ||
    typeof value.timestamp !== "string" || !isIsoTimestamp(value.timestamp) ||
    !isRecord(provenance) || Object.keys(provenance).some((key) => !provenanceFields.has(key)) || provenance.product !== "litopencode" ||
    typeof provenance.surface !== "string" || structuredStringReason(provenance.surface) !== undefined || !validSurface(provenance.surface) ||
    typeof provenance.source !== "string" || structuredStringReason(provenance.source) !== undefined || !validSurface(provenance.source) ||
    !isRecord(evidence) || Object.keys(evidence).some((key) => !evidenceFields.has(key)) ||
    typeof evidence.ref !== "string" || structuredStringReason(evidence.ref) !== undefined || utf8Bytes(evidence.ref) > maximumEvidenceBytes || !evidenceReference.test(evidence.ref)
  ) {
    throw new KnowledgeStoreError(`Malformed knowledge claim at line ${line}: invalid bounded fields.`);
  }
  if (
    instructionShape.test(value.text) || containsSecret(value.text) || /[<>]/u.test(value.text) ||
    containsSecret(provenance.surface) || containsSecret(provenance.source) || containsSecret(evidence.ref)
  ) {
    throw new KnowledgeStoreError(`Malformed knowledge claim at line ${line}: unsafe text.`);
  }
  const expectedId = stableKnowledgeId({
    kind: value.kind as KnowledgeKind,
    text: value.text,
    evidenceRef: evidence.ref,
    source: provenance.source
  });
  if (value.id !== expectedId) {
    throw new KnowledgeStoreError(`Malformed knowledge claim at line ${line}: stable id does not match the record fields.`);
  }
  return value as unknown as KnowledgeRecord;
}

function parseClaims(raw: string): readonly KnowledgeRecord[] {
  if (raw === "") return [];
  const lines = (raw.endsWith("\n") ? raw.slice(0, -1) : raw).split("\n");
  return Object.freeze(lines.map((line, index) => {
    try {
      return parseKnowledgeRecord(parseStrictJson(line), index + 1);
    } catch (error) {
      if (error instanceof KnowledgeStoreError) throw error;
      throw new KnowledgeStoreError(`Malformed knowledge claim at line ${index + 1}: invalid JSON.`);
    }
  }));
}

async function assertPinnedDirectory(filePath: string, expected: DirectoryIdentity | undefined): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") && expected === undefined) return;
    if (hasErrorCode(error, "ENOENT")) {
      throw new KnowledgeStoreError(`Knowledge ancestor identity changed before I/O: ${filePath} is missing.`);
    }
    throw error;
  }
  assertDirectoryStat(stat, filePath);
  if (expected === undefined || !sameIdentity(identityOf(stat), expected)) {
    throw new KnowledgeStoreError(`Knowledge ancestor identity changed before I/O: ${filePath}.`);
  }
}

async function assertPinnedDirectories(paths: KnowledgePaths): Promise<void> {
  await assertPinnedDirectory(paths.projectRoot, paths.projectRootIdentity);
  await assertPinnedDirectory(paths.runtimeDirectory, paths.runtimeDirectoryIdentity);
  await assertPinnedDirectory(paths.directory, paths.directoryIdentity);
}

async function pinParent(filePath: string, paths: KnowledgePaths): Promise<ParentIdentity> {
  await assertPinnedDirectories(paths);
  const parentPath = path.dirname(filePath);
  const stat = await fs.lstat(parentPath);
  assertDirectoryStat(stat, parentPath);
  const identity = identityOf(stat);
  if (parentPath === paths.directory && paths.directoryIdentity !== undefined && !sameIdentity(identity, paths.directoryIdentity)) {
    throw new KnowledgeStoreError(`Knowledge parent identity changed before I/O: ${parentPath}.`);
  }
  return Object.freeze({ path: parentPath, identity });
}

async function assertParentStable(parent: ParentIdentity, paths: KnowledgePaths): Promise<void> {
  await assertPinnedDirectories(paths);
  const stat = await fs.lstat(parent.path);
  assertDirectoryStat(stat, parent.path);
  if (!sameIdentity(identityOf(stat), parent.identity)) {
    throw new KnowledgeStoreError(`Knowledge parent identity changed before I/O: ${parent.path}.`);
  }
}

async function readRegularFileIfPresent(filePath: string, paths: KnowledgePaths, options: FileReadOptions = {}): Promise<RegularFileRead> {
  const allowHardlinks = options.allowHardlinks === true;
  const parent = await pinParent(filePath, paths);
  await assertParentStable(parent, paths);

  let pathStat;
  try {
    pathStat = await fs.lstat(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      if (options.allowMissing !== false) return { text: "" };
      throw new KnowledgeFileDisappearedError(`Knowledge file disappeared during observation at ${filePath}.`);
    }
    throw error;
  }
  if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
    throw new KnowledgeStoreError(`Unsafe knowledge file type at ${filePath}.`);
  }
  if (!allowHardlinks && pathStat.nlink !== 1) throw new KnowledgeStoreError(`Unsafe hardlinked knowledge file at ${filePath}: multiple links are not allowed.`);
  if (pathStat.size > maximumAuthorityBytes) throw new KnowledgeStoreError("Knowledge authority exceeds its local byte limit.");

  let handle;
  try {
    handle = await fs.open(filePath, noFollowReadFlags);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new KnowledgeFileDisappearedError(`Knowledge file disappeared after observation at ${filePath}.`);
    }
    if (hasErrorCode(error, "ELOOP")) throw new KnowledgeStoreError(`Unsafe knowledge file type at ${filePath}: symbolic links are not allowed.`);
    throw error;
  }
  try {
    await assertParentStable(parent, paths);
    const descriptorStat = await handle.stat();
    if (!descriptorStat.isFile() || !sameFileIdentity(fileIdentityOf(descriptorStat), fileIdentityOf(pathStat))) {
      throw new KnowledgeStoreError(`Unsafe knowledge file replacement at ${filePath}.`);
    }
    if (!allowHardlinks && descriptorStat.nlink !== 1) throw new KnowledgeStoreError(`Unsafe hardlinked knowledge file at ${filePath}: multiple links are not allowed.`);
    if (descriptorStat.size > maximumAuthorityBytes) throw new KnowledgeStoreError("Knowledge authority exceeds its local byte limit.");
    await assertParentStable(parent, paths);
    const text = decodeStrictUtf8(await handle.readFile());
    if (utf8Bytes(text) > maximumAuthorityBytes) throw new KnowledgeStoreError("Knowledge authority exceeds its local byte limit.");
    await assertParentStable(parent, paths);
    let finalStat;
    try {
      finalStat = await fs.lstat(filePath);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) throw new KnowledgeFileDisappearedError(`Knowledge authority disappeared after descriptor read at ${filePath}.`);
      throw error;
    }
    if (finalStat.isSymbolicLink() || !finalStat.isFile() || !sameFileIdentity(fileIdentityOf(finalStat), fileIdentityOf(descriptorStat))) {
      throw new KnowledgeStoreError(`Knowledge file changed after descriptor read at ${filePath}.`);
    }
    if (!allowHardlinks && finalStat.nlink !== 1) throw new KnowledgeStoreError(`Unsafe hardlinked knowledge file at ${filePath}: multiple links are not allowed.`);
    if (finalStat.size > maximumAuthorityBytes) throw new KnowledgeStoreError("Knowledge authority exceeds its local byte limit.");
    return { text, identity: fileIdentityOf(finalStat) };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function writeBufferFully(handle: KnowledgeFileHandle, bytes: Buffer, filePath: string): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const remaining = bytes.byteLength - offset;
    const result = await handle.write(bytes, offset, remaining, null);
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > remaining) {
      throw new KnowledgeStoreError(`Knowledge staged write made no progress at ${filePath}.`);
    }
    offset += result.bytesWritten;
  }
}

async function writePrivateFile(filePath: string, text: string, paths: KnowledgePaths): Promise<void> {
  const parent = await pinParent(filePath, paths);
  try {
    await assertParentStable(parent, paths);
    const handle = await fs.open(filePath, noFollowCreateFlags, 0o600);
    try {
      await assertParentStable(parent, paths);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw new KnowledgeStoreError(`Unsafe staged knowledge file at ${filePath}.`);
      await assertParentStable(parent, paths);
      await writeBufferFully(handle, Buffer.from(text, "utf8"), filePath);
      await assertParentStable(parent, paths);
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    if (hasErrorCode(error, "ELOOP")) throw new KnowledgeStoreError(`Unsafe knowledge file type at ${filePath}: symbolic links are not allowed.`);
    throw error;
  }
}

function unsupportedDirectorySync(error: unknown): boolean {
  return ["EBADF", "EISDIR", "EINVAL", "ENOTSUP", "EOPNOTSUPP", "EPERM"].some((code) => hasErrorCode(error, code));
}

async function syncDirectory(filePath: string, paths: KnowledgePaths): Promise<void> {
  await assertPinnedDirectories(paths);
  let handle: KnowledgeFileHandle;
  try {
    handle = await fs.open(filePath, noFollowDirectoryFlags);
  } catch (error) {
    if (unsupportedDirectorySync(error)) return;
    throw error;
  }
  try {
    try {
      await handle.sync();
    } catch (error) {
      if (!unsupportedDirectorySync(error)) throw error;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function publishStage(
  stagePath: string,
  finalPath: string,
  expectedAuthority: AuthoritySnapshot,
  paths: KnowledgePaths,
  finalParent: ParentIdentity
): Promise<void> {
  const stage = await readRegularFileIfPresent(stagePath, paths);
  if (stage.identity === undefined) throw new KnowledgeStoreError(`Knowledge staged snapshot disappeared at ${stagePath}.`);
  parseClaims(stage.text);
  const authority = await readAuthoritySnapshot(paths);
  if (!sameAuthoritySnapshot(expectedAuthority, authority)) {
    throw new KnowledgeStoreError(`Knowledge authority changed before snapshot publication at ${finalPath}.`);
  }
  await assertParentStable(finalParent, paths);
  await fs.rename(stagePath, finalPath);
  try {
    await syncDirectory(finalParent.path, paths);
  } catch (error) {
    try {
      await writePrivateFile(stagePath, stage.text, paths);
    } catch {
      // Keep the committed authority visible when the recovery copy cannot be recreated.
    }
    throw error;
  }
  const finalRead = await readAuthoritySnapshot(paths);
  if (finalRead.raw !== stage.text) throw new KnowledgeStoreError(`Knowledge final bytes differ from the staged snapshot at ${finalPath}.`);
  parseClaims(finalRead.raw);
}

async function promoteStage(
  stagePath: string,
  finalPath: string,
  paths: KnowledgePaths,
  expectedAuthority: AuthoritySnapshot
): Promise<void> {
  const stageParent = await pinParent(stagePath, paths);
  const finalParent = await pinParent(finalPath, paths);
  await assertParentStable(stageParent, paths);
  const stage = await readRegularFileIfPresent(stagePath, paths);
  const authority = await readAuthoritySnapshot(paths);
  if (!sameAuthoritySnapshot(expectedAuthority, authority)) {
    throw new KnowledgeStoreError(`Knowledge authority changed before snapshot publication at ${finalPath}.`);
  }
  try {
    parseClaims(authority.raw);
  } catch {
    throw new KnowledgeStoreError(`Knowledge recovery is required before snapshot publication at ${finalPath}.`);
  }
  if (!stage.text.startsWith(authority.raw) || stage.text === authority.raw) {
    throw new KnowledgeStoreError(`Knowledge staged snapshot diverges from the current authority at ${stagePath}.`);
  }
  await publishStage(stagePath, finalPath, expectedAuthority, paths, finalParent);
}

async function ensureDirectory(filePath: string, beforeCreate?: () => Promise<void>): Promise<DirectoryIdentity> {
  try {
    const existing = await fs.lstat(filePath);
    assertDirectoryStat(existing, filePath);
    return identityOf(existing);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
  await beforeCreate?.();
  try {
    await fs.mkdir(filePath, { mode: 0o700 });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      if (hasErrorCode(error, "ENOENT")) throw new KnowledgeStoreError(`Knowledge parent disappeared before creating ${filePath}.`);
      throw error;
    }
  }
  const stat = await fs.lstat(filePath);
  assertDirectoryStat(stat, filePath);
  return identityOf(stat);
}

async function ensureKnowledgeDirectory(paths: KnowledgePaths): Promise<KnowledgePaths> {
  await assertPinnedDirectories(paths);
  let current = paths;
  if (current.runtimeDirectoryIdentity === undefined) {
    await assertPinnedDirectories(current);
    await ensureDirectory(current.runtimeDirectory, async () => assertPinnedDirectories(current));
    current = knowledgePaths(current.projectRoot);
  }
  if (current.directoryIdentity === undefined) {
    await assertPinnedDirectories(current);
    await ensureDirectory(current.directory, async () => assertPinnedDirectories(current));
    current = knowledgePaths(current.projectRoot);
  }
  await assertPinnedDirectories(current);
  return current;
}

async function knowledgeDirectoryExists(paths: KnowledgePaths): Promise<boolean> {
  await assertPinnedDirectories(paths);
  return paths.runtimeDirectoryIdentity !== undefined && paths.directoryIdentity !== undefined;
}

async function readAuthority(paths: KnowledgePaths): Promise<string> {
  return (await readAuthoritySnapshot(paths)).raw;
}

async function readAuthoritySnapshot(paths: KnowledgePaths): Promise<AuthoritySnapshot> {
  if (!(await knowledgeDirectoryExists(paths))) return { raw: "" };
  const result = await readRegularFileIfPresent(paths.claimsFile, paths, { allowHardlinks: true });
  return { raw: result.text, ...(result.identity === undefined ? {} : { identity: result.identity }) };
}

function sameAuthoritySnapshot(left: AuthoritySnapshot, right: AuthoritySnapshot): boolean {
  if (left.identity === undefined || right.identity === undefined) {
    return left.identity === right.identity && left.raw === right.raw;
  }
  return sameFileIdentity(left.identity, right.identity) && left.raw === right.raw;
}

function recoveryResult(status: RecoveryStatus, removed: readonly string[] = [], preserved: readonly string[] = []): RecoveryResult {
  return {
    status,
    recovered: status === "recovered",
    recoveryRequired: status === "recovery-required",
    removed: Object.freeze([...removed]),
    preserved: Object.freeze([...preserved])
  };
}

export function knowledgePaths(projectRoot: string): KnowledgePaths {
  const root = path.resolve(projectRoot);
  let projectRootIdentity: DirectoryIdentity | undefined;
  try {
    const stat = fsSync.lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new KnowledgeStoreError(`Unsafe project root at ${root}: symbolic links and non-directories are not allowed.`);
    projectRootIdentity = identityOf(stat);
  } catch (error) {
    if (error instanceof KnowledgeStoreError || !hasErrorCode(error, "ENOENT")) throw error;
  }
  const runtimeDirectory = path.join(root, ".litopencode");
  const directory = path.join(runtimeDirectory, "knowledge");
  return {
    projectRoot: root,
    runtimeDirectory,
    directory,
    claimsFile: path.join(directory, "claims.jsonl"),
    lockDirectory: path.join(directory, ".claims.lock"),
    projectRootIdentity,
    runtimeDirectoryIdentity: syncDirectoryIdentity(runtimeDirectory),
    directoryIdentity: syncDirectoryIdentity(directory)
  };
}

type StageCandidate = {
  readonly name: string;
  readonly filePath: string;
  readonly raw: string;
  readonly identity: FileIdentity;
};

async function removeSafeStage(filePath: string, expectedIdentity: FileIdentity, paths: KnowledgePaths): Promise<boolean> {
  const parent = await pinParent(filePath, paths);
  await assertParentStable(parent, paths);
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return true;
    return false;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !sameFileIdentity(fileIdentityOf(stat), expectedIdentity)) return false;
  await fs.rm(filePath, { force: true });
  return true;
}

async function recoverUnlocked(paths: KnowledgePaths): Promise<RecoveryResult> {
  await assertPinnedDirectories(paths);
  let entries: readonly string[];
  try {
    entries = await fs.readdir(paths.directory);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return recoveryResult("clean");
    throw error;
  }
  const prefix = `${path.basename(paths.claimsFile)}.tmp-`;
  const candidates = entries.filter((entry) => entry.startsWith(prefix)).sort();
  if (candidates.length === 0) return recoveryResult("clean");
  const authoritySnapshot = await readAuthoritySnapshot(paths);
  let authorityReadable = true;
  try {
    parseClaims(authoritySnapshot.raw);
  } catch {
    authorityReadable = false;
  }
  const removed: string[] = [];
  const preserved = new Set<string>();
  const invalid: { readonly name: string; readonly filePath: string; readonly identity: FileIdentity }[] = [];
  const valid: StageCandidate[] = [];
  for (const name of candidates) {
    const filePath = path.join(paths.directory, name);
    let stage: RegularFileRead;
    try {
      stage = await readRegularFileIfPresent(filePath, paths);
    } catch {
      preserved.add(name);
      continue;
    }
    if (stage.identity === undefined) {
      preserved.add(name);
      continue;
    }
    try {
      parseClaims(stage.text);
      valid.push({ name, filePath, raw: stage.text, identity: stage.identity });
    } catch {
      invalid.push({ name, filePath, identity: stage.identity });
    }
  }
  for (const stage of invalid) {
    if (await removeSafeStage(stage.filePath, stage.identity, paths)) removed.push(stage.name);
    else preserved.add(stage.name);
  }
  if (!authorityReadable || preserved.size > 0) {
    for (const stage of valid) preserved.add(stage.name);
    return recoveryResult("recovery-required", removed, [...preserved].sort());
  }
  const groups = new Map<string, StageCandidate[]>();
  for (const stage of valid) groups.set(stage.raw, [...(groups.get(stage.raw) ?? []), stage]);
  if (groups.size > 1) return recoveryResult("recovery-required", removed, valid.map((stage) => stage.name).sort());
  const group = groups.values().next().value as StageCandidate[] | undefined;
  if (group === undefined) return recoveryResult("clean", removed);
  const authority = authoritySnapshot.raw;
  const selected = group[0];
  if (selected.raw === authority) {
    for (const stage of group) {
      if (await removeSafeStage(stage.filePath, stage.identity, paths)) removed.push(stage.name);
      else preserved.add(stage.name);
    }
    return preserved.size === 0
      ? recoveryResult("clean", removed)
      : recoveryResult("recovery-required", removed, [...preserved].sort());
  }
  if (!selected.raw.startsWith(authority) || selected.raw.length <= authority.length) {
    return recoveryResult("recovery-required", removed, group.map((stage) => stage.name).sort());
  }
  await promoteStage(selected.filePath, paths.claimsFile, paths, authoritySnapshot);
  removed.push(selected.name);
  for (const duplicate of group.slice(1)) {
    if (await removeSafeStage(duplicate.filePath, duplicate.identity, paths)) removed.push(duplicate.name);
    else preserved.add(duplicate.name);
  }
  return preserved.size === 0
    ? recoveryResult("recovered", removed)
    : recoveryResult("recovery-required", removed, [...preserved].sort());
}

async function processExists(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function acquireLock(paths: KnowledgePaths): Promise<{
  readonly paths: KnowledgePaths;
  readonly release: () => Promise<void>;
}> {
  const currentPaths = await ensureKnowledgeDirectory(paths);
  const nonce = randomUUID();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const lockParent = await pinParent(currentPaths.lockDirectory, currentPaths);
      await assertParentStable(lockParent, currentPaths);
      await fs.mkdir(currentPaths.lockDirectory);
      await writePrivateFile(path.join(currentPaths.lockDirectory, "owner.json"), JSON.stringify({ pid: process.pid, nonce }), currentPaths);
      return {
        paths: currentPaths,
        release: async () => {
          try {
            const owner = JSON.parse((await readRegularFileIfPresent(path.join(currentPaths.lockDirectory, "owner.json"), currentPaths)).text);
            if (owner.nonce === nonce) {
              const releaseParent = await pinParent(currentPaths.lockDirectory, currentPaths);
              await assertParentStable(releaseParent, currentPaths);
              await fs.rm(currentPaths.lockDirectory, { recursive: true, force: true });
            }
          } catch (error) {
            if (!hasErrorCode(error, "ENOENT")) throw error;
          }
        }
      };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      let lockStat;
      try {
        await assertPinnedDirectories(currentPaths);
        lockStat = await fs.lstat(currentPaths.lockDirectory);
      } catch (lockError) {
        if (hasErrorCode(lockError, "ENOENT")) continue;
        throw lockError;
      }
      if (lockStat.isSymbolicLink() || !lockStat.isDirectory()) {
        throw new KnowledgeStoreError(`Unsafe knowledge lock at ${paths.lockDirectory}.`);
      }
      try {
        const ownerPath = path.join(currentPaths.lockDirectory, "owner.json");
        const owner = parseLockOwner(JSON.parse((await readRegularFileIfPresent(ownerPath, currentPaths, { allowMissing: false })).text), ownerPath);
        if (!(await processExists(owner.pid))) {
          const staleParent = await pinParent(currentPaths.lockDirectory, currentPaths);
          await assertParentStable(staleParent, currentPaths);
          await fs.rm(currentPaths.lockDirectory, { recursive: true, force: true });
          continue;
        }
      } catch (ownerError) {
        if (ownerError instanceof KnowledgeFileDisappearedError) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          continue;
        }
        if (isParentIdentityRace(ownerError, currentPaths.lockDirectory)) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          continue;
        }
        if (hasErrorCode(ownerError, "ENOENT")) {
          try {
            await assertPinnedDirectories(currentPaths);
            const currentLockStat = await fs.lstat(currentPaths.lockDirectory);
            if (currentLockStat.isSymbolicLink() || !currentLockStat.isDirectory()) {
              throw new KnowledgeStoreError(`Unsafe knowledge lock at ${paths.lockDirectory}.`);
            }
            if (!sameIdentity(identityOf(currentLockStat), identityOf(lockStat))) {
              await new Promise((resolve) => setTimeout(resolve, 5));
              continue;
            }
          } catch (lockError) {
            if (hasErrorCode(lockError, "ENOENT")) {
              await new Promise((resolve) => setTimeout(resolve, 5));
              continue;
            }
            throw lockError;
          }
        }
        throw ownerError;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new KnowledgeStoreError("Knowledge mutation lock timed out.");
}

async function appendRecord(
  paths: KnowledgePaths,
  record: KnowledgeRecord,
  expectedAuthority?: AuthoritySnapshot
): Promise<boolean> {
  const lock = await acquireLock(paths);
  try {
    const currentPaths = lock.paths;
    let authoritySnapshot = await readAuthoritySnapshot(currentPaths);
    const authorityChangedAfterObservation = expectedAuthority !== undefined && !sameAuthoritySnapshot(expectedAuthority, authoritySnapshot);
    const recovery = await recoverUnlocked(currentPaths);
    if (recovery.recoveryRequired) {
      throw new KnowledgeStoreError("Knowledge recovery is required before the next mutation.");
    }
    if (recovery.recovered) authoritySnapshot = await readAuthoritySnapshot(currentPaths);
    const authority = authoritySnapshot.raw;
    const current = latestRecords(parseClaims(authority)).get(record.id);
    if (current !== undefined && (record.state === "review-needed" || current.state === record.state)) return false;
    if (authorityChangedAfterObservation) throw new KnowledgeStoreError("Knowledge authority changed after the initial observation.");
    const line = `${authority !== "" && !authority.endsWith("\n") ? "\n" : ""}${JSON.stringify(record)}\n`;
    const stage = `${currentPaths.claimsFile}.tmp-${createHash("sha256").update(line).digest("hex").slice(0, 16)}`;
    await writePrivateFile(stage, `${authority}${line}`, currentPaths);
    await promoteStage(stage, currentPaths.claimsFile, currentPaths, authoritySnapshot);
    return true;
  } finally {
    await lock.release();
  }
}

function latestRecords(claims: readonly KnowledgeRecord[]): Map<string, KnowledgeRecord> {
  const latest = new Map<string, KnowledgeRecord>();
  for (const claim of claims) latest.set(claim.id, claim);
  return latest;
}

export async function readKnowledgeClaims(projectRoot: string): Promise<readonly KnowledgeRecord[]> {
  const raw = await readAuthority(knowledgePaths(projectRoot));
  return parseClaims(raw);
}

export async function recoverKnowledge(projectRoot: string): Promise<RecoveryResult> {
  const paths = knowledgePaths(projectRoot);
  if (!(await knowledgeDirectoryExists(paths))) return recoveryResult("clean");
  const lock = await acquireLock(paths);
  try {
    return await recoverUnlocked(lock.paths);
  } finally {
    await lock.release();
  }
}

export async function captureKnowledgeEvent(
  projectRoot: string,
  value: unknown,
  options: { readonly surface: string; readonly captureEnabled?: boolean; readonly now?: () => Date }
): Promise<KnowledgeCaptureResult> {
  if (options.captureEnabled === false) return { status: "disabled" };
  if (!validSurface(options.surface) || containsSecret(options.surface)) return { status: "rejected", reason: "INVALID_SURFACE" };
  const parsed = parseKnowledgeEvent(value);
  if (parsed.event === undefined) return { status: "rejected", reason: parsed.reason ?? "INVALID_EVENT" };
  const id = stableKnowledgeId(parsed.event);
  const paths = knowledgePaths(projectRoot);
  const authoritySnapshot = await readAuthoritySnapshot(paths);
  const latest = latestRecords(parseClaims(authoritySnapshot.raw));
  const existing = latest.get(id);
  if (existing !== undefined) return { status: "duplicate", record: existing };
  const record: KnowledgeRecord = Object.freeze({
    id,
    text: parsed.event.text,
    kind: parsed.event.kind,
    state: "review-needed",
    timestamp: (options.now?.() ?? new Date()).toISOString(),
    provenance: Object.freeze({ product: "litopencode", surface: options.surface, source: parsed.event.source }),
    evidence: Object.freeze({ ref: parsed.event.evidenceRef })
  });
  if (await appendRecord(paths, record, authoritySnapshot)) return { status: "captured", record };
  const duplicate = latestRecords(parseClaims(await readAuthority(paths))).get(id);
  return duplicate === undefined ? { status: "rejected", reason: "STORE_RACE" } : { status: "duplicate", record: duplicate };
}

export async function reviewKnowledgeRecord(
  projectRoot: string,
  input: { readonly id: string; readonly state: Exclude<KnowledgeState, "review-needed">; readonly surface: string; readonly now?: () => Date }
): Promise<KnowledgeReviewResult> {
  if (!/^kn_[a-f0-9]{24}$/u.test(input.id)) return { status: "blocked", reason: "INVALID_ID" };
  if (!(["accepted", "rejected", "stale"] as const).includes(input.state)) return { status: "blocked", reason: "INVALID_STATE" };
  if (!validSurface(input.surface) || containsSecret(input.surface)) return { status: "blocked", reason: "INVALID_SURFACE" };
  const paths = knowledgePaths(projectRoot);
  const authoritySnapshot = await readAuthoritySnapshot(paths);
  const existing = latestRecords(parseClaims(authoritySnapshot.raw)).get(input.id);
  if (existing === undefined) return { status: "blocked", reason: "UNKNOWN_ID" };
  if (existing.state === input.state) return { status: "duplicate", record: existing };
  const record: KnowledgeRecord = Object.freeze({
    ...existing,
    state: input.state,
    timestamp: (input.now?.() ?? new Date()).toISOString(),
    provenance: Object.freeze({ ...existing.provenance, surface: input.surface })
  });
  if (await appendRecord(paths, record, authoritySnapshot)) return { status: "updated", record };
  const duplicate = latestRecords(parseClaims(await readAuthority(paths))).get(input.id);
  return duplicate === undefined ? { status: "blocked", reason: "STORE_RACE" } : { status: "duplicate", record: duplicate };
}

function tokens(value: string): readonly string[] {
  return Array.from(new Set(value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}][\p{L}\p{N}._/-]*/gu) ?? []))
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function renderKnowledgeBlock(records: readonly KnowledgeRecord[], budgetBytes: number): string {
  const opening = "<litopencode-knowledge>\nAccepted project-local records follow as inert JSON lines.\n";
  const closing = "</litopencode-knowledge>";
  const lines: string[] = [];
  for (const record of records) {
    const line = JSON.stringify({
      id: record.id,
      kind: record.kind,
      text: record.text,
      timestamp: record.timestamp,
      provenance: record.provenance,
      evidence: record.evidence
    });
    const candidate = `${opening}${[...lines, line].join("\n")}\n${closing}`;
    if (utf8Bytes(candidate) > budgetBytes) break;
    lines.push(line);
  }
  return lines.length === 0 ? "" : `${opening}${lines.join("\n")}\n${closing}`;
}

export async function queryKnowledge(
  projectRoot: string,
  query: string,
  options: { readonly budgetBytes?: number } = {}
): Promise<KnowledgeQueryResult> {
  const requested = options.budgetBytes;
  const budgetBytes = requested === undefined || !Number.isFinite(requested)
    ? normalQueryBudgetBytes
    : Math.max(256, Math.min(hardQueryBudgetBytes, Math.floor(requested)));
  const queryTokens = tokens(query.slice(0, 4096));
  if (queryTokens.length === 0) return { text: "", records: [], budgetBytes, byteLength: 0 };
  const accepted = Array.from(latestRecords(await readKnowledgeClaims(projectRoot)).values())
    .filter((record) => record.state === "accepted")
    .map((record) => {
      const haystack = new Set(tokens(`${record.text} ${record.kind} ${record.evidence.ref}`));
      return { record, score: queryTokens.reduce((score, token) => score + (haystack.has(token) ? 1 : 0), 0) };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.record.timestamp.localeCompare(left.record.timestamp) || left.record.id.localeCompare(right.record.id));
  if (accepted.length === 0) return { text: "", records: [], budgetBytes, byteLength: 0 };
  const ordered = accepted.map((candidate) => candidate.record);
  const text = renderKnowledgeBlock(ordered, budgetBytes);
  if (text === "") return { text: "", records: [], budgetBytes, byteLength: 0 };
  const includedIds = new Set(Array.from(text.matchAll(/"id":"(kn_[a-f0-9]{24})"/gu), (match) => match[1]));
  const records = ordered.filter((record) => includedIds.has(record.id));
  return { text, records: Object.freeze(records), budgetBytes, byteLength: utf8Bytes(text) };
}

export async function inspectKnowledge(projectRoot: string): Promise<{
  readonly authority: "claims.jsonl";
  readonly path: string;
  readonly counts: Record<KnowledgeState, number>;
  readonly derivedTruthFiles: 0;
}> {
  const claims = await readKnowledgeClaims(projectRoot);
  const counts: Record<KnowledgeState, number> = { "review-needed": 0, accepted: 0, rejected: 0, stale: 0 };
  for (const record of latestRecords(claims).values()) counts[record.state] += 1;
  return {
    authority: "claims.jsonl",
    path: knowledgePaths(projectRoot).claimsFile,
    counts,
    derivedTruthFiles: 0
  };
}
