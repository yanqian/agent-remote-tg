import { validateTaskId } from "./task-executor.js";

const ACTIVE_STATUSES = new Set(["running", "stopping"]);
const FINISHED_STATUSES = new Set(["stopped", "succeeded", "failed"]);
const RECENT_FINISHED_LIMIT = 5;
const LOG_TAIL_LINES = 120;

export function handleStatus(state) {
  const tasks = Object.values(state.tasks ?? {});
  const activeTasks = tasks
    .filter((task) => ACTIVE_STATUSES.has(task.status))
    .sort(compareTasksByStartedAt);
  const finishedTasks = tasks
    .filter((task) => FINISHED_STATUSES.has(task.status))
    .sort(compareTasksByFinishedAt)
    .slice(0, RECENT_FINISHED_LIMIT);
  const selectedTasks = [...activeTasks, ...finishedTasks];

  if (selectedTasks.length === 0) {
    return { response: "Current tasks:\n\nNo active or recent finished tasks.", stateChanged: false };
  }

  return {
    response: `Current tasks:\n\n${selectedTasks.map(formatTaskStatus).join("\n\n")}`,
    stateChanged: false,
  };
}

export function handleLogs(taskId, taskExecutor) {
  if (!isValidTaskId(taskId)) {
    return { response: `Unknown task: ${taskId}`, stateChanged: false };
  }
  if (!taskExecutor || typeof taskExecutor.readTaskLog !== "function") {
    throw new Error("taskExecutor.readTaskLog is required.");
  }

  const result = taskExecutor.readTaskLog(taskId, LOG_TAIL_LINES);
  return { response: result.response, stateChanged: false };
}

export function handleStop(taskId, taskExecutor) {
  if (!isValidTaskId(taskId)) {
    return { response: `Unknown task: ${taskId}`, stateChanged: false };
  }
  if (!taskExecutor || typeof taskExecutor.stopTask !== "function") {
    throw new Error("taskExecutor.stopTask is required.");
  }

  const result = taskExecutor.stopTask(taskId);
  return { response: result.response, stateChanged: false };
}

function formatTaskStatus(task) {
  const lines = [
    task.taskId,
    `type: ${formatNullable(task.type)}`,
    `status: ${formatNullable(task.status)}`,
    `pid: ${formatNullable(task.pid)}`,
    `cwd: ${formatNullable(task.cwd)}`,
    `startedAt: ${formatNullable(task.startedAt)}`,
    `finishedAt: ${formatNullable(task.finishedAt)}`,
    `exitCode: ${formatNullable(task.exitCode)}`,
  ];

  if (hasCodexSessionId(task)) {
    lines.splice(3, 0, `codexSessionId: ${task.codexSessionId}`);
  }

  return lines.join("\n");
}

function compareTasksByStartedAt(left, right) {
  return compareDescending(left.startedAt, right.startedAt);
}

function compareTasksByFinishedAt(left, right) {
  return compareDescending(rightSortTime(left), rightSortTime(right));
}

function rightSortTime(task) {
  return task.finishedAt ?? task.startedAt ?? "";
}

function compareDescending(left, right) {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

function formatNullable(value) {
  return value === undefined || value === null ? "null" : String(value);
}

function hasCodexSessionId(task) {
  return typeof task?.codexSessionId === "string" && task.codexSessionId.length > 0;
}

function isValidTaskId(taskId) {
  try {
    validateTaskId(taskId);
    return true;
  } catch {
    return false;
  }
}
