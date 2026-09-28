import { spawnSync } from "node:child_process";

export function validateXmlWithXmllint(testContext, xml, spawn = spawnSync) {
  const result = spawn("xmllint", ["--noout", "-"], { input: xml, encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    testContext.skip("xmllint unavailable; strict XML validation skipped");
    return false;
  }
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "xmllint rejected XML");
  return true;
}
