import test from "node:test";
import assert from "node:assert/strict";
import { commandList, parseCommand } from "../../src/commands.js";
import { COMMANDS, HELP_RESPONSE, UNKNOWN_COMMAND_RESPONSE } from "../../src/constants.js";

test("commandList exposes the documented command whitelist", () => {
  assert.deepEqual(commandList(), COMMANDS);
});

test("parseCommand accepts commands without arguments", () => {
  assert.deepEqual(parseCommand(" /repos "), {
    ok: true,
    command: "/repos",
    args: "",
  });
});

test("parseCommand trims required arguments", () => {
  assert.deepEqual(parseCommand("/use   agent-runtime  "), {
    ok: true,
    command: "/use",
    args: "agent-runtime",
  });
});

test("parseCommand rejects unknown slash commands", () => {
  assert.deepEqual(parseCommand("/run-feature F001"), {
    ok: false,
    response: UNKNOWN_COMMAND_RESPONSE,
  });
  assert.deepEqual(parseCommand("/run-orch 1"), {
    ok: false,
    response: UNKNOWN_COMMAND_RESPONSE,
  });
  assert.deepEqual(parseCommand("/ask Explain"), {
    ok: false,
    response: UNKNOWN_COMMAND_RESPONSE,
  });
  assert.deepEqual(parseCommand("/work Add docs"), {
    ok: false,
    response: UNKNOWN_COMMAND_RESPONSE,
  });
  assert.deepEqual(parseCommand("/run_orch 1"), {
    ok: false,
    response: UNKNOWN_COMMAND_RESPONSE,
  });
});

test("parseCommand rejects missing required arguments", () => {
  assert.deepEqual(parseCommand("/use   "), {
    ok: false,
    response: "Usage: /use <repo>",
  });
  assert.deepEqual(parseCommand("/agent   "), {
    ok: false,
    response: "Usage: /agent <instruction> | /agent new <instruction> | /agent resume <session_id|--last> <instruction> | /agent exit | /agent session | /agent -- <instruction>",
  });
  assert.deepEqual(parseCommand("/approve   "), {
    ok: false,
    response: "Usage: /approve <request_id>",
  });
});

test("parseCommand rejects non-command text", () => {
  assert.deepEqual(parseCommand("hello"), {
    ok: false,
    response: UNKNOWN_COMMAND_RESPONSE,
  });
});

test("help response documents the exact command surface", () => {
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
    "/status - show active and recent tasks",
    "/logs <task_id> - show the task final result",
    "/stop <task_id> - stop a running Bot-recorded task",
    "/help - show this command list",
  ].join("\n"));
});
