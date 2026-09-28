import assert from "node:assert/strict";
import { test } from "node:test";
import pkg from "../package.json" with { type: "json" };
import plugin, { pluginId, pluginModule } from "../src/index.ts";

test("scoped package preserves the native LitOpenCode plugin identity", async () => {
  assert.equal(pkg.name, "@litfamily/litopencode");
  assert.equal(pluginId, "litopencode");
  assert.equal(pluginModule.id, "litopencode");
  assert.equal(pluginModule.server, plugin);
  assert.deepEqual(Object.keys(await pluginModule.server()), [
    "config",
    "event",
    "tool",
    "chat.message",
    "command.execute.before",
    "experimental.text.complete",
    "experimental.chat.system.transform",
    "experimental.session.compacting",
    "dispose"
  ]);
});
