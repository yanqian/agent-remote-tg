import test from "node:test";
import assert from "node:assert/strict";
import { commandList } from "../../src/commands.js";
import { HELP_RESPONSE } from "../../src/constants.js";

test("command whitelist does not include prohibited feature commands", () => {
  assert.equal(commandList().includes("/run-feature"), false);
  assert.equal(commandList().includes("/eval-feature"), false);
  assert.equal(commandList().includes("/run-orch"), false);
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
    "/run_orch",
    "/status",
    "/logs",
    "/stop",
    "/help",
  ]);
});

test("help output exactly matches the documented command surface", () => {
  assert.equal(HELP_RESPONSE, [
    "Available commands:",
    "/repos - list configured repositories",
    "/use <repo> - select a repository",
    "/pwd - show the selected workspace",
    "/ls - list files in the selected workspace",
    "/git - show branch, status, and recent commits",
    "/ask <question> - start a read-only Codex discussion task",
    "/work <requirement> - delegate a repository workflow task",
    "/continue <instruction> - resume or recover repository workflow",
    "/run_orch <rounds> - run 1 to 5 orchestrator rounds",
    "/status - show active and recent tasks",
    "/logs <task_id> - show the task final result",
    "/stop <task_id> - stop a running Bot-recorded task",
    "/help - show this command list",
  ].join("\n"));
});
