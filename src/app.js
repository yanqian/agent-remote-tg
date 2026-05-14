import { dirname, resolve } from "node:path";
import { authorizeMessage } from "./auth.js";
import { handleAsk } from "./ask.js";
import { HELP_RESPONSE } from "./constants.js";
import { parseCommand } from "./commands.js";
import { loadRuntimeState, saveRuntimeState } from "./runtime-state.js";
import { handleLogs, handleStatus, handleStop } from "./task-management.js";
import { createTaskExecutor } from "./task-executor.js";
import { handleContinue, handleRunOrch, handleWork } from "./work.js";
import { handleGit, handleLs, handlePwd, handleRepos, handleUse } from "./workspace.js";

export function createApp({ allowedChatIds, repos, statePath, logsDir, taskExecutor }) {
  if (!Array.isArray(allowedChatIds)) {
    throw new Error("allowedChatIds must be an array.");
  }
  if (!repos || typeof repos !== "object") {
    throw new Error("repos must be an object.");
  }
  if (!statePath) {
    throw new Error("statePath is required.");
  }
  const executor = taskExecutor ?? createTaskExecutor({
    statePath,
    logsDir: logsDir ?? resolve(dirname(statePath), "logs"),
  });

  return {
    handleMessage(message) {
      const auth = authorizeMessage(message, allowedChatIds);
      if (!auth.ok) {
        return auth.response;
      }

      const parsed = parseCommand(message.text);
      if (!parsed.ok) {
        return parsed.response;
      }

      const state = loadRuntimeState(statePath);
      const result = handleParsedCommand(parsed, repos, state, executor, message.chatId);
      if (result.stateChanged) {
        saveRuntimeState(statePath, result.state);
      }

      return result.response;
    },
  };
}

export function handleParsedCommand(parsed, repos, state, taskExecutor, chatId = null) {
  switch (parsed.command) {
    case "/repos":
      return handleRepos(repos);
    case "/use":
      return handleUse(parsed.args, repos, state);
    case "/pwd":
      return handlePwd(state);
    case "/ls":
      return handleLs(state);
    case "/git":
      return handleGit(state);
    case "/ask":
      return handleAsk(parsed.args, state, taskExecutor, chatId);
    case "/work":
      return handleWork(parsed.args, state, taskExecutor, chatId);
    case "/continue":
      return handleContinue(parsed.args, state, taskExecutor, chatId);
    case "/run_orch":
      return handleRunOrch(parsed.args, state, taskExecutor, chatId);
    case "/status":
      return handleStatus(state);
    case "/logs":
      return handleLogs(parsed.args, taskExecutor);
    case "/stop":
      return handleStop(parsed.args, taskExecutor);
    case "/help":
      return { response: HELP_RESPONSE, stateChanged: false };
    default:
      return {
        response: "Command recognized but not implemented in the current feature set.",
        stateChanged: false,
      };
  }
}
