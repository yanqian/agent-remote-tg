import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.js";

test("app rejects unauthorized messages before parsing commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
    });
    assert.equal(app.handleMessage({ chatId: "999", text: "/repos" }), "Unauthorized chat.");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app handles /repos, /use, and /pwd with persisted runtime state", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/repos" }), `Available repos:\n- app -> ${repoDir}`);
    assert.equal(app.handleMessage({ chatId: "123", text: "/pwd" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(app.handleMessage({ chatId: "123", text: "/pwd" }), repoDir);

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.currentRepo, "app");
    assert.equal(state.cwd, repoDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app rejects unknown commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
    });
    assert.equal(app.handleMessage({ chatId: "123", text: "/eval-feature F001" }), "Unknown command.\nUse /help.");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
