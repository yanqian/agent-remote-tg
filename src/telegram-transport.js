import { createServer } from "node:http";
import { formatTaskCompletionMessage } from "./task-executor.js";

const WEBHOOK_PATH = "/telegram/webhook";
const HEALTH_PATH = "/healthz";

export function createTelegramHttpServer({ app, telegramBotToken, fetchImpl = globalThis.fetch }) {
  if (!app || typeof app.handleMessage !== "function") {
    throw new Error("app.handleMessage is required.");
  }
  if (!telegramBotToken) {
    throw new Error("telegramBotToken is required.");
  }

  return createServer(async (request, response) => {
    try {
      await handleHttpRequest(request, response, { app, telegramBotToken, fetchImpl });
    } catch {
      writeText(response, 500, "internal error");
    }
  });
}

export async function handleHttpRequest(request, response, { app, telegramBotToken, fetchImpl = globalThis.fetch }) {
  const path = request.url ? new URL(request.url, "http://localhost").pathname : "/";

  if (path === HEALTH_PATH && request.method === "GET") {
    writeText(response, 200, "ok");
    return;
  }

  if (path !== WEBHOOK_PATH) {
    writeText(response, 404, "not found");
    return;
  }

  if (request.method !== "POST") {
    writeText(response, 405, "method not allowed");
    return;
  }

  let update;
  try {
    update = JSON.parse(await readRequestBody(request));
  } catch {
    writeText(response, 400, "invalid json");
    return;
  }

  const message = parseTelegramMessage(update);
  if (!message) {
    const callbackQuery = parseTelegramCallbackQuery(update);
    if (callbackQuery && typeof app.handleCallbackQuery === "function") {
      const text = app.handleCallbackQuery(callbackQuery);
      await attemptTelegramCallbackAnswer({
        botToken: telegramBotToken,
        callbackQueryId: callbackQuery.callbackQueryId,
        text,
        fetchImpl,
      });
      await attemptTelegramReply({
        botToken: telegramBotToken,
        chatId: callbackQuery.chatId,
        text,
        fetchImpl,
      });
    }
    writeText(response, 200, "ok");
    return;
  }

  const text = app.handleMessage(message);
  await attemptTelegramReply({
    botToken: telegramBotToken,
    chatId: message.chatId,
    text,
    fetchImpl,
  });

  writeText(response, 200, "ok");
}

export function parseTelegramMessage(update) {
  const source = update?.message;
  const chatId = source?.chat?.id;
  const text = source?.text;
  if (chatId === undefined || chatId === null || typeof text !== "string") {
    return null;
  }

  const message = {
    chatId: String(chatId),
    text,
  };
  if (Number.isSafeInteger(source.message_id)) {
    message.messageId = source.message_id;
  }
  if (Number.isSafeInteger(source.reply_to_message?.message_id)) {
    message.replyToMessageId = source.reply_to_message.message_id;
  }
  if (typeof source.reply_to_message?.text === "string") {
    message.replyToText = source.reply_to_message.text;
  }
  return message;
}

export function parseTelegramCallbackQuery(update) {
  const source = update?.callback_query;
  const callbackQueryId = source?.id;
  const chatId = source?.message?.chat?.id;
  const data = source?.data;
  if (typeof callbackQueryId !== "string" || chatId === undefined || chatId === null || typeof data !== "string") {
    return null;
  }
  return {
    callbackQueryId,
    chatId: String(chatId),
    data,
  };
}

export async function sendTelegramMessage({ botToken, chatId, text, replyMarkup = null, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required.");
  }

  const body = {
    chat_id: chatId,
    text,
  };
  if (replyMarkup && typeof replyMarkup === "object") {
    body.reply_markup = replyMarkup;
  }

  return fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

export async function answerTelegramCallbackQuery({ botToken, callbackQueryId, text, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required.");
  }

  return fetchImpl(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text: truncateCallbackAnswer(text),
    }),
  });
}

export function createTelegramTaskCompletionNotifier({ botToken, fetchImpl = globalThis.fetch }) {
  if (!botToken) {
    throw new Error("botToken is required.");
  }
  return async (task) => {
    if (!task || typeof task.chatId !== "string" || task.chatId.length === 0) {
      return;
    }
    await sendTelegramMessage({
      botToken,
      chatId: task.chatId,
      text: formatTaskCompletionMessage(task),
      fetchImpl,
    });
  };
}

export function createTelegramApprovalNotifier({ botToken, fetchImpl = globalThis.fetch }) {
  if (!botToken) {
    throw new Error("botToken is required.");
  }
  return async ({ chatId, text, replyMarkup }) => {
    const response = await sendTelegramMessage({
      botToken,
      chatId,
      text,
      replyMarkup,
      fetchImpl,
    });
    if (response && typeof response.json === "function") {
      const body = await response.json();
      const messageId = body?.result?.message_id;
      return Number.isSafeInteger(messageId) ? { telegramMessageId: messageId } : {};
    }
    return {};
  };
}

async function attemptTelegramReply(options) {
  try {
    await sendTelegramMessage(options);
  } catch {
    // Telegram delivery errors must not make Telegram retry command execution.
  }
}

async function attemptTelegramCallbackAnswer(options) {
  try {
    await answerTelegramCallbackQuery(options);
  } catch {
    // Callback answer errors must not make Telegram retry command execution.
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function writeText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

function truncateCallbackAnswer(text) {
  const value = String(text ?? "");
  return value.length <= 180 ? value : `${value.slice(0, 167)} [truncated]`;
}
