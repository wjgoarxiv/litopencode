import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The deck engine applies `faces` by default and `faces-a2z` on request. Any other face map in a pack
// is a setting nothing applies, so neither the packs nor the loader may carry one. The one pack that sets
// its titles and figures in the bundled mono face has no A2Z map: swapping that face is not offered.
test("deck packs carry only the face maps the engine applies", () => {
  const root = "skills/lit-pptx/templates/tonalities";
  const packs = readdirSync(root).map((id) => join(root, id, "pack.yaml"));
  assert.equal(packs.length, 13);
  for (const pack of packs) {
    const faceMaps = readFileSync(pack, "utf8").match(/^faces[\w-]*(?=:)/gmu) ?? [];
    assert.deepEqual(faceMaps, pack.includes("/computational-brutalism/") ? ["faces"] : ["faces", "faces-a2z"], pack);
  }
  assert.doesNotMatch(readFileSync("skills/lit-pptx/scripts/lib/template-registry.js", "utf8"), /faces-pretendard-only/u);
});
