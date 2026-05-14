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
  const chatId = update?.message?.chat?.id;
  const text = update?.message?.text;
  if (chatId === undefined || chatId === null || typeof text !== "string") {
    return null;
  }

  return {
    chatId: String(chatId),
    text,
  };
}

export async function sendTelegramMessage({ botToken, chatId, text, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required.");
  }

  return fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
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

async function attemptTelegramReply(options) {
  try {
    await sendTelegramMessage(options);
  } catch {
    // Telegram delivery errors must not make Telegram retry command execution.
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
