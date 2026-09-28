import { createServer } from "node:http";
import { readFileSync, lstatSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.argv[2]);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };
const server = createServer((request, response) => {
  let target;
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + sep)) throw new Error("outside root");
    if (!statSync(target).isFile() || lstatSync(target).isSymbolicLink()) throw new Error("not a regular file");
  } catch {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(target)] ?? "application/octet-stream",
    "content-security-policy": "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' data:; img-src 'self' data: blob:; font-src 'self' data:",
  });
  response.end(readFileSync(target));
});
server.listen(0, "127.0.0.1", () => process.stdout.write(`LISTENING ${server.address().port}\n`));
