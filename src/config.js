import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export function parseAllowedChatIds(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function assertStartupEnv(env = process.env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const allowedChatIds = parseAllowedChatIds(env.ALLOWED_CHAT_IDS);
  if (env.NODE_ENV !== "test" && allowedChatIds.length === 0) {
    throw new Error("ALLOWED_CHAT_IDS must be non-empty outside NODE_ENV=test.");
  }

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    allowedChatIds,
  };
}

export function initializeRuntimePaths(options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const logsDir = resolve(rootDir, options.logsDir ?? "logs");
  const statePath = resolve(rootDir, options.statePath ?? "runtime_state.json");

  mkdirSync(logsDir, { recursive: true });

  return { rootDir, logsDir, statePath };
}

export function createStartupContext(env = process.env, options = {}) {
  const config = assertStartupEnv(env);
  const paths = initializeRuntimePaths(options);
  return { ...config, ...paths };
}
