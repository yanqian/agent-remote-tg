import test from "node:test";
import assert from "node:assert/strict";
import {
  applyApprovalDecision,
  applyApprovalOptionSelection,
  buildApprovalCallbackData,
  buildApprovalInlineKeyboard,
  buildApprovalTelegramMessage,
  createApprovalTestRequest,
  extractCodexApprovalRequest,
  findReplyApprovalRequestId,
  handleApprovalReply,
  parseApprovalCallbackData,
  parseReplyDecision,
} from "../../src/approval.js";

const NOW = new Date("2026-05-14T00:00:00.000Z");

test("parseReplyDecision maps exact reply words only", () => {
  assert.equal(parseReplyDecision("yes"), "approved");
  assert.equal(parseReplyDecision("Approve"), "approved");
  assert.equal(parseReplyDecision("no"), "rejected");
  assert.equal(parseReplyDecision("reject"), "rejected");
  assert.equal(parseReplyDecision("always allow"), "always_allow");
  assert.equal(parseReplyDecision("以后都允许"), "always_allow");
  assert.equal(parseReplyDecision("yes please"), null);
  assert.equal(parseReplyDecision("/approve req_1"), null);
});

test("applyApprovalDecision resolves pending requests and stores allow rules", () => {
  const state = stateWithRequest({
    requestId: "req_123",
    status: "pending",
    chatId: "123",
    telegramMessageId: 88,
    allowRule: {
      cwd: "/repo",
      command: "codex",
      args: ["exec", "prompt"],
    },
  });

  const result = applyApprovalDecision({
    requestId: "req_123",
    decision: "always_allow",
    state,
    chatId: "123",
    now: NOW,
  });

  assert.equal(result.response, "Approved and stored future allow rule: req_123");
  assert.equal(result.stateChanged, true);
  assert.equal(result.state.approvalRequests.req_123.status, "always_allowed");
  assert.equal(result.state.approvalRequests.req_123.decidedByChatId, "123");
  assert.deepEqual(result.state.approvalAllowRules.req_123, {
    ruleId: "req_123",
    requestId: "req_123",
    chatId: "123",
    allowedAt: "2026-05-14T00:00:00.000Z",
    decision: "always_allow",
    cwd: "/repo",
    command: "codex",
    args: ["exec", "prompt"],
  });
});

test("applyApprovalDecision requires compatible Codex options", () => {
  const state = stateWithRequest({
    requestId: "req_123",
    status: "pending",
    chatId: "123",
    options: [
      { optionId: "opt_1", codexOptionId: "deny", label: "Deny", decision: "rejected" },
      { optionId: "opt_2", codexOptionId: "approve", label: "Approve", decision: "approved" },
    ],
  });

  assert.equal(
    applyApprovalDecision({ requestId: "req_123", decision: "always_allow", state, chatId: "123", now: NOW }).response,
    "Approval request option incompatible: req_123",
  );
  const approved = applyApprovalDecision({ requestId: "req_123", decision: "approved", state, chatId: "123", now: NOW });
  assert.equal(approved.state.approvalRequests.req_123.selectedCodexOptionId, "approve");
});

test("approval callback data and option selections preserve Codex option identity", () => {
  const state = stateWithRequest({
    requestId: "req_123",
    status: "pending",
    chatId: "123",
    options: [
      { optionId: "opt_1", codexOptionId: "allow_once", label: "Allow once", decision: "approved" },
      { optionId: "opt_2", codexOptionId: "always_reject", label: "Always reject", decision: "always_reject" },
      { optionId: "opt_3", codexOptionId: "customChoice", label: "Custom choice", decision: null },
    ],
  });

  assert.equal(buildApprovalCallbackData("req_123", "opt_3"), "approval:req_123:opt_3");
  assert.deepEqual(parseApprovalCallbackData("approval:req_123:opt_3"), { requestId: "req_123", optionId: "opt_3" });
  assert.equal(parseApprovalCallbackData("approval:../bad:opt_3"), null);

  const selected = applyApprovalOptionSelection({
    requestId: "req_123",
    optionId: "opt_3",
    state,
    chatId: "123",
    now: NOW,
  });
  assert.equal(selected.response, "Selected approval option opt_3 for request: req_123");
  assert.equal(selected.selectedOption.codexOptionId, "customChoice");
  assert.equal(selected.state.approvalRequests.req_123.status, "approved");
  assert.equal(selected.state.approvalRequests.req_123.selectedOptionId, "opt_3");

  const rejected = applyApprovalOptionSelection({
    requestId: "req_123",
    optionId: "opt_2",
    state,
    chatId: "123",
    now: NOW,
  });
  assert.equal(rejected.response, "Rejected and stored future reject rule: req_123");
  assert.equal(rejected.state.approvalRequests.req_123.status, "always_rejected");
  assert.equal(rejected.state.approvalAllowRules.req_123.decision, "always_reject");
});

test("extractCodexApprovalRequest maps Codex options to bounded Telegram buttons", () => {
  const request = extractCodexApprovalRequest(JSON.stringify({
    type: "permission_request",
    id: "codex_req_123",
    category: "command",
    command: "npm test SECRET_VALUE",
    options: [
      { id: "approve_once", label: "Approve once" },
      { id: "reject_once", label: "Reject" },
      { id: "always_allow", label: "Always allow" },
    ],
  }), {
    requestId: "req_123",
    taskId: "task_abc_1",
    chatId: "123",
    repoAlias: "app",
    codexSessionId: "session_abc123",
    now: NOW,
  });

  assert.equal(request.requestId, "req_123");
  assert.equal(request.codexRequestId, "codex_req_123");
  assert.equal(request.options.length, 3);
  assert.deepEqual(request.options.map((option) => option.optionId), ["opt_1", "opt_2", "opt_3"]);
  assert.deepEqual(request.options.map((option) => option.decision), ["approved", "rejected", "always_allow"]);
  assert.deepEqual(buildApprovalInlineKeyboard(request).inline_keyboard[0].map((button) => button.callback_data), [
    "approval:req_123:opt_1",
    "approval:req_123:opt_2",
    "approval:req_123:opt_3",
  ]);
  assert.match(buildApprovalTelegramMessage(request, { TELEGRAM_BOT_TOKEN: "SECRET_VALUE" }), /Command: npm test \[REDACTED\]/);
});

test("createApprovalTestRequest creates Bot-local test approval data", () => {
  const first = createApprovalTestRequest({ state: {}, chatId: "123", now: NOW });
  const second = createApprovalTestRequest({ state: first.state, chatId: "123", now: NOW });

  assert.match(first.request.requestId, /^req_[a-z0-9]+_[a-z0-9]+$/);
  assert.notEqual(first.request.requestId, second.request.requestId);
  assert.equal(first.request.botLocalTest, true);
  assert.equal(first.request.taskId, null);
  assert.equal(first.request.chatId, "123");
  assert.deepEqual(first.request.options.map((option) => option.decision), [
    "approved",
    "rejected",
    "always_allow",
    "always_reject",
  ]);
  assert.match(first.response, new RegExp(`/approve ${first.request.requestId}`));
  assert.deepEqual(buildApprovalInlineKeyboard(first.request).inline_keyboard[0].map((button) => button.callback_data), [
    `approval:${first.request.requestId}:opt_1`,
    `approval:${first.request.requestId}:opt_2`,
    `approval:${first.request.requestId}:opt_3`,
    `approval:${first.request.requestId}:opt_4`,
  ]);
});

test("applyApprovalDecision rejects unsafe, unknown, expired, resolved, and unauthorized requests", () => {
  assert.deepEqual(
    applyApprovalDecision({ requestId: "../secret", decision: "approved", state: {}, chatId: "123", now: NOW }),
    { response: "Invalid approval request ID: ../secret", stateChanged: false },
  );
  assert.deepEqual(
    applyApprovalDecision({ requestId: "req_missing", decision: "approved", state: {}, chatId: "123", now: NOW }),
    { response: "Unknown approval request: req_missing", stateChanged: false },
  );
  assert.deepEqual(
    applyApprovalDecision({
      requestId: "req_old",
      decision: "approved",
      state: stateWithRequest({ requestId: "req_old", status: "pending", chatId: "123", expiresAt: "2026-05-13T00:00:00.000Z" }),
      chatId: "123",
      now: NOW,
    }),
    { response: "Approval request expired: req_old", stateChanged: false },
  );
  assert.deepEqual(
    applyApprovalDecision({
      requestId: "req_done",
      decision: "approved",
      state: stateWithRequest({ requestId: "req_done", status: "approved", chatId: "123" }),
      chatId: "123",
      now: NOW,
    }),
    { response: "Approval request already resolved: req_done", stateChanged: false },
  );
  assert.deepEqual(
    applyApprovalDecision({
      requestId: "req_other",
      decision: "approved",
      state: stateWithRequest({ requestId: "req_other", status: "pending", chatId: "456" }),
      chatId: "123",
      now: NOW,
    }),
    { response: "Unauthorized approval request: req_other", stateChanged: false },
  );
});

test("handleApprovalReply correlates decisions only through replied approval messages", () => {
  const state = stateWithRequest({
    requestId: "req_123",
    status: "pending",
    chatId: "123",
    telegramMessageId: 99,
  });

  assert.equal(findReplyApprovalRequestId(state, { chatId: "123", replyToMessageId: 99 }), "req_123");
  assert.deepEqual(handleApprovalReply({ chatId: "123", text: "yes" }, state, NOW), { handled: false });
  assert.deepEqual(handleApprovalReply({ chatId: "123", text: "yes", replyToMessageId: 100 }, state, NOW), { handled: false });

  const result = handleApprovalReply({ chatId: "123", text: "yes", replyToMessageId: 99 }, state, NOW);
  assert.equal(result.handled, true);
  assert.equal(result.response, "Approved request: req_123");
  assert.equal(result.state.approvalRequests.req_123.status, "approved");
});

function stateWithRequest(request) {
  return {
    currentRepo: null,
    cwd: null,
    tasks: {},
    askSessions: {},
    approvalRequests: {
      [request.requestId]: request,
    },
    approvalAllowRules: {},
    telegramUpdateOffset: null,
  };
}
