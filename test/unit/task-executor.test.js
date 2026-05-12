import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskExecutor,
  formatTaskCreatedResponse,
  generateTaskId,
  isPathInside,
  logPathForTask,
  redactForTelegram,
  truncateTelegramResponse,
  validateTimeout,
} from "../../src/task-executor.js";

test("generateTaskId returns safe unique task IDs", () => {
  const first = generateTaskId();
  const second = generateTaskId({ [first]: { status: "running" } });

  assert.match(first, /^task_[a-z0-9]+_[a-z0-9]+$/);
  assert.match(second, /^task_[a-z0-9]+_[a-z0-9]+$/);
  assert.notEqual(first, second);
});

test("logPathForTask rejects traversal task IDs", () => {
  assert.throws(() => logPathForTask("/tmp/logs", "../secret"), /Invalid task ID/);
  assert.throws(() => logPathForTask("/tmp/logs", "task_abc/def"), /Invalid task ID/);
});

test("isPathInside checks log path confinement", () => {
  assert.equal(isPathInside("/tmp/logs", "/tmp/logs/task_abc_1.log"), true);
  assert.equal(isPathInside("/tmp/logs", "/tmp/logs/nested/task_abc_1.log"), true);
  assert.equal(isPathInside("/tmp/logs", "/tmp/logs2/task_abc_1.log"), false);
  assert.equal(isPathInside("/tmp/logs", "/tmp/secret.log"), false);
});

test("redactForTelegram hides configured secrets and bounds responses", () => {
  const redacted = redactForTelegram(
    "token=abc123 password=extra plain",
    { TELEGRAM_BOT_TOKEN: "abc123", NORMAL: "plain" },
    ["extra"],
  );

  assert.equal(redacted, "token=[REDACTED] password=[REDACTED] plain");
  assert.equal(truncateTelegramResponse("x".repeat(3600)).length, 3500);
});

test("formatTaskCreatedResponse includes task ID and log instruction", () => {
  assert.equal(
    formatTaskCreatedResponse("task_abc_1"),
    "Task started: task_abc_1\nUse /logs task_abc_1 to view output.",
  );
});

test("startTask spawns without shell, persists metadata, logs output, and records success", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  const calls = [];
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    const child = createFakeChild({ pid: 4242 });
    const executor = createTaskExecutor({
      statePath,
      logsDir,
      env: { TELEGRAM_BOT_TOKEN: "secret-token" },
      now: fixedClock([
        "2026-05-12T00:00:00.000Z",
        "2026-05-12T00:00:01.000Z",
      ]),
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return child;
      },
    });

    const started = executor.startTask({
      type: "ask",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "say secret-token"],
    });

    assert.match(started.task.taskId, /^task_[a-z0-9]+_[a-z0-9]+$/);
    assert.equal(started.task.status, "running");
    assert.equal(started.task.pid, 4242);
    assert.equal(started.response, `Task started: ${started.task.taskId}\nUse /logs ${started.task.taskId} to view output.`);
    assert.equal(calls[0].command, "codex");
    assert.deepEqual(calls[0].args, ["exec", "say secret-token"]);
    assert.equal(calls[0].options.cwd, rootDir);
    assert.equal(calls[0].options.shell, false);

    child.stdout.write("stdout line\n");
    child.stderr.write("stderr line\n");
    child.emit("close", 0, null);

    const finished = await started.completion;
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.exitCode, 0);
    assert.equal(finished.finishedAt, "2026-05-12T00:00:01.000Z");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(state.tasks[started.task.taskId], finished);

    const log = readFileSync(finished.logPath, "utf8");
    assert.match(log, /startedAt=2026-05-12T00:00:00.000Z/);
    assert.match(log, /argv=\["codex","exec","say secret-token"\]/);
    assert.match(log, /stdout line/);
    assert.match(log, /stderr line/);
    assert.match(log, /exitCode=0/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("startTask records non-zero exits as failed", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const child = createFakeChild({ pid: 4243 });
    const executor = createTaskExecutor({
      statePath: join(rootDir, "runtime_state.json"),
      logsDir: join(rootDir, "logs"),
      spawn() {
        return child;
      },
    });

    const started = executor.startTask({
      type: "run-orch",
      cwd: rootDir,
      command: "python3",
      args: ["orchestrator.py", "--max-rounds", "1"],
    });
    child.emit("close", 2, null);

    const finished = await started.completion;
    assert.equal(finished.status, "failed");
    assert.equal(finished.exitCode, 2);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("stopTask transitions a running recorded child to stopping and sends SIGTERM", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  const child = createFakeChild({ pid: 4244 });
  try {
    const executor = createTaskExecutor({
      statePath: join(rootDir, "runtime_state.json"),
      logsDir: join(rootDir, "logs"),
      spawn() {
        return child;
      },
    });

    const started = executor.startTask({
      type: "work",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "work"],
    });
    const stopped = executor.stopTask(started.task.taskId);

    assert.equal(stopped.ok, true);
    assert.equal(stopped.task.status, "stopping");
    assert.deepEqual(child.killSignals, ["SIGTERM"]);

    child.emit("close", null, "SIGTERM");
    const finished = await started.completion;
    assert.equal(finished.status, "stopped");
    assert.equal(finished.exitCode, null);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("stopTask rejects unknown and non-running tasks without SIGTERM", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  const child = createFakeChild({ pid: 4246 });
  try {
    const executor = createTaskExecutor({
      statePath: join(rootDir, "runtime_state.json"),
      logsDir: join(rootDir, "logs"),
      spawn() {
        return child;
      },
    });

    assert.deepEqual(executor.stopTask("task_nope_1"), {
      ok: false,
      response: "Unknown task: task_nope_1",
    });

    const started = executor.startTask({
      type: "ask",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "done"],
    });
    child.emit("close", 0, null);
    await started.completion;

    assert.deepEqual(executor.stopTask(started.task.taskId), {
      ok: false,
      response: `Task is not running: ${started.task.taskId}`,
    });
    assert.deepEqual(child.killSignals, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("readTaskLog returns the last 120 lines and rejects confined path violations", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const taskId = "task_abc_1";
    const logPath = join(logsDir, `${taskId}.log`);
    writeFileSync(logPath, Array.from({ length: 130 }, (_, index) => `line ${index + 1}`).join("\n"));
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {
        [taskId]: {
          taskId,
          type: "ask",
          status: "succeeded",
          pid: 123,
          cwd: rootDir,
          logPath,
          startedAt: "2026-05-12T00:00:00.000Z",
          finishedAt: "2026-05-12T00:00:01.000Z",
          exitCode: 0,
        },
        task_bad_1: {
          taskId: "task_bad_1",
          type: "ask",
          status: "failed",
          pid: null,
          cwd: rootDir,
          logPath: join(rootDir, "secret.log"),
          startedAt: "2026-05-12T00:00:00.000Z",
          finishedAt: "2026-05-12T00:00:01.000Z",
          exitCode: 1,
        },
      },
    }, null, 2)}\n`);

    const executor = createTaskExecutor({ statePath, logsDir });
    const logResult = executor.readTaskLog(taskId);

    assert.equal(logResult.ok, true);
    assert.equal(logResult.response.startsWith("line 11\n"), true);
    assert.equal(logResult.response.includes("line 130"), true);
    assert.deepEqual(executor.readTaskLog("task_nope_1"), {
      ok: false,
      response: "Unknown task: task_nope_1",
    });
    assert.deepEqual(executor.readTaskLog("task_bad_1"), {
      ok: false,
      response: "Invalid log path for task: task_bad_1",
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("startTask enforces timeout with SIGTERM and records failed timeout", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  const child = createFakeChild({ pid: 4245 });
  try {
    const executor = createTaskExecutor({
      statePath: join(rootDir, "runtime_state.json"),
      logsDir: join(rootDir, "logs"),
      now: fixedClock([
        "2026-05-12T00:00:00.000Z",
        "2026-05-12T00:10:00.000Z",
      ]),
      spawn() {
        return child;
      },
    });

    const started = executor.startTask({
      type: "ask",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "read only"],
      timeoutMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(child.killSignals, ["SIGTERM"]);
    child.emit("close", null, "SIGTERM");

    const finished = await started.completion;
    assert.equal(finished.status, "failed");
    assert.equal(finished.exitCode, null);

    const log = readFileSync(finished.logPath, "utf8");
    assert.match(log, /timeoutMs=1/);
    assert.match(log, /timedOut=true/);
    assert.match(log, /signal=SIGTERM/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("validateTimeout rejects invalid timeout values", () => {
  assert.doesNotThrow(() => validateTimeout(null));
  assert.doesNotThrow(() => validateTimeout(600000));
  assert.throws(() => validateTimeout(0), /timeoutMs/);
  assert.throws(() => validateTimeout(1.5), /timeoutMs/);
});

function createFakeChild({ pid }) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killSignals = [];
  child.kill = (signal) => {
    child.killSignals.push(signal);
    return true;
  };
  return child;
}

function fixedClock(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}
