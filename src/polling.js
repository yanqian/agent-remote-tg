import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "./app.js";
import { createStartupContext } from "./config.js";
import { normalizeRepoConfig, parseRepoWhitelistJson } from "./repositories.js";
import { loadRuntimeState, saveRuntimeState } from "./runtime-state.js";
import { parseTelegramMessage, sendTelegramMessage } from "./telegram-transport.js";

const DEFAULT_POLL_TIMEOUT_SECONDS = 25;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export function start(env = process.env, options = {}) {
  const context = createStartupContext(env, options);
  const rawRepos = options.repos ?? parseRepoWhitelistJson(env.REPO_WHITELIST_JSON);
  const repos = normalizeRepoConfig(rawRepos, context.rootDir, { requireExisting: true });
  loadRuntimeState(context.statePath);
  const app = options.app ?? createApp({
    allowedChatIds: context.allowedChatIds,
    repos,
    statePath: context.statePath,
    logsDir: context.logsDir,
    taskExecutor: options.taskExecutor,
  });

  const controller = startPolling({
    app,
    statePath: context.statePath,
    telegramBotToken: context.telegramBotToken,
    fetchImpl: options.fetchImpl,
    pollTimeoutSeconds: options.pollTimeoutSeconds,
    pollIntervalMs: options.pollIntervalMs,
  });

  return {
    status: "polling",
    rootDir: context.rootDir,
    logsDir: context.logsDir,
    statePath: context.statePath,
    repoCount: Object.keys(repos).length,
    controller,
  };
}

export function startPolling(options) {
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        await pollOnce(options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
      }
      if (!stopped) {
        await delay(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
      }
    }
  })();

  return {
    stop() {
      stopped = true;
    },
    done: loop,
  };
}

export async function pollOnce({
  app,
  statePath,
  telegramBotToken,
  fetchImpl = globalThis.fetch,
  pollTimeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS,
}) {
  if (!app || typeof app.handleMessage !== "function") {
    throw new Error("app.handleMessage is required.");
  }
  if (!statePath) {
    throw new Error("statePath is required.");
  }
  if (!telegramBotToken) {
    throw new Error("telegramBotToken is required.");
  }

  const state = loadRuntimeState(statePath);
  const updates = await getTelegramUpdates({
    botToken: telegramBotToken,
    offset: state.telegramUpdateOffset,
    timeoutSeconds: pollTimeoutSeconds,
    fetchImpl,
  });

  for (const update of updates) {
    const updateId = update?.update_id;
    if (!Number.isSafeInteger(updateId) || updateId < 0) {
      continue;
    }

    const message = parseTelegramMessage(update);
    if (message) {
      const text = app.handleMessage(message);
      await attemptTelegramReply({
        botToken: telegramBotToken,
        chatId: message.chatId,
        text,
        fetchImpl,
      });
    }

    persistTelegramUpdateOffset(statePath, updateId + 1);
  }

  return updates.length;
}

function persistTelegramUpdateOffset(statePath, nextOffset) {
  const state = loadRuntimeState(statePath);
  const currentOffset = state.telegramUpdateOffset;
  const telegramUpdateOffset = currentOffset === null || nextOffset > currentOffset
    ? nextOffset
    : currentOffset;
  saveRuntimeState(statePath, { ...state, telegramUpdateOffset });
}

export async function getTelegramUpdates({
  botToken,
  offset,
  timeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required.");
  }

  const url = new URL(`https://api.telegram.org/bot${botToken}/getUpdates`);
  url.searchParams.set("timeout", String(timeoutSeconds));
  if (offset !== null && offset !== undefined) {
    url.searchParams.set("offset", String(offset));
  }

  const response = await fetchImpl(url, { method: "GET" });
  const body = await response.json();
  if (!response.ok || body?.ok !== true || !Array.isArray(body.result)) {
    throw new Error("Telegram getUpdates failed.");
  }
  return body.result;
}

async function attemptTelegramReply(options) {
  try {
    await sendTelegramMessage(options);
  } catch {
    // Delivery errors must not re-run already handled commands.
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = start(process.env);
    console.log(`agent-remote-tg ${result.status}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
