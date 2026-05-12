import test from "node:test";
import assert from "node:assert/strict";
import { commandList } from "../../src/commands.js";

test("command whitelist does not include prohibited feature commands", () => {
  assert.equal(commandList().includes("/run-feature"), false);
  assert.equal(commandList().includes("/eval-feature"), false);
});

test("command whitelist matches the documented current surface", () => {
  assert.deepEqual(commandList(), [
    "/repos",
    "/use",
    "/pwd",
    "/ls",
    "/git",
    "/ask",
    "/work",
    "/continue",
    "/run-orch",
    "/status",
    "/logs",
    "/stop",
    "/help",
  ]);
});
