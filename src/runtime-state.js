import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { DEFAULT_STATE } from "./constants.js";

export function defaultState() {
  return {
    currentRepo: DEFAULT_STATE.currentRepo,
    cwd: DEFAULT_STATE.cwd,
    tasks: {},
    askSessions: {},
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
    askSessions: normalizeAskSessions(state.askSessions),
    telegramUpdateOffset: normalizeTelegramUpdateOffset(state.telegramUpdateOffset),
  };
}

export function statePathFor(rootDir) {
  return resolve(rootDir, "runtime_state.json");
}

export function updateAskSessionBinding(state, { chatId, repoAlias, codexSessionId }) {
  if (!isValidAskSessionKey(chatId) || !isValidAskSessionKey(repoAlias) || !isValidCodexSessionId(codexSessionId)) {
    return normalizeRuntimeState(state);
  }

  const normalized = normalizeRuntimeState(state);
  return {
    ...normalized,
    askSessions: {
      ...normalized.askSessions,
      [chatId]: {
        ...(normalized.askSessions[chatId] ?? {}),
        [repoAlias]: {
          codexSessionId,
        },
      },
    },
  };
}

export function isValidCodexSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{5,199}$/.test(value);
}

function normalizeAskSessions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sessions = {};
  for (const [chatId, repos] of Object.entries(value)) {
    if (!isValidAskSessionKey(chatId) || !repos || typeof repos !== "object" || Array.isArray(repos)) {
      continue;
    }

    const normalizedRepos = {};
    for (const [repoAlias, binding] of Object.entries(repos)) {
      if (!isValidAskSessionKey(repoAlias) || !binding || typeof binding !== "object" || Array.isArray(binding)) {
        continue;
      }
      if (!isValidCodexSessionId(binding.codexSessionId)) {
        continue;
      }
      normalizedRepos[repoAlias] = {
        codexSessionId: binding.codexSessionId,
      };
    }

    if (Object.keys(normalizedRepos).length > 0) {
      sessions[chatId] = normalizedRepos;
    }
  }
  return sessions;
}

function isValidAskSessionKey(value) {
  return typeof value === "string" && value.length > 0 && !/[\u0000-\u001f\u007f/\\]/.test(value);
}

function normalizeTelegramUpdateOffset(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
