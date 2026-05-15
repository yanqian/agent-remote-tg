import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  createTelegramApprovalNotifier,
  handleHttpRequest,
  parseTelegramCallbackQuery,
  parseTelegramMessage,
} from "../../src/telegram-transport.js";

test("GET /healthz returns ok", async () => {
  const response = await fakeHttpRequest({ method: "GET", path: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "ok");
});

test("POST /telegram/webhook dispatches message updates and sends Telegram replies", async () => {
  const handled = [];
  const telegramCalls = [];
  const response = await fakeHttpRequest({
    method: "POST",
    path: "/telegram/webhook",
    body: JSON.stringify({
      update_id: 1,
      message: {
        chat: { id: 123 },
        text: "/repos",
      },
    }),
    app: {
      handleMessage(message) {
        handled.push(message);
        return "Available repos:\n- app -> /repo";
      },
    },
    fetchImpl(url, options) {
      telegramCalls.push({ url, options });
      return Promise.resolve({ ok: true, status: 200 });
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(handled, [{ chatId: "123", text: "/repos" }]);
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].url, "https://api.telegram.org/bottest-token/sendMessage");
  assert.deepEqual(JSON.parse(telegramCalls[0].options.body), {
    chat_id: "123",
    text: "Available repos:\n- app -> /repo",
  });
});

test("POST /telegram/webhook ignores updates without message chat id and text", async () => {
  const calls = [];
  const response = await fakeHttpRequest({
    method: "POST",
    path: "/telegram/webhook",
    body: JSON.stringify({ update_id: 2, edited_message: { text: "/help" } }),
    app: {
      handleMessage() {
        calls.push("handled");
        return "ignored";
      },
    },
    fetchImpl() {
      calls.push("sent");
      return Promise.resolve({ ok: true });
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, []);
});

test("POST /telegram/webhook dispatches callback queries and answers them", async () => {
  const handled = [];
  const telegramCalls = [];
  const response = await fakeHttpRequest({
    method: "POST",
    path: "/telegram/webhook",
    body: JSON.stringify({
      update_id: 3,
      callback_query: {
        id: "cb_123",
        data: "approval:req_123:opt_1",
        message: { chat: { id: 123 } },
      },
    }),
    app: {
      handleMessage() {
        throw new Error("should not handle message");
      },
      handleCallbackQuery(callbackQuery) {
        handled.push(callbackQuery);
        return "Approved request: req_123";
      },
    },
    fetchImpl(url, options) {
      telegramCalls.push({ url, options });
      return Promise.resolve({ ok: true, status: 200 });
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(handled, [{ callbackQueryId: "cb_123", chatId: "123", data: "approval:req_123:opt_1" }]);
  assert.equal(telegramCalls.length, 2);
  assert.equal(telegramCalls[0].url, "https://api.telegram.org/bottest-token/answerCallbackQuery");
  assert.deepEqual(JSON.parse(telegramCalls[0].options.body), {
    callback_query_id: "cb_123",
    text: "Approved request: req_123",
  });
  assert.equal(telegramCalls[1].url, "https://api.telegram.org/bottest-token/sendMessage");
});

test("POST /telegram/webhook rejects invalid JSON", async () => {
  const response = await fakeHttpRequest({
    method: "POST",
    path: "/telegram/webhook",
    body: "{not-json",
  });
  assert.equal(response.statusCode, 400);
});

test("non-POST /telegram/webhook requests return 405", async () => {
  const response = await fakeHttpRequest({ method: "GET", path: "/telegram/webhook" });
  assert.equal(response.statusCode, 405);
});

test("parseTelegramMessage requires message chat id and text", () => {
  assert.deepEqual(parseTelegramMessage({ message: { chat: { id: -123 }, text: "/help" } }), {
    chatId: "-123",
    text: "/help",
  });
  assert.deepEqual(parseTelegramMessage({
    message: {
      message_id: 12,
      chat: { id: 123 },
      text: "yes",
      reply_to_message: {
        message_id: 11,
        text: "Approval request req_123",
      },
    },
  }), {
    chatId: "123",
    text: "yes",
    messageId: 12,
    replyToMessageId: 11,
    replyToText: "Approval request req_123",
  });
  assert.equal(parseTelegramMessage({ message: { chat: { id: 123 } } }), null);
  assert.equal(parseTelegramMessage({ message: { text: "/help" } }), null);
});

test("parseTelegramCallbackQuery requires callback id, chat id, and data", () => {
  assert.deepEqual(parseTelegramCallbackQuery({
    callback_query: {
      id: "cb_123",
      data: "approval:req_123:opt_1",
      message: { chat: { id: 123 } },
    },
  }), {
    callbackQueryId: "cb_123",
    chatId: "123",
    data: "approval:req_123:opt_1",
  });
  assert.equal(parseTelegramCallbackQuery({ callback_query: { id: "cb_123", data: "x" } }), null);
  assert.equal(parseTelegramCallbackQuery({ callback_query: { message: { chat: { id: 123 } }, data: "x" } }), null);
});

test("createTelegramApprovalNotifier sends inline keyboard reply markup", async () => {
  const telegramCalls = [];
  const notifier = createTelegramApprovalNotifier({
    botToken: "test-token",
    fetchImpl(url, options) {
      telegramCalls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 777 } }),
      });
    },
  });

  const result = await notifier({
    chatId: "123",
    text: "Approval request: req_123",
    replyMarkup: {
      inline_keyboard: [[
        { text: "Approve", callback_data: "approval:req_123:opt_1" },
      ]],
    },
  });

  assert.deepEqual(result, { telegramMessageId: 777 });
  assert.equal(telegramCalls[0].url, "https://api.telegram.org/bottest-token/sendMessage");
  assert.deepEqual(JSON.parse(telegramCalls[0].options.body), {
    chat_id: "123",
    text: "Approval request: req_123",
    reply_markup: {
      inline_keyboard: [[
        { text: "Approve", callback_data: "approval:req_123:opt_1" },
      ]],
    },
  });
});

async function fakeHttpRequest(options) {
  const request = Readable.from([options.body ?? ""]);
  request.method = options.method;
  request.url = options.path;
  request.setEncoding = () => {};

  const response = {
    statusCode: null,
    headers: null,
    body: "",
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = "") {
      this.body += body;
    },
  };

  await handleHttpRequest(request, response, {
    app: options.app ?? {
      handleMessage() {
        return "ok";
      },
    },
    telegramBotToken: "test-token",
    fetchImpl: options.fetchImpl ?? (() => Promise.resolve({ ok: true })),
  });
  return response;
}
