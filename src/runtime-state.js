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
    approvalRequests: {},
    approvalAllowRules: {},
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
    approvalRequests: normalizeApprovalRequests(state.approvalRequests),
    approvalAllowRules: normalizeApprovalAllowRules(state.approvalAllowRules),
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

export function removeAskSessionBinding(state, { chatId, repoAlias }) {
  const normalized = normalizeRuntimeState(state);
  if (!isValidAskSessionKey(chatId) || !isValidAskSessionKey(repoAlias)) {
    return normalized;
  }

  const chatBindings = normalized.askSessions[chatId];
  if (!chatBindings || !Object.hasOwn(chatBindings, repoAlias)) {
    return normalized;
  }

  const nextChatBindings = { ...chatBindings };
  delete nextChatBindings[repoAlias];
  const nextAskSessions = { ...normalized.askSessions };
  if (Object.keys(nextChatBindings).length === 0) {
    delete nextAskSessions[chatId];
  } else {
    nextAskSessions[chatId] = nextChatBindings;
  }

  return {
    ...normalized,
    askSessions: nextAskSessions,
  };
}

export function getAskSessionBinding(state, { chatId, repoAlias }) {
  if (!isValidAskSessionKey(chatId) || !isValidAskSessionKey(repoAlias)) {
    return null;
  }

  const normalized = normalizeRuntimeState(state);
  const binding = normalized.askSessions[chatId]?.[repoAlias] ?? null;
  return binding && isValidCodexSessionId(binding.codexSessionId) ? binding : null;
}

export function isValidCodexSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{5,199}$/.test(value);
}

export function isValidApprovalRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(value);
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

function normalizeApprovalRequests(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const requests = {};
  for (const [requestId, request] of Object.entries(value)) {
    if (!isValidApprovalRequestId(requestId) || !request || typeof request !== "object" || Array.isArray(request)) {
      continue;
    }
    const normalizedStatus = normalizeApprovalStatus(request.status);
    if (!normalizedStatus) {
      continue;
    }
    requests[requestId] = {
      ...request,
      requestId,
      status: normalizedStatus,
      chatId: typeof request.chatId === "string" && request.chatId.length > 0 ? request.chatId : null,
    };
  }
  return requests;
}

function normalizeApprovalAllowRules(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const rules = {};
  for (const [ruleId, rule] of Object.entries(value)) {
    if (!isValidApprovalRequestId(ruleId) || !rule || typeof rule !== "object" || Array.isArray(rule)) {
      continue;
    }
    rules[ruleId] = { ...rule, ruleId };
  }
  return rules;
}

function normalizeApprovalStatus(value) {
  return ["pending", "approved", "rejected", "always_allowed", "always_rejected", "expired"].includes(value) ? value : null;
}
