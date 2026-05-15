import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertStartupEnv,
  createStartupContext,
  parseAllowedChatIds,
  parseAgentTaskTimeoutMs,
} from "../../src/config.js";

test("parseAllowedChatIds trims comma-separated values", () => {
  assert.deepEqual(parseAllowedChatIds(" 123,456 ,, 789 "), ["123", "456", "789"]);
});

test("parseAgentTaskTimeoutMs accepts empty or positive integer millisecond values", () => {
  assert.equal(parseAgentTaskTimeoutMs(undefined), null);
  assert.equal(parseAgentTaskTimeoutMs(""), null);
  assert.equal(parseAgentTaskTimeoutMs(" 3600000 "), 3600000);
});

test("parseAgentTaskTimeoutMs rejects invalid configured values", () => {
  assert.throws(() => parseAgentTaskTimeoutMs("0"), /AGENT_TASK_TIMEOUT_MS/);
  assert.throws(() => parseAgentTaskTimeoutMs("-1"), /AGENT_TASK_TIMEOUT_MS/);
  assert.throws(() => parseAgentTaskTimeoutMs("1.5"), /AGENT_TASK_TIMEOUT_MS/);
  assert.throws(() => parseAgentTaskTimeoutMs("ten"), /AGENT_TASK_TIMEOUT_MS/);
});

test("assertStartupEnv requires TELEGRAM_BOT_TOKEN", () => {
  assert.throws(
    () => assertStartupEnv({ NODE_ENV: "test", ALLOWED_CHAT_IDS: "" }),
    /TELEGRAM_BOT_TOKEN is required/,
  );
});

test("assertStartupEnv rejects empty ALLOWED_CHAT_IDS outside test mode", () => {
  assert.throws(
    () => assertStartupEnv({ TELEGRAM_BOT_TOKEN: "token", NODE_ENV: "production", ALLOWED_CHAT_IDS: "" }),
    /ALLOWED_CHAT_IDS must be non-empty/,
  );
});

test("assertStartupEnv permits empty ALLOWED_CHAT_IDS in test mode", () => {
  const config = assertStartupEnv({
    TELEGRAM_BOT_TOKEN: "token",
    NODE_ENV: "test",
    ALLOWED_CHAT_IDS: "",
  });
  assert.deepEqual(config.allowedChatIds, []);
  assert.equal(config.agentTaskTimeoutMs, null);
});

test("assertStartupEnv parses AGENT_TASK_TIMEOUT_MS", () => {
  const config = assertStartupEnv({
    TELEGRAM_BOT_TOKEN: "token",
    NODE_ENV: "test",
    ALLOWED_CHAT_IDS: "",
    AGENT_TASK_TIMEOUT_MS: "3600000",
  });
  assert.equal(config.agentTaskTimeoutMs, 3600000);
});

test("createStartupContext creates logs directory", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-config-"));
  try {
    const context = createStartupContext(
      { TELEGRAM_BOT_TOKEN: "token", NODE_ENV: "test", ALLOWED_CHAT_IDS: "" },
      { rootDir },
    );
    assert.equal(existsSync(context.logsDir), true);
    assert.equal(context.statePath.endsWith("runtime_state.json"), true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
