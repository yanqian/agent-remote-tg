import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../../src/index.js";

test("start loads repository whitelist from REPO_WHITELIST_JSON", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-start-"));
  const repoDir = join(rootDir, "repo");
  try {
    mkdirSync(repoDir);
    const result = start(
      {
        TELEGRAM_BOT_TOKEN: "token",
        ALLOWED_CHAT_IDS: "123",
        NODE_ENV: "test",
        REPO_WHITELIST_JSON: JSON.stringify({ app: "repo" }),
        PORT: "3010",
      },
      { rootDir },
    );
    assert.equal(result.repoCount, 1);
    assert.equal(result.port, 3010);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("start rejects invalid repository whitelist configuration", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-start-"));
  try {
    assert.throws(
      () => start({
        TELEGRAM_BOT_TOKEN: "token",
        ALLOWED_CHAT_IDS: "123",
        NODE_ENV: "test",
        REPO_WHITELIST_JSON: "{",
      }, { rootDir }),
      /REPO_WHITELIST_JSON must be valid JSON/,
    );

    assert.throws(
      () => start({
        TELEGRAM_BOT_TOKEN: "token",
        ALLOWED_CHAT_IDS: "123",
        NODE_ENV: "test",
        REPO_WHITELIST_JSON: JSON.stringify({ "../repo": rootDir }),
      }, { rootDir }),
      /Invalid repo alias/,
    );

    assert.throws(
      () => start({
        TELEGRAM_BOT_TOKEN: "token",
        ALLOWED_CHAT_IDS: "123",
        NODE_ENV: "test",
        REPO_WHITELIST_JSON: JSON.stringify({ missing: "missing" }),
      }, { rootDir }),
      /Repo path is not available: missing/,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
