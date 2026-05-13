import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRuntimeState,
  normalizeRuntimeState,
  saveRuntimeState,
} from "../../src/runtime-state.js";

test("loadRuntimeState creates default state when missing", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-state-"));
  const statePath = join(rootDir, "runtime_state.json");
  try {
    const state = loadRuntimeState(statePath);
    assert.deepEqual(state, { currentRepo: null, cwd: null, tasks: {}, telegramUpdateOffset: null });
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
      telegramUpdateOffset: 44,
      ignored: true,
    });
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(parsed, {
      currentRepo: "repo",
      cwd: "/tmp/repo",
      tasks: { task_1: { status: "running" } },
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
    telegramUpdateOffset: null,
  });
  assert.deepEqual(normalizeRuntimeState([]), {
    currentRepo: null,
    cwd: null,
    tasks: {},
    telegramUpdateOffset: null,
  });
  assert.equal(normalizeRuntimeState({ telegramUpdateOffset: -1 }).telegramUpdateOffset, null);
  assert.equal(normalizeRuntimeState({ telegramUpdateOffset: 12.5 }).telegramUpdateOffset, null);
});
