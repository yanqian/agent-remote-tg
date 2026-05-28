import { isValidApprovalRequestId, normalizeRuntimeState } from "./runtime-state.js";

const APPROVE_WORDS = new Set(["yes", "y", "approve", "approved"]);
const REJECT_WORDS = new Set(["no", "n", "reject", "rejected"]);
const ALWAYS_ALLOW_WORDS = new Set(["always", "always allow", "always_allow", "以后都允许"]);
const CALLBACK_PREFIX = "approval";
const APPROVAL_MESSAGE_LIMIT = 1800;
const SECRET_NAME_PATTERN = /TOKEN|SECRET|PASSWORD|KEY/i;
let approvalTestSequence = 0;

export function handleApprovalCommand(command, requestId, state, chatId, now = new Date()) {
  const decision = commandToDecision(command);
  if (!decision) {
    return { response: "Unknown approval decision.", stateChanged: false };
  }
  return applyApprovalDecision({ requestId, decision, state, chatId, now });
}

export function handleApprovalReply(message, state, now = new Date()) {
  const decision = parseReplyDecision(message?.text);
  if (!decision) {
    return { handled: false };
  }

  const requestId = findReplyApprovalRequestId(state, message);
  if (!requestId) {
    return { handled: false };
  }

  return {
    handled: true,
    ...applyApprovalDecision({
      requestId,
      decision,
      state,
      chatId: message.chatId,
      now,
    }),
  };
}

export function createApprovalTestRequest({ state, chatId, now = new Date() }) {
  const normalized = normalizeRuntimeState(state);
  const requestId = generateApprovalTestRequestId(normalized.approvalRequests);
  const chatKey = String(chatId);
  const request = {
    requestId,
    status: "pending",
    taskId: null,
    chatId: chatKey,
    botLocalTest: true,
    source: "approval_test",
    detail: {
      category: "bot_local_test",
      action: "approval_test",
      description: "Bot-local approval flow test. No Codex task, shell command, process signal, or child stdin is involved.",
    },
    options: [
      { optionId: "opt_1", codexOptionId: "test_approve", label: "Approve", decision: "approved" },
      { optionId: "opt_2", codexOptionId: "test_reject", label: "Reject", decision: "rejected" },
      { optionId: "opt_3", codexOptionId: "test_always_allow", label: "Always allow", decision: "always_allow" },
      { optionId: "opt_4", codexOptionId: "test_always_reject", label: "Always reject", decision: "always_reject" },
    ],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    telegramMessageId: null,
    allowRule: {
      source: "approval_test",
      botLocalTest: true,
    },
  };

  return {
    request,
    response: formatApprovalTestResponse(requestId),
    state: {
      ...normalized,
      approvalRequests: {
        ...normalized.approvalRequests,
        [requestId]: request,
      },
    },
    stateChanged: true,
  };
}

export function parseReplyDecision(text) {
  const normalized = String(text ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (ALWAYS_ALLOW_WORDS.has(normalized)) {
    return "always_allow";
  }
  if (APPROVE_WORDS.has(normalized)) {
    return "approved";
  }
  if (REJECT_WORDS.has(normalized)) {
    return "rejected";
  }
  return null;
}

export function applyApprovalDecision({ requestId, decision, state, chatId, now = new Date() }) {
  if (!isValidApprovalRequestId(requestId)) {
    return { response: `Invalid approval request ID: ${requestId}`, stateChanged: false };
  }

  const normalized = normalizeRuntimeState(state);
  const request = normalized.approvalRequests[requestId];
  if (!request) {
    return { response: `Unknown approval request: ${requestId}`, stateChanged: false };
  }
  if (request.chatId !== null && String(request.chatId) !== String(chatId)) {
    return { response: `Unauthorized approval request: ${requestId}`, stateChanged: false };
  }
  if (request.status !== "pending") {
    return { response: `Approval request already resolved: ${requestId}`, stateChanged: false };
  }
  if (isExpired(request, now)) {
    return { response: `Approval request expired: ${requestId}`, stateChanged: false };
  }

  const option = findCompatibleOption(request, decision);
  if (!option) {
    return { response: `Approval request option incompatible: ${requestId}`, stateChanged: false };
  }

  const resolvedAt = now.toISOString();
  const nextStatus = statusForDecision(decision);
  const nextRequest = {
    ...request,
    status: nextStatus,
    decidedByChatId: String(chatId),
    decidedAt: resolvedAt,
    selectedOptionId: option.optionId,
    selectedCodexOptionId: option.codexOptionId,
  };
  const nextApprovalRequests = {
    ...normalized.approvalRequests,
    [requestId]: nextRequest,
  };
  const nextApprovalAllowRules = decision === "always_allow" || decision === "always_reject"
    ? {
        ...normalized.approvalAllowRules,
        [requestId]: buildAllowRule(request, chatId, resolvedAt, decision),
      }
    : normalized.approvalAllowRules;

  return {
    response: formatDecisionResponse(requestId, decision),
    requestId,
    selectedOption: option,
    state: {
      ...normalized,
      approvalRequests: nextApprovalRequests,
      approvalAllowRules: nextApprovalAllowRules,
    },
    stateChanged: true,
  };
}

export function applyApprovalOptionSelection({ requestId, optionId, state, chatId, now = new Date() }) {
  if (!isValidApprovalRequestId(requestId) || !isValidOptionId(optionId)) {
    return { response: "Invalid approval callback data.", stateChanged: false };
  }

  const normalized = normalizeRuntimeState(state);
  const request = normalized.approvalRequests[requestId];
  if (!request) {
    return { response: `Unknown approval request: ${requestId}`, stateChanged: false };
  }
  if (request.chatId !== null && String(request.chatId) !== String(chatId)) {
    return { response: `Unauthorized approval request: ${requestId}`, stateChanged: false };
  }
  if (request.status !== "pending") {
    return { response: `Approval request already resolved: ${requestId}`, stateChanged: false };
  }
  if (isExpired(request, now)) {
    return { response: `Approval request expired: ${requestId}`, stateChanged: false };
  }

  const option = getRequestOptions(request).find((candidate) => candidate.optionId === optionId);
  if (!option) {
    return { response: `Approval request option incompatible: ${requestId}`, stateChanged: false };
  }

  const decision = option.decision ?? "selected";
  const resolvedAt = now.toISOString();
  const nextRequest = {
    ...request,
    status: statusForDecision(decision),
    decidedByChatId: String(chatId),
    decidedAt: resolvedAt,
    selectedOptionId: option.optionId,
    selectedCodexOptionId: option.codexOptionId,
  };
  const nextApprovalRequests = {
    ...normalized.approvalRequests,
    [requestId]: nextRequest,
  };
  const nextApprovalAllowRules = decision === "always_allow" || decision === "always_reject"
    ? {
        ...normalized.approvalAllowRules,
        [requestId]: buildAllowRule(request, chatId, resolvedAt, decision),
      }
    : normalized.approvalAllowRules;

  return {
    response: formatOptionResponse(requestId, option),
    requestId,
    selectedOption: option,
    state: {
      ...normalized,
      approvalRequests: nextApprovalRequests,
      approvalAllowRules: nextApprovalAllowRules,
    },
    stateChanged: true,
  };
}

export function findReplyApprovalRequestId(state, message) {
  const replyToMessageId = message?.replyToMessageId;
  if (!Number.isSafeInteger(replyToMessageId)) {
    return null;
  }

  const normalized = normalizeRuntimeState(state);
  for (const [requestId, request] of Object.entries(normalized.approvalRequests)) {
    if (
      request.status === "pending" &&
      request.telegramMessageId === replyToMessageId &&
      (request.chatId === null || String(request.chatId) === String(message.chatId))
    ) {
      return requestId;
    }
  }
  return null;
}

function commandToDecision(command) {
  if (command === "/approve") {
    return "approved";
  }
  if (command === "/reject") {
    return "rejected";
  }
  if (command === "/always_allow") {
    return "always_allow";
  }
  if (command === "/always_reject") {
    return "always_reject";
  }
  return null;
}

function isExpired(request, now) {
  if (typeof request.expiresAt !== "string" || request.expiresAt.length === 0) {
    return false;
  }
  const expiresAt = Date.parse(request.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function buildAllowRule(request, chatId, allowedAt, decision = "always_allow") {
  const sourceRule = request.allowRule && typeof request.allowRule === "object" && !Array.isArray(request.allowRule)
    ? request.allowRule
    : {};
  return {
    ...sourceRule,
    ruleId: request.requestId,
    requestId: request.requestId,
    chatId: String(chatId),
    decision,
    allowedAt,
  };
}

function formatDecisionResponse(requestId, decision) {
  if (decision === "approved") {
    return `Approved request: ${requestId}`;
  }
  if (decision === "rejected") {
    return `Rejected request: ${requestId}`;
  }
  if (decision === "always_reject") {
    return `Rejected and stored future reject rule: ${requestId}`;
  }
  return `Approved and stored future allow rule: ${requestId}`;
}

function formatOptionResponse(requestId, option) {
  if (option.decision) {
    return formatDecisionResponse(requestId, option.decision);
  }
  return `Selected approval option ${option.optionId} for request: ${requestId}`;
}

function statusForDecision(decision) {
  if (decision === "always_allow") {
    return "always_allowed";
  }
  if (decision === "always_reject") {
    return "always_rejected";
  }
  if (decision === "rejected") {
    return "rejected";
  }
  return "approved";
}

function findCompatibleOption(request, decision) {
  const options = getRequestOptions(request);
  if (options.length === 0) {
    return {
      optionId: decision,
      codexOptionId: decision,
      label: decision,
      decision,
    };
  }
  return options.find((option) => option.decision === decision) ?? null;
}

function getRequestOptions(request) {
  return Array.isArray(request?.options)
    ? request.options.filter((option) => option && typeof option === "object" && isValidOptionId(option.optionId))
    : [];
}

export function parseApprovalCallbackData(data) {
  const parts = String(data ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== CALLBACK_PREFIX) {
    return null;
  }
  const [, requestId, optionId] = parts;
  if (!isValidApprovalRequestId(requestId) || !isValidOptionId(optionId)) {
    return null;
  }
  return { requestId, optionId };
}

export function buildApprovalCallbackData(requestId, optionId) {
  if (!isValidApprovalRequestId(requestId) || !isValidOptionId(optionId)) {
    throw new Error("invalid approval callback data");
  }
  return `${CALLBACK_PREFIX}:${requestId}:${optionId}`;
}

export function formatApprovalTestResponse(requestId) {
  return [
    `Approval test request: ${requestId}`,
    `Use /approve ${requestId}`,
    `Use /reject ${requestId}`,
    `Use /always_allow ${requestId}`,
    `Use /always_reject ${requestId}`,
    "Reply yes, no, or always to the Bot approval message when Telegram reply metadata is available.",
  ].join("\n");
}

export function buildApprovalTelegramMessage(request, env = process.env, extraSecrets = []) {
  const detail = request?.detail && typeof request.detail === "object" ? request.detail : {};
  const lines = [
    `Approval request: ${request.requestId}`,
    request.taskId ? `Task: ${request.taskId}` : "",
    request.repoAlias ? `Repo: ${request.repoAlias}` : "",
    request.codexSessionId ? `Codex session: ${request.codexSessionId}` : "",
    detail.category ? `Category: ${detail.category}` : "",
    detail.action ? `Action: ${detail.action}` : "",
    detail.command ? `Command: ${detail.command}` : "",
    detail.path ? `Path: ${detail.path}` : "",
    detail.description ? `Detail: ${detail.description}` : "",
  ].filter(Boolean);
  return redactApprovalText(truncateText(lines.join("\n"), APPROVAL_MESSAGE_LIMIT), env, extraSecrets);
}

export function buildApprovalInlineKeyboard(request) {
  const options = getRequestOptions(request);
  return {
    inline_keyboard: [
      options.map((option) => ({
        text: truncateButtonLabel(option.label ?? option.optionId),
        callback_data: buildApprovalCallbackData(request.requestId, option.optionId),
      })),
    ],
  };
}

export function extractCodexApprovalRequest(line, metadata = {}) {
  const parsed = parseJsonLine(line);
  if (!parsed) {
    return null;
  }
  const source = parsed.item && typeof parsed.item === "object" && !Array.isArray(parsed.item) ? parsed.item : parsed;
  const eventType = String(parsed.type ?? parsed.event ?? source.type ?? "");
  if (!/(permission|approval)/i.test(eventType)) {
    return null;
  }

  const options = normalizeCodexOptions(source.options ?? source.choices ?? parsed.options ?? parsed.choices);
  if (options.length === 0) {
    return null;
  }

  const requestId = metadata.requestId;
  if (!isValidApprovalRequestId(requestId)) {
    return null;
  }
  const now = metadata.now instanceof Date ? metadata.now : new Date();
  const detail = normalizeDetail(source);
  const codexRequestId = safeString(source.id ?? source.request_id ?? source.requestId ?? parsed.id ?? parsed.request_id ?? parsed.requestId, 200);
  return {
    requestId,
    status: "pending",
    taskId: metadata.taskId ?? null,
    chatId: metadata.chatId ?? null,
    repoAlias: metadata.repoAlias ?? null,
    codexSessionId: metadata.codexSessionId ?? null,
    codexRequestId,
    detail,
    options,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    telegramMessageId: null,
    allowRule: {
      taskId: metadata.taskId ?? null,
      repoAlias: metadata.repoAlias ?? null,
      codexSessionId: metadata.codexSessionId ?? null,
      category: detail.category ?? null,
      action: detail.action ?? null,
      command: detail.command ?? null,
      path: detail.path ?? null,
    },
  };
}

function normalizeCodexOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) {
    return [];
  }
  return rawOptions.slice(0, 8).map((rawOption, index) => {
    const value = rawOption && typeof rawOption === "object" ? rawOption : { id: rawOption, label: rawOption };
    const codexOptionId = safeString(value.id ?? value.option_id ?? value.optionId ?? value.value ?? value.label ?? `option_${index + 1}`, 200);
    const label = safeString(value.label ?? value.title ?? value.name ?? codexOptionId, 80) || `Option ${index + 1}`;
    return {
      optionId: `opt_${index + 1}`,
      codexOptionId,
      label,
      decision: inferDecision(codexOptionId, label),
    };
  });
}

function generateApprovalTestRequestId(existingRequests = {}) {
  let requestId;
  do {
    approvalTestSequence += 1;
    requestId = `req_${Date.now().toString(36)}_${approvalTestSequence.toString(36)}`;
  } while (existingRequests && Object.hasOwn(existingRequests, requestId));
  return requestId;
}

function inferDecision(...values) {
  const text = values.join(" ").toLowerCase().replace(/[_-]+/g, " ");
  if (/\balways\b/.test(text) && /\breject|deny|no\b/.test(text)) {
    return "always_reject";
  }
  if (/\balways\b/.test(text) && /\ballow|approve|yes\b/.test(text)) {
    return "always_allow";
  }
  if (/\breject|deny|no\b/.test(text)) {
    return "rejected";
  }
  if (/\ballow|approve|yes\b/.test(text)) {
    return "approved";
  }
  return null;
}

function normalizeDetail(source) {
  return {
    category: safeString(source.category ?? source.permission ?? source.kind ?? source.type, 120),
    action: safeString(source.action ?? source.title ?? source.name, 240),
    command: safeString(source.command ?? source.argv, 500),
    path: safeString(source.path ?? source.cwd ?? source.directory, 300),
    description: safeString(source.description ?? source.message ?? source.reason ?? source.summary, 1000),
  };
}

function parseJsonLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeString(value, limit) {
  if (typeof value === "string") {
    return value.slice(0, limit);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" ").slice(0, limit);
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).slice(0, limit);
}

function isValidOptionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function truncateButtonLabel(value) {
  const text = String(value ?? "").trim() || "Option";
  return text.length <= 48 ? text : `${text.slice(0, 45)}...`;
}

function redactApprovalText(text, env = process.env, extraSecrets = []) {
  const values = [];
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_NAME_PATTERN.test(name) && typeof value === "string" && value.length > 0) {
      values.push(value);
    }
  }
  for (const value of extraSecrets) {
    if (typeof value === "string" && value.length > 0) {
      values.push(value);
    }
  }

  let redacted = String(text);
  for (const secret of [...new Set(values)].sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function truncateText(text, limit) {
  const value = String(text);
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 12)}\n[truncated]`;
}
