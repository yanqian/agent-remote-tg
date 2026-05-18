import { dirname, resolve } from "node:path";
import { handleAgent } from "./ask.js";
import { authorizeMessage } from "./auth.js";
import {
  applyApprovalOptionSelection,
  buildApprovalInlineKeyboard,
  buildApprovalTelegramMessage,
  createApprovalTestRequest,
  handleApprovalCommand,
  handleApprovalReply,
  parseApprovalCallbackData,
} from "./approval.js";
import { HELP_RESPONSE } from "./constants.js";
import { handleCameraClip } from "./camera-clip.js";
import { parseCommand } from "./commands.js";
import {
  enableAgentChatMode,
  getAskSessionBinding,
  isAgentChatModeEnabled,
  loadRuntimeState,
  saveRuntimeState,
} from "./runtime-state.js";
import { handleLogs, handleStatus, handleStop } from "./task-management.js";
import { createTaskExecutor } from "./task-executor.js";
import { handleGit, handleLs, handlePwd, handleRepos, handleUse } from "./workspace.js";

export function createApp({
  allowedChatIds,
  repos,
  statePath,
  logsDir,
  taskExecutor,
  agentTaskTimeoutMs = null,
  onApprovalRequest = null,
  cameraClipConfig = { enabled: false, argvTemplate: null, error: null },
  cameraClipOptions = {},
}) {
  if (!Array.isArray(allowedChatIds)) {
    throw new Error("allowedChatIds must be an array.");
  }
  if (!repos || typeof repos !== "object") {
    throw new Error("repos must be an object.");
  }
  if (!statePath) {
    throw new Error("statePath is required.");
  }
  const approvalRequestNotifier = typeof onApprovalRequest === "function" ? onApprovalRequest : null;
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

      const text = String(message.text ?? "").trim();
      if (!text.startsWith("/")) {
        const result = handleAgentChatText(text, repos, state, executor, message.chatId, {
          agentTaskTimeoutMs,
        });
        persistAgentChatModeIfNeeded(result, statePath);
        return result.response;
      }

      const parsed = parseCommand(message.text);
      if (!parsed.ok) {
        return parsed.response;
      }

      const result = handleParsedCommand(parsed, repos, state, executor, message.chatId, {
        agentTaskTimeoutMs,
        cameraClipConfig,
        cameraClipOptions,
      });
      if (result && typeof result.then === "function") {
        return result.then((resolved) => finalizeParsedCommandResult({
          result: resolved,
          state,
          statePath,
          executor,
          onApprovalRequest: approvalRequestNotifier,
          chatId: message.chatId,
        }));
      }
      return finalizeParsedCommandResult({
        result,
        state,
        statePath,
        executor,
        onApprovalRequest: approvalRequestNotifier,
        chatId: message.chatId,
      });
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

function finalizeParsedCommandResult({ result, state, statePath, executor, onApprovalRequest, chatId }) {
  persistAgentChatModeIfNeeded(result, statePath);
  if (result.stateChanged) {
    const delivered = deliverApprovalSelection({
      executor,
      result,
      chatId,
    });
    saveRuntimeState(statePath, delivered.state ?? result.state);
    notifyApprovalRequestIfNeeded({
      statePath,
      onApprovalRequest,
      result: delivered.state ? { ...result, state: delivered.state } : result,
    });
    return delivered.response ?? result.response;
  }

  if (result.telegramVideo) {
    return { text: result.response, telegramVideo: result.telegramVideo };
  }
  return result.response;
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

export function handleParsedCommand(parsed, repos, state, taskExecutor, chatId = null, options = {}) {
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
      return handleAgent(parsed.args, state, taskExecutor, chatId, {
        agentTaskTimeoutMs: options.agentTaskTimeoutMs ?? null,
      });
    case "/approve":
    case "/reject":
    case "/always_allow":
    case "/always_reject":
      return handleApprovalCommand(parsed.command, parsed.args, state, chatId);
    case "/approval_test":
      return handleApprovalTest(state, chatId);
    case "/camera_clip":
      return handleCameraClip(parsed.args, options.cameraClipConfig, options.cameraClipOptions);
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

function handleApprovalTest(state, chatId) {
  const result = createApprovalTestRequest({ state, chatId });
  return {
    ...result,
    approvalNotification: {
      requestId: result.request.requestId,
      chatId: result.request.chatId,
      text: buildApprovalTelegramMessage(result.request),
      replyMarkup: buildApprovalInlineKeyboard(result.request),
      request: result.request,
    },
  };
}

function notifyApprovalRequestIfNeeded({ onApprovalRequest, statePath, result }) {
  if (!onApprovalRequest || !result?.approvalNotification) {
    return;
  }

  void (async () => {
    try {
      const sent = await onApprovalRequest(result.approvalNotification);
      if (!sent || !Number.isSafeInteger(sent.telegramMessageId)) {
        return;
      }
      const currentState = loadRuntimeState(statePath);
      const current = currentState.approvalRequests[result.approvalNotification.requestId];
      if (current?.status === "pending") {
        saveRuntimeState(statePath, {
          ...currentState,
          approvalRequests: {
            ...currentState.approvalRequests,
            [current.requestId]: {
              ...current,
              telegramMessageId: sent.telegramMessageId,
            },
          },
        });
      }
    } catch {
      // Approval test notification failures must not make command handling fail.
    }
  })();
}

function handleAgentChatText(text, repos, state, taskExecutor, chatId, options = {}) {
  if (text.length === 0) {
    return { response: "Unknown command.\nUse /help.", stateChanged: false };
  }

  if (!state?.currentRepo || !state?.cwd) {
    return { response: "No workspace selected.\nUse /repos then /use <repo>.", stateChanged: false };
  }

  const chatKey = chatId === null || chatId === undefined ? null : String(chatId);
  if (!isAgentChatModeEnabled(state, { chatId: chatKey, repoAlias: state.currentRepo })) {
    return {
      response: "Agent chat mode is off for the current chat and repository.\nUse /agent <instruction> to begin.",
      stateChanged: false,
    };
  }

  const activeTask = findActiveAgentTaskForRepo(state, state.currentRepo, state.cwd);
  if (activeTask) {
    return {
      response: `An agent task is already running for this repository: ${activeTask.taskId}.\nUse /status or /stop ${activeTask.taskId} before sending another follow-up.`,
      stateChanged: false,
    };
  }

  const binding = getAskSessionBinding(state, { chatId: chatKey, repoAlias: state.currentRepo });
  if (!binding) {
    return {
      response: "No agent session is bound for agent chat mode.\nUse /agent new <instruction> or /agent resume <session_id> <instruction>.",
      stateChanged: false,
    };
  }

  return handleAgent(text, state, taskExecutor, chatId, {
    agentTaskTimeoutMs: options.agentTaskTimeoutMs ?? null,
  });
}

function findActiveAgentTaskForRepo(state, repoAlias, cwd) {
  for (const task of Object.values(state?.tasks ?? {})) {
    if (task?.type !== "agent" || !["running", "stopping"].includes(task.status)) {
      continue;
    }
    if (task.repoAlias === repoAlias || task.cwd === cwd) {
      return task;
    }
  }
  return null;
}

function persistAgentChatModeIfNeeded(result, statePath) {
  const mode = result?.enableAgentChatMode;
  if (!mode) {
    return;
  }

  const current = loadRuntimeState(statePath);
  saveRuntimeState(statePath, enableAgentChatMode(current, mode));
}
