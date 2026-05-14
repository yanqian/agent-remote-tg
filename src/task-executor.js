import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn as defaultSpawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  isValidCodexSessionId,
  loadRuntimeState,
  saveRuntimeState,
  updateAskSessionBinding,
} from "./runtime-state.js";

export const TASK_TYPES = Object.freeze(["ask", "work", "continue", "run-orch"]);
export const TASK_STATUSES = Object.freeze(["running", "stopping", "stopped", "succeeded", "failed"]);
export const TELEGRAM_RESPONSE_LIMIT = 3500;

const SECRET_NAME_PATTERN = /TOKEN|SECRET|PASSWORD|KEY/i;
const CAPTURED_LOG_LIMIT = 200000;
const ACTIVE_STATUSES = new Set(["running", "stopping"]);
const FINISHED_STATUSES = new Set(["stopped", "succeeded", "failed"]);
let taskSequence = 0;

export function createTaskExecutor(options) {
  if (!options || typeof options !== "object") {
    throw new Error("task executor options are required.");
  }

  const { statePath, logsDir } = options;
  if (!statePath) {
    throw new Error("statePath is required.");
  }
  if (!logsDir) {
    throw new Error("logsDir is required.");
  }

  const spawn = options.spawn ?? defaultSpawn;
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;
  const onTaskFinished = typeof options.onTaskFinished === "function" ? options.onTaskFinished : null;
  const children = new Map();
  const normalizedLogsDir = resolve(logsDir);
  mkdirSync(normalizedLogsDir, { recursive: true });

  function persistTask(task) {
    const state = loadRuntimeState(statePath);
    let nextState = {
      ...state,
      tasks: {
        ...state.tasks,
        [task.taskId]: task,
      },
    };
    if (task.type === "ask" && task.chatId && task.repoAlias && task.codexSessionId) {
      nextState = updateAskSessionBinding(nextState, {
        chatId: task.chatId,
        repoAlias: task.repoAlias,
        codexSessionId: task.codexSessionId,
      });
    }
    saveRuntimeState(statePath, nextState);
  }

  function startTask({
    type,
    cwd,
    command,
    args = [],
    telegramSecrets = [],
    timeoutMs = null,
    chatId = null,
    repoAlias = null,
    codexSessionId = null,
  }) {
    validateTaskType(type);
    validateSpawnRequest({ cwd, command, args });
    validateTimeout(timeoutMs);

    const state = loadRuntimeState(statePath);
    const taskId = generateTaskId(state.tasks);
    const startedAt = now().toISOString();
    const logPath = logPathForTask(normalizedLogsDir, taskId);
    const task = {
      taskId,
      type,
      status: "running",
      pid: null,
      cwd,
      logPath,
      startedAt,
      finishedAt: null,
      exitCode: null,
    };
    if (typeof chatId === "string" && chatId.length > 0) {
      task.chatId = chatId;
    }
    if (typeof repoAlias === "string" && repoAlias.length > 0) {
      task.repoAlias = repoAlias;
    }
    if (isValidCodexSessionId(codexSessionId)) {
      task.codexSessionId = codexSessionId;
    }

    const log = createWriteStream(logPath, { flags: "a" });
    let capturedLog = "";
    const writeTaskLog = (value) => {
      const text = String(value);
      log.write(text);
      capturedLog = `${capturedLog}${text}`;
      if (capturedLog.length > CAPTURED_LOG_LIMIT) {
        capturedLog = capturedLog.slice(capturedLog.length - CAPTURED_LOG_LIMIT);
      }
    };
    const writeTaskLogLine = (line) => {
      writeTaskLog(`${line}\n`);
    };

    writeTaskLogLine(`startedAt=${startedAt}`);
    writeTaskLogLine(`cwd=${cwd}`);
    writeTaskLogLine(`argv=${JSON.stringify([command, ...args])}`);

    const child = spawn(command, args, {
      cwd,
      shell: false,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    task.pid = typeof child.pid === "number" ? child.pid : null;
    children.set(taskId, child);
    persistTask(task);

    let timedOut = false;
    const timeout = timeoutMs === null
      ? null
      : setTimeout(() => {
        timedOut = true;
        writeTaskLogLine(`timeoutMs=${timeoutMs}`);
        if (typeof child.kill === "function") {
          child.kill("SIGTERM");
        }
      }, timeoutMs);
    if (timeout && typeof timeout.unref === "function") {
      timeout.unref();
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        writeTaskLog(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        writeTaskLog(chunk);
      });
    }

    let finalized = false;
    const completion = new Promise((resolveCompletion) => {
      function finalize(nextTask, extraLogLines = []) {
        if (finalized) {
          return;
        }
        finalized = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        for (const line of extraLogLines) {
          writeTaskLogLine(line);
        }
        const finalResult = redactForTelegram(extractFinalResultFromLog(capturedLog), env, telegramSecrets);
        const discoveredSessionId = extractCodexSessionIdFromLog(capturedLog);
        const sessionMetadata = discoveredSessionId ? { codexSessionId: discoveredSessionId } : {};
        const taskToPersist = FINISHED_STATUSES.has(nextTask.status)
          ? { ...nextTask, ...sessionMetadata, finalResult }
          : nextTask;
        children.delete(taskId);
        persistTask(taskToPersist);
        log.end(async () => {
          if (onTaskFinished && taskToPersist.chatId) {
            try {
              await onTaskFinished(taskToPersist);
            } catch {
              // Completion notification failures must not alter the stored task result.
            }
          }
          resolveCompletion(taskToPersist);
        });
      }

      child.on("error", (error) => {
        const finishedAt = now().toISOString();
        const nextTask = {
          ...task,
          status: "failed",
          finishedAt,
          exitCode: null,
        };
        finalize(nextTask, [
          `error=${error instanceof Error ? error.message : String(error)}`,
          `finishedAt=${finishedAt}`,
          "exitCode=null",
        ]);
      });

      child.on("close", (code, signal) => {
        const finishedAt = now().toISOString();
        const current = loadRuntimeState(statePath).tasks[taskId] ?? task;
        const status = current.status === "stopping" ? "stopped" : code === 0 ? "succeeded" : "failed";
        const nextTask = {
          ...current,
          status,
          finishedAt,
          exitCode: typeof code === "number" ? code : null,
        };
        const extraLogLines = [
          `finishedAt=${finishedAt}`,
          `exitCode=${nextTask.exitCode === null ? "null" : nextTask.exitCode}`,
        ];
        if (signal) {
          extraLogLines.push(`signal=${signal}`);
        }
        if (timedOut) {
          extraLogLines.push("timedOut=true");
        }
        finalize(nextTask, extraLogLines);
      });
    });

    return {
      task,
      completion,
      response: redactForTelegram(formatTaskCreatedResponse(taskId), env, telegramSecrets),
    };
  }

  function stopTask(taskId) {
    validateTaskId(taskId);
    const state = loadRuntimeState(statePath);
    const task = state.tasks[taskId];
    if (!task) {
      return { ok: false, response: `Unknown task: ${taskId}` };
    }
    if (task.status !== "running") {
      return { ok: false, response: `Task is not running: ${taskId}` };
    }

    const child = children.get(taskId);
    if (!child || typeof child.kill !== "function") {
      return { ok: false, response: `Task is not active: ${taskId}` };
    }

    const nextTask = { ...task, status: "stopping" };
    persistTask(nextTask);
    child.kill("SIGTERM");
    return { ok: true, task: nextTask, response: `Stopping task ${taskId}.` };
  }

  function readTaskLog(taskId, lineCount = 120) {
    validateTaskId(taskId);
    if (!Number.isInteger(lineCount) || lineCount <= 0) {
      throw new Error("lineCount must be a positive integer.");
    }

    const state = loadRuntimeState(statePath);
    const task = state.tasks[taskId];
    if (!task) {
      return { ok: false, response: `Unknown task: ${taskId}` };
    }

    if (ACTIVE_STATUSES.has(task.status)) {
      return { ok: true, response: formatTaskLogResponse(task, `Task is ${task.status}. Final result is not available yet.`) };
    }

    const expectedLogPath = logPathForTask(normalizedLogsDir, taskId);
    const recordedLogPath = typeof task.logPath === "string" ? resolve(task.logPath) : "";
    if (recordedLogPath !== expectedLogPath || !isPathInside(normalizedLogsDir, recordedLogPath)) {
      return { ok: false, response: `Invalid log path for task: ${taskId}` };
    }

    if (FINISHED_STATUSES.has(task.status)) {
      const finalResult = task.finalResult ? task.finalResult : `(no final result for ${taskId})`;
      return {
        ok: true,
        response: formatTaskLogResponse(task, finalResult),
      };
    }

    const content = existsSync(recordedLogPath) ? readFileSync(recordedLogPath, "utf8") : "";
    const lines = content.length === 0 ? [] : content.replace(/\n$/, "").split(/\r?\n/);
    const tail = lines.slice(-lineCount).join("\n");
    return {
      ok: true,
      response: truncateTelegramResponse(tail || `(no log output for ${taskId})`),
    };
  }

  return { startTask, stopTask, readTaskLog };
}

function formatTaskLogResponse(task, body) {
  const text = hasCodexSessionId(task)
    ? `Codex session: ${task.codexSessionId}\n\n${body}`
    : body;
  return truncateTelegramResponse(text);
}

function hasCodexSessionId(task) {
  return typeof task?.codexSessionId === "string" && task.codexSessionId.length > 0;
}

export function generateTaskId(existingTasks = {}) {
  let taskId;
  do {
    taskSequence += 1;
    taskId = `task_${Date.now().toString(36)}_${taskSequence.toString(36)}`;
  } while (existingTasks && Object.hasOwn(existingTasks, taskId));
  return taskId;
}

export function logPathForTask(logsDir, taskId) {
  validateTaskId(taskId);
  return resolve(logsDir, `${taskId}.log`);
}

export function isPathInside(parentDir, childPath) {
  const relativePath = relative(resolve(parentDir), resolve(childPath));
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

export function validateTaskId(taskId) {
  if (typeof taskId !== "string" || !/^task_[a-z0-9]+_[a-z0-9]+$/.test(taskId)) {
    throw new Error("Invalid task ID.");
  }
}

export function validateTaskType(type) {
  if (!TASK_TYPES.includes(type)) {
    throw new Error(`Invalid task type: ${type}`);
  }
}

export function validateSpawnRequest({ cwd, command, args }) {
  if (!cwd || typeof cwd !== "string") {
    throw new Error("cwd is required.");
  }
  if (!command || typeof command !== "string") {
    throw new Error("command is required.");
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new Error("args must be an array of strings.");
  }
}

export function validateTimeout(timeoutMs) {
  if (timeoutMs === null) {
    return;
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer or null.");
  }
}

export function redactForTelegram(text, env = process.env, extraSecrets = []) {
  const secrets = collectSecretValues(env, extraSecrets);
  let redacted = String(text);
  for (const secret of secrets) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return truncateTelegramResponse(redacted);
}

export function collectSecretValues(env = process.env, extraSecrets = []) {
  const values = [];
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_NAME_PATTERN.test(name) && typeof value === "string" && value.length > 0) {
      values.push(value);
    }
  }
  for (const value of extraSecrets) {
    if (typeof value === "string" && value.length > 0) {
      values.push(value);
    }
  }
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function truncateTelegramResponse(text) {
  const value = String(text);
  if (value.length <= TELEGRAM_RESPONSE_LIMIT) {
    return value;
  }
  const suffix = "\n[truncated]";
  return `${value.slice(0, TELEGRAM_RESPONSE_LIMIT - suffix.length)}${suffix}`;
}

export function formatTaskCreatedResponse(taskId) {
  return `Task started: ${taskId}\nUse /logs ${taskId} to view output.`;
}

export function formatTaskCompletionMessage(task) {
  const taskId = task?.taskId ?? "unknown";
  const status = task?.status ?? "unknown";
  const finalResult = task?.finalResult ? task.finalResult : `(no final result for ${taskId})`;
  return truncateTelegramResponse(`Task finished: ${taskId}\nStatus: ${status}\n\n${finalResult}`);
}

export function extractFinalResultFromLog(rawLog) {
  const normalized = stripAnsi(String(rawLog ?? "")).replace(/\r\n/g, "\n").trimEnd();
  if (normalized.length === 0) {
    return "";
  }

  const lines = normalized.split("\n");
  const structuredResult = extractStructuredFinalResult(lines);
  if (structuredResult) {
    return structuredResult;
  }

  const markerIndex = findLastAnswerMarkerIndex(lines);
  if (markerIndex === -1) {
    return "";
  }

  const markerText = extractInlineMarkerText(lines[markerIndex]);
  const resultLines = markerText ? [markerText, ...lines.slice(markerIndex + 1)] : lines.slice(markerIndex + 1);
  const cleaned = trimNoiseLines(removeTokenUsageBlocks(resultLines)).join("\n").trim();
  return collapseDuplicatedFinalText(cleaned);
}

function extractStructuredFinalResult(lines) {
  let lastCandidate = "";
  for (const line of lines) {
    const parsed = parseJsonLine(line);
    if (!parsed) {
      continue;
    }
    const candidate = extractStructuredAnswerCandidate(parsed);
    if (candidate) {
      lastCandidate = candidate;
    }
  }
  return lastCandidate;
}

function parseJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractStructuredAnswerCandidate(parsed) {
  const eventType = typeof parsed.type === "string" ? parsed.type : typeof parsed.event === "string" ? parsed.event : "";
  const item = parsed.item && typeof parsed.item === "object" && !Array.isArray(parsed.item) ? parsed.item : parsed;
  const itemType = typeof item.type === "string" ? item.type : "";
  const role = typeof item.role === "string" ? item.role : "";
  const isCompletedItem = /^item\.completed$/i.test(eventType);
  const isAssistantEvent = /^(?:assistant|agent)(?:_message)?$/i.test(eventType);
  const isUserFacingMessage = /^(?:agent_message|assistant_message)$/i.test(itemType)
    || (/^message$/i.test(itemType) && /^(?:assistant|agent)$/i.test(role));
  if ((!isCompletedItem && !isAssistantEvent) || !isUserFacingMessage) {
    return "";
  }

  const text = extractStructuredMessageText(item);
  if (!text) {
    return "";
  }
  const cleaned = trimNoiseLines(removeTokenUsageBlocks(text.replace(/\r\n/g, "\n").split("\n"))).join("\n").trim();
  return collapseDuplicatedFinalText(cleaned);
}

function extractStructuredMessageText(item) {
  for (const key of ["text", "message", "content", "output_text"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  if (Array.isArray(item.content)) {
    const pieces = [];
    for (const part of item.content) {
      if (typeof part === "string") {
        pieces.push(part);
      } else if (part && typeof part === "object" && typeof part.text === "string") {
        pieces.push(part.text);
      }
    }
    return pieces.join("");
  }

  return "";
}

export function extractCodexSessionIdFromLog(rawLog) {
  const normalized = stripAnsi(String(rawLog ?? "")).replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return "";
  }

  let found = "";
  let assistantOutputStarted = false;
  let preAnswerMetadataOpen = true;
  for (const line of normalized.split("\n")) {
    if (isAssistantOutputStartLine(line)) {
      assistantOutputStarted = true;
      preAnswerMetadataOpen = false;
      continue;
    }

    if (assistantOutputStarted) {
      continue;
    }

    if (isInitialTaskLogMetadataLine(line)) {
      continue;
    }

    if (preAnswerMetadataOpen) {
      const structuredSessionId = extractStructuredCodexSessionId(line);
      if (structuredSessionId) {
        found = structuredSessionId;
        continue;
      }

      const metadataSessionId = extractPreAnswerSessionMetadata(line);
      if (metadataSessionId) {
        found = metadataSessionId;
        continue;
      }
    }

    if (line.trim() !== "") {
      preAnswerMetadataOpen = false;
    }
  }
  return found;
}

function extractStructuredCodexSessionId(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return "";
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "";
  }

  const eventType = typeof parsed.type === "string" ? parsed.type : typeof parsed.event === "string" ? parsed.event : "";
  const sessionId = firstValidSessionId([
    parsed.session_id,
    parsed.sessionId,
    parsed.conversation_id,
    parsed.conversationId,
    parsed.session?.id,
    parsed.conversation?.id,
    parsed.msg?.session_id,
    parsed.msg?.sessionId,
    parsed.msg?.conversation_id,
    parsed.msg?.conversationId,
  ]);
  if (!sessionId) {
    return "";
  }

  if (eventType && /session|conversation|started|configured|resumed|turn_context/i.test(eventType)) {
    return sessionId;
  }

  const keys = Object.keys(parsed);
  const bareSessionMetadata = keys.every((key) => [
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
    "session",
    "conversation",
  ].includes(key));
  return bareSessionMetadata ? sessionId : "";
}

function firstValidSessionId(values) {
  for (const value of values) {
    if (isValidCodexSessionId(value)) {
      return value;
    }
  }
  return "";
}

function extractPreAnswerSessionMetadata(line) {
  const trimmed = line.trim();
  const patterns = [
    /^(?:codex\s+)?session(?:\s+id)?\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._:-]{5,199})$/i,
    /^conversation(?:\s+id)?\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._:-]{5,199})$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && isValidCodexSessionId(match[1])) {
      return match[1];
    }
  }
  return "";
}

function isInitialTaskLogMetadataLine(line) {
  const trimmed = line.trim();
  return trimmed === ""
    || /^startedAt=/.test(trimmed)
    || /^cwd=/.test(trimmed)
    || /^argv=/.test(trimmed);
}

function isAssistantOutputStartLine(line) {
  const value = line.trim();
  if (/^(?:codex|assistant|final answer)\s*:?(?:\s+\S.*)?$/i.test(value)) {
    return true;
  }

  if (!value.startsWith("{") || !value.endsWith("}")) {
    return false;
  }
  try {
    const parsed = JSON.parse(value);
    const eventType = typeof parsed.type === "string" ? parsed.type : typeof parsed.event === "string" ? parsed.event : "";
    return /\b(?:assistant|message|final|response)\b/i.test(eventType)
      && typeof (parsed.message ?? parsed.content ?? parsed.text ?? parsed.delta) === "string";
  } catch {
    return false;
  }
}

function findLastAnswerMarkerIndex(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (/^(?:codex|assistant|final answer)\s*:?\s*$/i.test(line)) {
      return index;
    }
    if (/^(?:codex|assistant|final answer)\s*:\s+\S/i.test(line)) {
      return index;
    }
  }
  return -1;
}

function extractInlineMarkerText(line) {
  const match = line.trim().match(/^(?:codex|assistant|final answer)\s*:\s+([\s\S]+)$/i);
  return match ? match[1] : "";
}

function trimNoiseLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") {
    start += 1;
  }
  while (end > start && isTrailingNoiseLine(lines[end - 1])) {
    end -= 1;
  }
  return lines.slice(start, end);
}

function removeTokenUsageBlocks(lines) {
  const cleaned = [];
  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (!/^tokens used\b/i.test(value)) {
      cleaned.push(lines[index]);
      continue;
    }

    while (index + 1 < lines.length) {
      const nextValue = lines[index + 1].trim();
      if (nextValue === "" || isTokenCountLine(nextValue)) {
        index += 1;
        continue;
      }
      break;
    }
  }
  return cleaned;
}

function isTokenCountLine(value) {
  return /^[\d,]+(?:\s+tokens?)?$/i.test(value);
}

function isTrailingNoiseLine(line) {
  const value = line.trim();
  return value === ""
    || /^tokens used\b/i.test(value)
    || /^total tokens\b/i.test(value)
    || /^input tokens\b/i.test(value)
    || /^output tokens\b/i.test(value)
    || /^finishedAt=/.test(value)
    || /^exitCode=/.test(value)
    || /^signal=/.test(value)
    || /^timedOut=/.test(value);
}

function collapseDuplicatedFinalText(text) {
  if (!text) {
    return "";
  }
  const paragraphs = text.split(/\n{2,}/);
  if (paragraphs.length % 2 === 0) {
    const midpoint = paragraphs.length / 2;
    const left = paragraphs.slice(0, midpoint).join("\n\n").trim();
    const right = paragraphs.slice(midpoint).join("\n\n").trim();
    if (left && left === right) {
      return left;
    }
  }

  const lines = text.split("\n");
  if (lines.length % 2 === 0) {
    const midpoint = lines.length / 2;
    const left = lines.slice(0, midpoint).join("\n").trim();
    const right = lines.slice(midpoint).join("\n").trim();
    if (left && left === right) {
      return left;
    }
  }
  return text;
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
