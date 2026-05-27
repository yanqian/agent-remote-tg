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
  assert.equal(commandList().includes("/continue"), false);
});

test("command whitelist matches the documented current surface", () => {
  assert.deepEqual(commandList(), [
    "/repos",
    "/use",
    "/pwd",
    "/ls",
    "/git",
    "/git_commit_push",
    "/agent",
    "/approve",
    "/reject",
    "/always_allow",
    "/always_reject",
    "/approval_test",
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
    "/git_commit_push <message> - commit and push selected workspace changes after approval",
    "/agent <instruction> - start or continue a Codex agent task",
    "/agent new <instruction> - force a new agent session",
    "/agent resume <session_id|--last> <instruction> - resume an agent session",
    "/agent exit - leave agent chat mode",
    "/agent session - show the selected agent session",
    "/agent -- <instruction> - send a literal instruction beginning with a reserved word",
    "/approve <request_id> - approve a pending agent request",
    "/reject <request_id> - reject a pending agent request",
    "/always_allow <request_id> - approve and remember a future allow rule",
    "/always_reject <request_id> - reject and remember a future reject rule",
    "/approval_test - create a safe Bot-local approval request",
    "/status - show active and recent tasks",
    "/logs <task_id> - show the task final result",
    "/stop <task_id> - stop a running Bot-recorded task",
    "/help - show this command list",
  ].join("\n"));
});
