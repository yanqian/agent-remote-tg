import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleHttpRequest, parseTelegramMessage } from "../../src/telegram-transport.js";

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
