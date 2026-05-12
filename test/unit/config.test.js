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
} from "../../src/config.js";

test("parseAllowedChatIds trims comma-separated values", () => {
  assert.deepEqual(parseAllowedChatIds(" 123,456 ,, 789 "), ["123", "456", "789"]);
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
