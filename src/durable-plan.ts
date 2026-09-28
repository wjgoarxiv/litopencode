import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PLAN_DIRECTORY = path.join(".litopencode", "plans");
const MAX_PLAN_BYTES = 256 * 1024;
const MAX_ARGUMENT_BYTES = 512 * 1024;
const PLAN_HEADER_PREFIX = "<!-- litopencode-durable-plan: ";
const PLAN_HEADER_SUFFIX = " -->";
const PLAN_LOCK_OWNER = "owner.json";
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

type DurablePlanMetadata = {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly requestId: string;
  readonly revision: number;
  readonly approved: true;
  readonly status: "active";
  readonly savedAt: string;
  readonly expiresAt?: string;
  readonly digest: string;
};

export type ApprovedPlanRequest = {
  readonly schemaVersion: 1;
  readonly slug: string;
  readonly markdown: string;
  readonly approved: true;
  readonly requestId: string;
  readonly revision: number;
  readonly expiresAt?: string;
};

export type DurablePlan = {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly text: string;
  readonly requestId: string;
  readonly revision: number;
  readonly expiresAt?: string;
  readonly replayed?: boolean;
};

type StoredPlan = {
  readonly metadata: DurablePlanMetadata;
  readonly text: string;
};

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function acquirePlanLock(lockPath: string): Promise<() => Promise<void>> {
  const token = randomUUID();
  while (true) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      break;
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      let stat;
      try {
        stat = await fs.lstat(lockPath);
      } catch (lockError) {
        if (hasErrorCode(lockError, "ENOENT")) continue;
        throw lockError;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("unsafe plan persistence lock");
      throw new Error("plan persistence lock is held");
    }
  }

  const ownerPath = path.join(lockPath, PLAN_LOCK_OWNER);
  try {
    await fs.writeFile(ownerPath, `${JSON.stringify({ token, pid: process.pid })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    await fs.rmdir(lockPath).catch(() => undefined);
    throw error;
  }

  return async () => {
    let stat;
    try {
      stat = await fs.lstat(ownerPath);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("unsafe plan persistence lock owner");
    let owner: unknown;
    try {
      owner = JSON.parse(await fs.readFile(ownerPath, "utf8"));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return;
      throw error;
    }
    if (!isRecord(owner) || owner.token !== token) return;
    await fs.rm(ownerPath, { force: true });
    await fs.rmdir(lockPath).catch((error: unknown) => {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 64;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function normalizeMarkdown(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
}

function validExpiry(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function validSavedAt(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateRequest(request: ApprovedPlanRequest): string {
  if (!isSafeSlug(request.slug)) return "plan slug must be a lowercase hyphenated identifier";
  if (request.schemaVersion !== 1) return "plan schemaVersion must be 1";
  if (request.approved !== true) return "plan approval must be explicit";
  if (typeof request.markdown !== "string" || request.markdown.trim() === "") return "plan markdown must be non-empty";
  if (!SAFE_REQUEST_ID.test(request.requestId)) return "plan requestId is invalid";
  if (!Number.isSafeInteger(request.revision) || request.revision < 1) return "plan revision must be a positive integer";
  if (request.expiresAt !== undefined && !validExpiry(request.expiresAt)) return "plan expiry is stale or invalid";
  const body = normalizeMarkdown(request.markdown);
  const header = `${PLAN_HEADER_PREFIX}${JSON.stringify({
    schemaVersion: 1,
    slug: request.slug,
    requestId: request.requestId,
    revision: request.revision,
    approved: true,
    status: "active",
    savedAt: new Date().toISOString(),
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    digest: digest(body)
  })}${PLAN_HEADER_SUFFIX}\n`;
  if (Buffer.byteLength(header + body, "utf8") > MAX_PLAN_BYTES) return "plan markdown exceeds the durable size bound";
  return "";
}

function requestFromRecord(value: Record<string, unknown>): ApprovedPlanRequest | undefined {
  const schemaVersion = value.schemaVersion === undefined ? 1 : value.schemaVersion;
  const revision = value.revision === undefined ? 1 : value.revision;
  const requestId = value.requestId === undefined && typeof value.slug === "string" && typeof value.markdown === "string"
    ? `save-${digest(`${value.slug}\u0000${value.markdown}\u0000${String(revision)}`).slice(0, 32)}`
    : value.requestId;
  if (
    schemaVersion !== 1 ||
    value.approved !== true ||
    typeof value.slug !== "string" ||
    typeof value.markdown !== "string" ||
    typeof requestId !== "string" ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision)
  ) return undefined;
  if (value.expiresAt !== undefined && typeof value.expiresAt !== "string") return undefined;
  const request: ApprovedPlanRequest = {
    schemaVersion: 1,
    slug: value.slug,
    markdown: value.markdown,
    approved: true,
    requestId,
    revision,
    ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt })
  };
  return validateRequest(request) === "" ? request : undefined;
}

export function parsePlanSaveArgument(argumentsText: string): ApprovedPlanRequest | undefined {
  if (typeof argumentsText !== "string" || Buffer.byteLength(argumentsText, "utf8") > MAX_ARGUMENT_BYTES) return undefined;
  const match = /^save-plan\s+([\s\S]+)$/u.exec(argumentsText.trim());
  if (match === null) return undefined;
  try {
    const value: unknown = JSON.parse(match[1]);
    return isRecord(value) ? requestFromRecord(value) : undefined;
  } catch {
    return undefined;
  }
}

function metadataFromRequest(request: ApprovedPlanRequest, body: string): DurablePlanMetadata {
  return {
    schemaVersion: 1,
    slug: request.slug,
    requestId: request.requestId,
    revision: request.revision,
    approved: true,
    status: "active",
    savedAt: new Date().toISOString(),
    ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
    digest: digest(body)
  };
}

function serializePlan(metadata: DurablePlanMetadata, body: string): Buffer {
  return Buffer.from(
    `${PLAN_HEADER_PREFIX}${JSON.stringify(metadata)}${PLAN_HEADER_SUFFIX}\n${body}`,
    "utf8"
  );
}

function validMetadata(value: unknown, slug: string, body: string): value is DurablePlanMetadata {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== 1 ||
    value.slug !== slug ||
    typeof value.requestId !== "string" ||
    !SAFE_REQUEST_ID.test(value.requestId) ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    value.approved !== true ||
    value.status !== "active" ||
    !validSavedAt(value.savedAt) ||
    (value.expiresAt !== undefined && !validExpiry(value.expiresAt)) ||
    typeof value.digest !== "string" ||
    !SHA256.test(value.digest) ||
    value.digest !== digest(body)
  ) return false;
  return true;
}

function parseStoredPlan(text: string, slug: string): StoredPlan | undefined {
  const newline = text.indexOf("\n");
  if (newline < 0) return undefined;
  const header = text.slice(0, newline);
  if (!header.startsWith(PLAN_HEADER_PREFIX) || !header.endsWith(PLAN_HEADER_SUFFIX)) return undefined;
  let metadata: unknown;
  try {
    metadata = JSON.parse(header.slice(PLAN_HEADER_PREFIX.length, -PLAN_HEADER_SUFFIX.length));
  } catch {
    return undefined;
  }
  const body = text.slice(newline + 1);
  if (body.trim() === "" || !validMetadata(metadata, slug, body)) return undefined;
  return { metadata, text: body };
}

async function readStoredPlan(filePath: string, slug: string): Promise<StoredPlan | undefined> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_PLAN_BYTES) return undefined;
  try {
    return parseStoredPlan(await fs.readFile(filePath, "utf8"), slug);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}

function toDurablePlan(directory: string, name: string, stored: StoredPlan): DurablePlan {
  return {
    relativePath: path.join(PLAN_DIRECTORY, name),
    absolutePath: path.join(directory, name),
    text: stored.text,
    requestId: stored.metadata.requestId,
    revision: stored.metadata.revision,
    ...(stored.metadata.expiresAt === undefined ? {} : { expiresAt: stored.metadata.expiresAt })
  };
}

export async function persistApprovedPlan(
  projectRoot: string,
  request: ApprovedPlanRequest
): Promise<DurablePlan> {
  const validationError = validateRequest(request);
  if (validationError !== "") throw new Error(validationError);

  const body = normalizeMarkdown(request.markdown);
  const directory = path.join(projectRoot, PLAN_DIRECTORY);
  const name = `${request.slug}.md`;
  const absolutePath = path.join(directory, name);
  const lockPath = `${absolutePath}.lock`;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const releaseLock = await acquirePlanLock(lockPath);
  try {
    const existing = await readStoredPlan(absolutePath, request.slug);
    if (existing !== undefined) {
      if (existing.metadata.requestId === request.requestId) {
        if (existing.metadata.revision === request.revision && existing.metadata.digest === digest(body)) {
          return { ...toDurablePlan(directory, name, existing), replayed: true };
        }
        throw new Error("repeated plan request conflicts with the existing durable plan");
      }
      if (request.revision <= existing.metadata.revision) throw new Error("stale plan revision");
    } else {
      try {
        await fs.lstat(absolutePath);
        throw new Error("plan target exists but is not a valid approved durable plan");
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) throw error;
      }
    }

    const metadata = metadataFromRequest(request, body);
    const encoded = serializePlan(metadata, body);
    if (encoded.byteLength > MAX_PLAN_BYTES) throw new Error("plan markdown exceeds the durable size bound");
    const staging = `${absolutePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(staging, encoded, { flag: "wx", mode: 0o600 });
      await fs.rename(staging, absolutePath);
    } finally {
      await fs.rm(staging, { force: true });
    }
    return { ...toDurablePlan(directory, name, { metadata, text: body }), replayed: false };
  } finally {
    await releaseLock();
  }
}

export async function resolveLatestDurablePlan(projectRoot: string): Promise<DurablePlan | undefined> {
  const directory = path.join(projectRoot, PLAN_DIRECTORY);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  const candidates: Array<{ readonly plan: DurablePlan; readonly savedAt: number }> = [];
  for (const name of names) {
    if (!name.endsWith(".md") || !isSafeSlug(name.slice(0, -3))) continue;
    const absolutePath = path.join(directory, name);
    try {
      const stored = await readStoredPlan(absolutePath, name.slice(0, -3));
      if (stored === undefined) continue;
      candidates.push({
        plan: toDurablePlan(directory, name, stored),
        savedAt: Date.parse(stored.metadata.savedAt)
      });
    } catch {
      continue;
    }
  }
  candidates.sort(
    (left, right) => right.savedAt - left.savedAt || right.plan.revision - left.plan.revision || left.plan.relativePath.localeCompare(right.plan.relativePath)
  );
  return candidates[0]?.plan;
}

export function formatResolvedPlanNotice(plan: DurablePlan): string {
  return `Durable plan: ${plan.relativePath}. Discovery only. This does not grant start-work authority.\n\n<durable-plan>\n${plan.text}</durable-plan>`;
}

export function formatSavedPlanNotice(plan: DurablePlan, replayed: boolean): string {
  const verb = replayed ? "Durable plan already persisted" : "Saved durable plan";
  return `${verb}: ${plan.relativePath}. Discovery only. This does not grant start-work authority.`;
}
