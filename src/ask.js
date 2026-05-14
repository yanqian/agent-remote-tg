import { requireWorkspace } from "./workspace.js";
import {
  getAskSessionBinding,
  isValidCodexSessionId,
  removeAskSessionBinding,
} from "./runtime-state.js";

export const ASK_TIMEOUT_MS = 10 * 60 * 1000;
const ASK_USAGE = "Usage: /ask <question> | /ask new <message> | /ask resume <session_id|--last> <message> | /ask exit | /ask session | /ask -- <message>";
const ASK_RESERVED_SUBCOMMANDS = new Set(["new", "resume", "exit", "session"]);

export function buildAskPrompt(question) {
  return [
    "Act as a read-only Codex discussion agent for the selected repository.",
    "",
    "Rules:",
    "- Discuss and analyze only.",
    "- Do not modify files.",
    "- Do not update SPEC.md.",
    "- Do not update feature_list.json.",
    "- Do not run orchestrator.py.",
    "- Do not commit.",
    "",
    "Question:",
    question,
  ].join("\n");
}

export function handleAsk(args, state, taskExecutor, chatId = null) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }

  const chatKey = chatId === null || chatId === undefined ? null : String(chatId);
  const request = parseAskRequest(args);
  if (!request.ok) {
    return { response: request.response, stateChanged: false };
  }

  if (request.action === "exit") {
    const nextState = removeAskSessionBinding(state, { chatId: chatKey, repoAlias: workspace.currentRepo });
    return {
      response: "Ask session cleared for the current chat and repository.",
      state: nextState,
      stateChanged: true,
    };
  }

  if (request.action === "session") {
    const binding = chatKey
      ? getAskSessionBinding(state, { chatId: chatKey, repoAlias: workspace.currentRepo })
      : null;
    return {
      response: binding
        ? `Current ask session:\nrepo: ${workspace.currentRepo}\nsession: ${binding.codexSessionId}`
        : "No ask session selected for the current chat and repository.",
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
  const commandArgs = buildAskCommandArgs(request, codexSessionId);

  const started = taskExecutor.startTask({
    type: "ask",
    cwd: workspace.cwd,
    command: "codex",
    args: commandArgs,
    timeoutMs: ASK_TIMEOUT_MS,
    chatId: chatKey,
    repoAlias: workspace.currentRepo,
    codexSessionId,
  });

  if (request.action === "resume" || (request.action === "plain" && codexSessionId)) {
    return {
      response: `${started.response}\nResumed ask session: ${codexSessionId}`,
      stateChanged: false,
    };
  }

  return {
    response: request.action === "resume-last"
      ? `${started.response}\nUsing Codex CLI --last for the runtime user account; binding will update when the session ID is discovered.`
      : started.response,
    stateChanged: false,
  };
}

export function parseAskRequest(args) {
  const text = String(args ?? "").trim();
  if (text.length === 0) {
    return { ok: false, response: ASK_USAGE };
  }

  if (text === "--") {
    return { ok: false, response: ASK_USAGE };
  }

  if (text.startsWith("-- ")) {
    const message = text.slice(3).trim();
    return message.length > 0
      ? { ok: true, action: "plain", message }
      : { ok: false, response: ASK_USAGE };
  }

  const [firstToken, rest] = splitFirstToken(text);
  if (!ASK_RESERVED_SUBCOMMANDS.has(firstToken)) {
    return { ok: true, action: "plain", message: text };
  }

  if (firstToken === "new") {
    return rest.length > 0
      ? { ok: true, action: "new", message: rest }
      : { ok: false, response: "Usage: /ask new <message>" };
  }

  if (firstToken === "resume") {
    const [sessionId, message] = splitFirstToken(rest);
    if (sessionId === "--last") {
      return message.length > 0
        ? { ok: true, action: "resume-last", message }
        : { ok: false, response: "Usage: /ask resume --last <message>" };
    }
    if (!isValidCodexSessionId(sessionId) || message.length === 0) {
      return { ok: false, response: "Usage: /ask resume <session_id> <message>" };
    }
    return { ok: true, action: "resume", sessionId, message };
  }

  if (firstToken === "exit") {
    return rest.length === 0
      ? { ok: true, action: "exit" }
      : { ok: false, response: "Usage: /ask exit" };
  }

  return rest.length === 0
    ? { ok: true, action: "session" }
    : { ok: false, response: "Usage: /ask session" };
}

function buildAskCommandArgs(request, codexSessionId) {
  if (request.action === "resume-last") {
    return ["exec", "--json", "resume", "--last", request.message];
  }
  if (codexSessionId) {
    return ["exec", "--json", "resume", codexSessionId, request.message];
  }
  return ["exec", "--json", buildAskPrompt(request.message)];
}

function splitFirstToken(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length === 0) {
    return ["", ""];
  }
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return [match?.[1] ?? "", (match?.[2] ?? "").trim()];
}
