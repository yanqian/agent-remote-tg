import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn as defaultSpawn } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadRuntimeState, saveRuntimeState } from "./runtime-state.js";

export const TASK_TYPES = Object.freeze(["ask", "work", "continue", "run-orch"]);
export const TASK_STATUSES = Object.freeze(["running", "stopping", "stopped", "succeeded", "failed"]);
export const TELEGRAM_RESPONSE_LIMIT = 3500;

const SECRET_NAME_PATTERN = /TOKEN|SECRET|PASSWORD|KEY/i;
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
  const children = new Map();
  const normalizedLogsDir = resolve(logsDir);
  mkdirSync(normalizedLogsDir, { recursive: true });

  function persistTask(task) {
    const state = loadRuntimeState(statePath);
    const nextState = {
      ...state,
      tasks: {
        ...state.tasks,
        [task.taskId]: task,
      },
    };
    saveRuntimeState(statePath, nextState);
  }

  function startTask({ type, cwd, command, args = [], telegramSecrets = [], timeoutMs = null }) {
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

    const log = createWriteStream(logPath, { flags: "a" });
    writeLogLine(log, `startedAt=${startedAt}`);
    writeLogLine(log, `cwd=${cwd}`);
    writeLogLine(log, `argv=${JSON.stringify([command, ...args])}`);

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
        writeLogLine(log, `timeoutMs=${timeoutMs}`);
        if (typeof child.kill === "function") {
          child.kill("SIGTERM");
        }
      }, timeoutMs);
    if (timeout && typeof timeout.unref === "function") {
      timeout.unref();
    }

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        log.write(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        log.write(chunk);
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
          writeLogLine(log, line);
        }
        children.delete(taskId);
        persistTask(nextTask);
        log.end(() => {
          resolveCompletion(nextTask);
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

    const expectedLogPath = logPathForTask(normalizedLogsDir, taskId);
    const recordedLogPath = typeof task.logPath === "string" ? resolve(task.logPath) : "";
    if (recordedLogPath !== expectedLogPath || !isPathInside(normalizedLogsDir, recordedLogPath)) {
      return { ok: false, response: `Invalid log path for task: ${taskId}` };
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

function writeLogLine(log, line) {
  log.write(`${line}\n`);
}
