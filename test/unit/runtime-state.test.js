import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidCodexSessionId,
  loadRuntimeState,
  normalizeRuntimeState,
  saveRuntimeState,
  updateAskSessionBinding,
} from "../../src/runtime-state.js";

test("loadRuntimeState creates default state when missing", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-state-"));
  const statePath = join(rootDir, "runtime_state.json");
  try {
    const state = loadRuntimeState(statePath);
    assert.deepEqual(state, { currentRepo: null, cwd: null, tasks: {}, askSessions: {}, telegramUpdateOffset: null });
    assert.equal(existsSync(statePath), true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("saveRuntimeState writes normalized JSON", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-state-"));
  const statePath = join(rootDir, "runtime_state.json");
  try {
    saveRuntimeState(statePath, {
      currentRepo: "repo",
      cwd: "/tmp/repo",
      tasks: { task_1: { status: "running" } },
      askSessions: {
        "123": {
          app: { codexSessionId: "session_abc123" },
        },
      },
      telegramUpdateOffset: 44,
      ignored: true,
    });
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(parsed, {
      currentRepo: "repo",
      cwd: "/tmp/repo",
      tasks: { task_1: { status: "running" } },
      askSessions: {
        "123": {
          app: { codexSessionId: "session_abc123" },
        },
      },
      telegramUpdateOffset: 44,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("normalizeRuntimeState rejects invalid shapes", () => {
  assert.deepEqual(normalizeRuntimeState(null), {
    currentRepo: null,
    cwd: null,
    tasks: {},
    askSessions: {},
    telegramUpdateOffset: null,
  });
  assert.deepEqual(normalizeRuntimeState([]), {
    currentRepo: null,
    cwd: null,
    tasks: {},
    askSessions: {},
    telegramUpdateOffset: null,
  });
  assert.equal(normalizeRuntimeState({ telegramUpdateOffset: -1 }).telegramUpdateOffset, null);
  assert.equal(normalizeRuntimeState({ telegramUpdateOffset: 12.5 }).telegramUpdateOffset, null);
});

test("normalizeRuntimeState preserves valid ask session bindings only", () => {
  const normalized = normalizeRuntimeState({
    askSessions: {
      "123": {
        app: { codexSessionId: "session_abc123" },
        bad: { codexSessionId: "../secret" },
      },
      "bad/chat": {
        app: { codexSessionId: "session_wrong" },
      },
    },
  });

  assert.deepEqual(normalized.askSessions, {
    "123": {
      app: { codexSessionId: "session_abc123" },
    },
  });
});

test("updateAskSessionBinding stores bindings by chat ID and repository alias", () => {
  const updated = updateAskSessionBinding({
    currentRepo: "app",
    cwd: "/tmp/app",
    tasks: {},
    askSessions: {
      "123": {
        old: { codexSessionId: "session_old123" },
      },
    },
    telegramUpdateOffset: 8,
  }, {
    chatId: "123",
    repoAlias: "app",
    codexSessionId: "session_new123",
  });

  assert.deepEqual(updated.askSessions, {
    "123": {
      old: { codexSessionId: "session_old123" },
      app: { codexSessionId: "session_new123" },
    },
  });
  assert.equal(updated.telegramUpdateOffset, 8);
});

test("isValidCodexSessionId rejects unsafe values", () => {
  assert.equal(isValidCodexSessionId("session_abc123"), true);
  assert.equal(isValidCodexSessionId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidCodexSessionId("../secret"), false);
  assert.equal(isValidCodexSessionId("short"), false);
});
