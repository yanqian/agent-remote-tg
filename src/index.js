import { createStartupContext } from "./config.js";
import { createApp } from "./app.js";
import { normalizeRepoConfig, parseRepoWhitelistJson } from "./repositories.js";
import { loadRuntimeState } from "./runtime-state.js";
import { createTelegramHttpServer } from "./telegram-transport.js";

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
  const server = createTelegramHttpServer({
    app,
    telegramBotToken: context.telegramBotToken,
    fetchImpl: options.fetchImpl,
  });
  const port = parsePort(options.port ?? env.PORT ?? "3000");

  if (options.listen) {
    server.listen(port);
  }

  return {
    status: "ready",
    rootDir: context.rootDir,
    logsDir: context.logsDir,
    statePath: context.statePath,
    repoCount: Object.keys(repos).length,
    port,
    server,
  };
}

export function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }
  return port;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = start(process.env, { listen: true });
    console.log(`agent-remote-tg ${result.status} on port ${result.port}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
