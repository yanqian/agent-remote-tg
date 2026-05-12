import { dirname, resolve } from "node:path";
import { authorizeMessage } from "./auth.js";
import { handleAsk } from "./ask.js";
import { parseCommand } from "./commands.js";
import { loadRuntimeState, saveRuntimeState } from "./runtime-state.js";
import { createTaskExecutor } from "./task-executor.js";
import { handleContinue, handleWork } from "./work.js";
import { handleGit, handleLs, handlePwd, handleRepos, handleUse } from "./workspace.js";
import { requireWorkflowReadyWorkspace } from "./workflow-readiness.js";

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
      const result = handleParsedCommand(parsed, repos, state, executor);
      if (result.stateChanged) {
        saveRuntimeState(statePath, result.state);
      }

      return result.response;
    },
  };
}

export function handleParsedCommand(parsed, repos, state, taskExecutor) {
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
      return handleAsk(parsed.args, state, taskExecutor);
    case "/work":
      return handleWork(parsed.args, state, taskExecutor);
    case "/continue":
      return handleContinue(parsed.args, state, taskExecutor);
    case "/run-orch":
      return handleWorkflowCommand(state);
    default:
      return {
        response: "Command recognized but not implemented in the current feature set.",
        stateChanged: false,
      };
  }
}

function handleWorkflowCommand(state) {
  const readiness = requireWorkflowReadyWorkspace(state);
  if (!readiness.ok) {
    return { response: readiness.response, stateChanged: false };
  }

  return {
    response: "Command recognized but not implemented in the current feature set.",
    stateChanged: false,
  };
}
