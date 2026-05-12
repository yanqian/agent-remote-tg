import test from "node:test";
import assert from "node:assert/strict";
import { commandList, parseCommand } from "../../src/commands.js";
import { COMMANDS, UNKNOWN_COMMAND_RESPONSE } from "../../src/constants.js";

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
});

test("parseCommand rejects missing required arguments", () => {
  assert.deepEqual(parseCommand("/use   "), {
    ok: false,
    response: "Usage: /use <repo>",
  });
});

test("parseCommand rejects non-command text", () => {
  assert.deepEqual(parseCommand("hello"), {
    ok: false,
    response: UNKNOWN_COMMAND_RESPONSE,
  });
});
