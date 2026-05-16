import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("AGENTS external behavior verification rule preserves core requirements", () => {
  const agents = readFileSync("AGENTS.md", "utf8");
  const section = agents.match(/# External Behavior Verification[\s\S]*?---/);

  assert.ok(section, "AGENTS.md must contain the External Behavior Verification section");

  const text = section[0];
  assert.match(text, /must verify that behavior before relying on it/);
  assert.match(text, /Do not infer unknown external behavior from intuition or local mocks/);
  assert.match(text, /mocks and fake children as tests of this repository's state machine only/);
  assert.match(text, /do not prove the external tool or platform behaves that way/);
  assert.match(text, /argv, stdio, cwd, env, timeout, signal handling, or shell mode/);
  assert.match(text, /verify the real command behavior or document why direct verification is not possible/);
  assert.match(text, /structured output fields/);
  assert.match(text, /real-shaped output from the source/);
  assert.match(text, /regression tests using those captured shapes/);
});
