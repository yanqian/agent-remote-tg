import { requireWorkspace } from "./workspace.js";
import {
  disableAgentChatMode,
  enableAgentChatMode,
  getAskSessionBinding,
  isAgentChatModeEnabled,
  isValidCodexSessionId,
} from "./runtime-state.js";

export const DEFAULT_AGENT_TASK_TIMEOUT_MS = null;
export const AGENT_TIMEOUT_MS = DEFAULT_AGENT_TASK_TIMEOUT_MS;
export const ASK_TIMEOUT_MS = DEFAULT_AGENT_TASK_TIMEOUT_MS;
const AGENT_USAGE = "Usage: /agent <instruction> | /agent new <instruction> | /agent resume <session_id|--last> <instruction> | /agent exit | /agent session | /agent -- <instruction>";
const AGENT_RESERVED_SUBCOMMANDS = new Set(["new", "resume", "exit", "session"]);

export function buildAgentPrompt(instruction) {
  return [
    "Act as a general-purpose Codex agent for the selected repository.",
    "",
    "Rules:",
    "- Use repository files and git history as the source of truth.",
    "- Do not rely on Telegram chat history.",
    "- For implementation requests, read and follow AGENTS.md before changing files.",
    "- Preserve unrelated user changes and existing git history.",
    "- Keep shell execution disabled; the Bot has already spawned this task safely.",
    "- Summarize actions taken, changed files, verification commands, and remaining issues.",
    "",
    "Instruction:",
    instruction,
  ].join("\n");
}

export function buildAskPrompt(question) {
  return buildAgentPrompt(question);
}

export function handleAgent(args, state, taskExecutor, chatId = null, options = {}) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }

  const chatKey = chatId === null || chatId === undefined ? null : String(chatId);
  const request = parseAgentRequest(args);
  if (!request.ok) {
    return { response: request.response, stateChanged: false };
  }

  if (request.action === "exit") {
    const nextState = disableAgentChatMode(state, { chatId: chatKey, repoAlias: workspace.currentRepo });
    return {
      response: "Agent chat mode disabled for the current chat and repository.",
      state: nextState,
      stateChanged: true,
    };
  }

  if (request.action === "session") {
    const binding = chatKey
      ? getAskSessionBinding(state, { chatId: chatKey, repoAlias: workspace.currentRepo })
      : null;
    const mode = chatKey
      ? isAgentChatModeEnabled(state, { chatId: chatKey, repoAlias: workspace.currentRepo })
      : false;
    return {
      response: [
        "Current agent session:",
        `repo: ${workspace.currentRepo}`,
        `session: ${binding?.codexSessionId ?? "none"}`,
        `chat mode: ${mode ? "on" : "off"}`,
      ].join("\n"),
      stateChanged: false,
    };
  }

  if (!taskExecutor || typeof taskExecutor.startTask !== "function") {
    throw new Error("taskExecutor.startTask is required.");
  }

  const currentBinding = chatKey
    ? getAskSessionBinding(state, { chatId: chatKey, repoAlias: workspace.currentRepo })
    : null;
  const codexSessionId = request.action === "resume"
    ? request.sessionId
    : request.action === "plain"
      ? currentBinding?.codexSessionId ?? null
      : null;
  const commandArgs = buildAgentCommandArgs(request, codexSessionId);

  const started = taskExecutor.startTask({
    type: "agent",
    cwd: workspace.cwd,
    command: "codex",
    args: commandArgs,
    timeoutMs: options.agentTaskTimeoutMs ?? DEFAULT_AGENT_TASK_TIMEOUT_MS,
    chatId: chatKey,
    repoAlias: workspace.currentRepo,
    codexSessionId,
  });

  const modeState = enableAgentChatMode(state, { chatId: chatKey, repoAlias: workspace.currentRepo });
  const modeUpdate = {
    enableAgentChatMode: {
      chatId: chatKey,
      repoAlias: workspace.currentRepo,
    },
    state: modeState,
  };

  if (request.action === "resume" || (request.action === "plain" && codexSessionId)) {
    return {
      response: `${started.response}\nResumed agent session: ${codexSessionId}`,
      stateChanged: false,
      ...modeUpdate,
    };
  }

  return {
    response: request.action === "resume-last"
      ? `${started.response}\nUsing Codex CLI --last for the runtime user account; binding will update when the session ID is discovered.`
      : started.response,
    stateChanged: false,
    ...modeUpdate,
  };
}

export function handleAsk(args, state, taskExecutor, chatId = null) {
  return handleAgent(args, state, taskExecutor, chatId);
}

export function parseAgentRequest(args) {
  const text = String(args ?? "").trim();
  if (text.length === 0) {
    return { ok: false, response: AGENT_USAGE };
  }

  if (text === "--") {
    return { ok: false, response: AGENT_USAGE };
  }

  if (text.startsWith("-- ")) {
    const message = text.slice(3).trim();
    return message.length > 0
      ? { ok: true, action: "plain", message }
      : { ok: false, response: AGENT_USAGE };
  }

  const [firstToken, rest] = splitFirstToken(text);
  if (!AGENT_RESERVED_SUBCOMMANDS.has(firstToken)) {
    return { ok: true, action: "plain", message: text };
  }

  if (firstToken === "new") {
    return rest.length > 0
      ? { ok: true, action: "new", message: rest }
      : { ok: false, response: "Usage: /agent new <instruction>" };
  }

  if (firstToken === "resume") {
    const [sessionId, message] = splitFirstToken(rest);
    if (sessionId === "--last") {
      return message.length > 0
        ? { ok: true, action: "resume-last", message }
        : { ok: false, response: "Usage: /agent resume --last <instruction>" };
    }
    if (!isValidCodexSessionId(sessionId) || message.length === 0) {
      return { ok: false, response: "Usage: /agent resume <session_id> <instruction>" };
    }
    return { ok: true, action: "resume", sessionId, message };
  }

  if (firstToken === "exit") {
    return rest.length === 0
      ? { ok: true, action: "exit" }
      : { ok: false, response: "Usage: /agent exit" };
  }

  return rest.length === 0
    ? { ok: true, action: "session" }
    : { ok: false, response: "Usage: /agent session" };
}

export function parseAskRequest(args) {
  return parseAgentRequest(args);
}

function buildAgentCommandArgs(request, codexSessionId) {
  if (request.action === "resume-last") {
    return ["exec", "--json", "resume", "--last", request.message];
  }
  if (codexSessionId) {
    return ["exec", "--json", "resume", codexSessionId, request.message];
  }
  return ["exec", "--json", buildAgentPrompt(request.message)];
}

function splitFirstToken(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length === 0) {
    return ["", ""];
  }
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return [match?.[1] ?? "", (match?.[2] ?? "").trim()];
}
