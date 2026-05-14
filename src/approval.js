import { isValidApprovalRequestId, normalizeRuntimeState } from "./runtime-state.js";

const APPROVE_WORDS = new Set(["yes", "y", "approve", "approved"]);
const REJECT_WORDS = new Set(["no", "n", "reject", "rejected"]);
const ALWAYS_ALLOW_WORDS = new Set(["always", "always allow", "always_allow", "以后都允许"]);

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

  const resolvedAt = now.toISOString();
  const nextStatus = decision === "always_allow" ? "always_allowed" : decision;
  const nextRequest = {
    ...request,
    status: nextStatus,
    decidedByChatId: String(chatId),
    decidedAt: resolvedAt,
  };
  const nextApprovalRequests = {
    ...normalized.approvalRequests,
    [requestId]: nextRequest,
  };
  const nextApprovalAllowRules = decision === "always_allow"
    ? {
        ...normalized.approvalAllowRules,
        [requestId]: buildAllowRule(request, chatId, resolvedAt),
      }
    : normalized.approvalAllowRules;

  return {
    response: formatDecisionResponse(requestId, decision),
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
  return null;
}

function isExpired(request, now) {
  if (typeof request.expiresAt !== "string" || request.expiresAt.length === 0) {
    return false;
  }
  const expiresAt = Date.parse(request.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function buildAllowRule(request, chatId, allowedAt) {
  const sourceRule = request.allowRule && typeof request.allowRule === "object" && !Array.isArray(request.allowRule)
    ? request.allowRule
    : {};
  return {
    ...sourceRule,
    ruleId: request.requestId,
    requestId: request.requestId,
    chatId: String(chatId),
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
  return `Approved and stored future allow rule: ${requestId}`;
}
