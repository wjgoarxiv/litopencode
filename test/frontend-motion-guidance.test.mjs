import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { test } from "node:test";

test("motion guidance verifies requested scroll choreography as a real scroll change", async () => {
  const body = await fs.readFile("skills/frontend-ui-ux/references/motion-guide.md", "utf8");
  assert.match(body, /When a brief explicitly requests scroll-driven choreography, implement a visible page-state change triggered by scrolling\./u);
  assert.match(body, /Verify the change at multiple scroll positions across distinct content sections\./u);
  assert.match(body, /A one-time entrance reveal does not satisfy a scroll-choreography requirement/u);
  assert.match(body, /reduced-motion/u);
});
