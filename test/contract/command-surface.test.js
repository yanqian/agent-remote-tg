import test from "node:test";
import assert from "node:assert/strict";
import { commandList } from "../../src/commands.js";
import { HELP_RESPONSE } from "../../src/constants.js";

test("command whitelist does not include prohibited feature commands", () => {
  assert.equal(commandList().includes("/run-feature"), false);
  assert.equal(commandList().includes("/eval-feature"), false);
  assert.equal(commandList().includes("/run-orch"), false);
  assert.equal(commandList().includes("/ask"), false);
  assert.equal(commandList().includes("/work"), false);
  assert.equal(commandList().includes("/run_orch"), false);
});

test("command whitelist matches the documented current surface", () => {
  assert.deepEqual(commandList(), [
    "/repos",
    "/use",
    "/pwd",
    "/ls",
    "/git",
    "/agent",
    "/continue",
    "/approve",
    "/reject",
    "/always_allow",
    "/always_reject",
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
    "/agent <instruction> - start or continue a Codex agent task",
    "/agent new <instruction> - force a new agent session",
    "/agent resume <session_id|--last> <instruction> - resume an agent session",
    "/agent exit - clear the selected agent session",
    "/agent session - show the selected agent session",
    "/agent -- <instruction> - send a literal instruction beginning with a reserved word",
    "/continue <instruction> - resume or recover repository workflow",
    "/approve <request_id> - approve a pending agent request",
    "/reject <request_id> - reject a pending agent request",
    "/always_allow <request_id> - approve and remember a future allow rule",
    "/always_reject <request_id> - reject and remember a future reject rule",
    "/status - show active and recent tasks",
    "/logs <task_id> - show the task final result",
    "/stop <task_id> - stop a running Bot-recorded task",
    "/help - show this command list",
  ].join("\n"));
});
