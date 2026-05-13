import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { DEFAULT_STATE } from "./constants.js";

export function defaultState() {
  return {
    currentRepo: DEFAULT_STATE.currentRepo,
    cwd: DEFAULT_STATE.cwd,
    tasks: {},
    telegramUpdateOffset: DEFAULT_STATE.telegramUpdateOffset,
  };
}

export function loadRuntimeState(statePath) {
  if (!existsSync(statePath)) {
    const state = defaultState();
    saveRuntimeState(statePath, state);
    return state;
  }

  const parsed = JSON.parse(readFileSync(statePath, "utf8"));
  return normalizeRuntimeState(parsed);
}

export function saveRuntimeState(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true });
  const normalized = normalizeRuntimeState(state);
  const tempPath = `${statePath}.tmp.${process.pid}`;
  writeFileSync(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
  renameSync(tempPath, statePath);
}

export function normalizeRuntimeState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return defaultState();
  }

  return {
    currentRepo: typeof state.currentRepo === "string" ? state.currentRepo : null,
    cwd: typeof state.cwd === "string" ? state.cwd : null,
    tasks: state.tasks && typeof state.tasks === "object" && !Array.isArray(state.tasks)
      ? state.tasks
      : {},
    telegramUpdateOffset: normalizeTelegramUpdateOffset(state.telegramUpdateOffset),
  };
}

export function statePathFor(rootDir) {
  return resolve(rootDir, "runtime_state.json");
}

function normalizeTelegramUpdateOffset(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
