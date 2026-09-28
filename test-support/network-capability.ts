import { createServer } from "node:http";

async function probeLocalListenSupported(): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code: string }).code : undefined;
    return code !== "EPERM" && code !== "EACCES";
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
  return true;
}

// Some sandboxes deny binding even a loopback listener (EPERM). The explicit test-only
// override lets the scoping regression prove that no-network security tests still run.
const forceLocalListenDenied = process.env.LITOPENCODE_TEST_FORCE_LOCAL_LISTEN_DENIED === "1";
export const localListenSupported = forceLocalListenDenied ? false : await probeLocalListenSupported();
export const localListenSkipReason: string | false = localListenSupported
  ? false
  : "sandbox denies local loopback listen (EPERM)";
