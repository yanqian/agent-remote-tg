import { dirname, resolve } from "node:path";
import { handleAgent } from "./ask.js";
import { authorizeMessage } from "./auth.js";
import {
  applyApprovalOptionSelection,
  handleApprovalCommand,
  handleApprovalReply,
  parseApprovalCallbackData,
} from "./approval.js";
import { HELP_RESPONSE } from "./constants.js";
import { parseCommand } from "./commands.js";
import { loadRuntimeState, saveRuntimeState } from "./runtime-state.js";
import { handleLogs, handleStatus, handleStop } from "./task-management.js";
import { createTaskExecutor } from "./task-executor.js";
import { handleContinue } from "./work.js";
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

      const state = loadRuntimeState(statePath);
      const replyDecision = handleApprovalReply(message, state);
      if (replyDecision.handled) {
        if (replyDecision.stateChanged) {
          const delivered = deliverApprovalSelection({
            executor,
            result: replyDecision,
            chatId: message.chatId,
          });
          saveRuntimeState(statePath, delivered.state ?? replyDecision.state);
          return delivered.response ?? replyDecision.response;
        }
        return replyDecision.response;
      }

      const parsed = parseCommand(message.text);
      if (!parsed.ok) {
        return parsed.response;
      }

      const result = handleParsedCommand(parsed, repos, state, executor, message.chatId);
      if (result.stateChanged) {
        const delivered = deliverApprovalSelection({
          executor,
          result,
          chatId: message.chatId,
        });
        saveRuntimeState(statePath, delivered.state ?? result.state);
        return delivered.response ?? result.response;
      }

      return result.response;
    },

    handleCallbackQuery(callbackQuery) {
      const auth = authorizeMessage(callbackQuery, allowedChatIds);
      if (!auth.ok) {
        return auth.response;
      }

      const parsed = parseApprovalCallbackData(callbackQuery.data);
      if (!parsed) {
        return "Invalid approval callback data.";
      }

      const state = loadRuntimeState(statePath);
      const result = applyApprovalOptionSelection({
        requestId: parsed.requestId,
        optionId: parsed.optionId,
        state,
        chatId: callbackQuery.chatId,
      });
      if (!result.stateChanged) {
        return result.response;
      }

      const delivered = deliverApprovalSelection({
        executor,
        result,
        chatId: callbackQuery.chatId,
      });
      if (!delivered.ok) {
        return delivered.response;
      }

      saveRuntimeState(statePath, delivered.state ?? result.state);
      return result.response;
    },
  };
}

function deliverApprovalSelection({ executor, result, chatId }) {
  if (!result?.selectedOption || !result?.state) {
    return { ok: true, state: result?.state, response: result?.response };
  }
  const request = findSelectedApprovalRequest(result.state, result.selectedOption);
  if (!request) {
    return { ok: false, response: "Approval request option incompatible." };
  }
  if (!request.taskId) {
    return { ok: true, state: result.state, response: result.response };
  }
  return executor && typeof executor.resolveApprovalOption === "function"
    ? executor.resolveApprovalOption({
        requestId: request.requestId,
        optionId: result.selectedOption.optionId,
        selectedOption: result.selectedOption,
        state: result.state,
        chatId,
      })
    : { ok: false, response: "Approval task is not active." };
}

function findSelectedApprovalRequest(state, selectedOption) {
  for (const [requestId, request] of Object.entries(state?.approvalRequests ?? {})) {
    if (request?.selectedOptionId === selectedOption.optionId && request?.selectedCodexOptionId === selectedOption.codexOptionId) {
      return { ...request, requestId };
    }
  }
  return null;
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
    case "/agent":
      return handleAgent(parsed.args, state, taskExecutor, chatId);
    case "/continue":
      return handleContinue(parsed.args, state, taskExecutor, chatId);
    case "/approve":
    case "/reject":
    case "/always_allow":
    case "/always_reject":
      return handleApprovalCommand(parsed.command, parsed.args, state, chatId);
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
