import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { runCli, withTempDir } from "../test-support/cli-fixture.ts";

test("doctor projects model routes without exposing credential or prompt payloads", async () => {
  // Given: a valid custom route whose non-routing fields contain exact secret sentinels.
  await withTempDir(async (dir) => {
    const credentialSentinel = "LITOPENCODE_DOCTOR_CREDENTIAL_SENTINEL_7f4c";
    const promptSentinel = "LITOPENCODE_DOCTOR_PROMPT_SENTINEL_91a2";
    const filePath = path.join(dir, "litopencode.json");
    const before = JSON.stringify(
      {
        agents: {
          "lit-loop": {
            provider: "private-provider",
            model: "private-model",
            variant: "high",
            reasoningEffort: "high",
            promptAppend: promptSentinel,
            providerOptions: {
              apiKey: credentialSentinel,
              headers: { Authorization: `Bearer ${credentialSentinel}` }
            }
          }
        }
      },
      null,
      2
    ) + "\n";
    await fs.writeFile(filePath, before);

    // When: doctor, help, and an argument-error surface run beside that config.
    const doctor = runCli(["doctor", "--root", dir]);
    const help = runCli(["--help", "--root", dir]);
    const error = runCli(["doctor", "--root", dir, "--unsupported"]);

    // Then: only the minimal route projection is emitted and user config bytes stay intact.
    assert.equal(doctor.status, 0, doctor.stderr);
    for (const surface of [doctor.stdout, doctor.stderr, help.stdout, help.stderr, error.stdout, error.stderr]) {
      assert.doesNotMatch(surface, new RegExp(credentialSentinel));
      assert.doesNotMatch(surface, new RegExp(promptSentinel));
    }
    const output = JSON.parse(doctor.stdout);
    assert.deepEqual(output.opencodeConfig.effective["lit-loop"], {
      agentId: "lit-loop",
      provider: "private-provider",
      model: "private-provider/private-model",
      variant: "high",
      reasoningEffort: "high",
      status: "configured"
    });
    assert.doesNotMatch(JSON.stringify(output.opencodeConfig), /providerOptions|promptAppend|Authorization|apiKey/);
    assert.equal(await fs.readFile(filePath, "utf8"), before);
  });
});
