import http from "node:http";
import https from "node:https";
import type { PublicSourceResolvedAddress } from "./lit-fetch.ts";

export type PublicSourceHttpResponse = {
  readonly status: number;
  readonly location?: string;
  readonly contentType?: string;
  readonly text: string;
  readonly tooLarge: boolean;
};

export function isPublicSourceRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function requestPublicSourceUrl(
  url: URL,
  addresses: readonly PublicSourceResolvedAddress[] | undefined,
  timeoutMs: number,
  maxBytes: number
): Promise<PublicSourceHttpResponse> {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url.toString());
    requestUrl.username = "";
    requestUrl.password = "";
    const client = requestUrl.protocol === "https:" ? https : http;
    const selected = addresses?.[0];
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
    const deadline = setTimeout(() => {
      request.destroy(new Error("timeout while reading public source"));
    }, timeoutMs);
    const request = client.request(requestUrl, {
      method: "GET",
      headers: { "user-agent": "litopencode-lit-fetch" },
      lookup: selected
        ? (_hostname, options, callback) => {
            const lookupCallback = typeof options === "function" ? options : callback;
            const lookupOptions = typeof options === "function" ? undefined : options;
            if (!lookupCallback) return;
            if (lookupOptions && "all" in lookupOptions && lookupOptions.all === true) {
              lookupCallback(null, [{ address: selected.address, family: selected.family }]);
              return;
            }
            lookupCallback(null, selected.address, selected.family);
          }
        : undefined
    }, (response) => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          finish(() => {
            response.destroy();
            request.destroy();
            resolve({
              status: response.statusCode ?? 0,
              location: headerValue(response.headers.location),
              contentType: headerValue(response.headers["content-type"])?.split(";")[0]?.trim().toLowerCase(),
              text: "",
              tooLarge: true
            });
          });
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => {
        finish(() => {
          resolve({
            status: response.statusCode ?? 0,
            location: headerValue(response.headers.location),
            contentType: headerValue(response.headers["content-type"])?.split(";")[0]?.trim().toLowerCase(),
            text: Buffer.concat(chunks).toString("utf8"),
            tooLarge: false
          });
        });
      });
      response.on("error", (error) => finish(() => reject(error)));
    });
    request.on("error", (error) => finish(() => reject(error)));
    request.end();
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
