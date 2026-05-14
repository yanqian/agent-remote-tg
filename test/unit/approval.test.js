import test from "node:test";
import assert from "node:assert/strict";
import {
  applyApprovalDecision,
  findReplyApprovalRequestId,
  handleApprovalReply,
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
    cwd: "/repo",
    command: "codex",
    args: ["exec", "prompt"],
  });
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
