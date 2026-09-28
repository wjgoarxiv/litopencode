import { writeFileSync } from "node:fs";
import { createBoundedAuthorityLifecycle } from "../src/bounded-authority.ts";

const [projectRoot, requestId, action, delayText = "0", workId, sessionID, expectedRevisionText, readyPath] = process.argv.slice(2);
const delayMs = Number(delayText);
const lifecycle = createBoundedAuthorityLifecycle(projectRoot, {
  staleLockMs: 1000,
  lockTimeoutMs: 15000,
  now: () => {
    if (delayMs > 0) {
      if (readyPath) writeFileSync(readyPath, "ready\n", { flag: "wx" });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
    return new Date();
  }
});

try {
  const result = await lifecycle.pause({
    schemaVersion: 3,
    requestId,
    workId,
    sessionID,
    expectedRevision: Number(expectedRevisionText),
    boundary: { action, root: projectRoot }
  });
  process.stdout.write(JSON.stringify({ outcome: result.outcome, revision: result.state.revision }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    error: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error)
  }));
}
