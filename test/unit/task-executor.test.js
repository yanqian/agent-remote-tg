import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTaskExecutor,
  extractCodexSessionIdFromLog,
  extractFinalResultFromLog,
  formatTaskCompletionMessage,
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

test("formatTaskCompletionMessage includes task ID, status, and stored final result", () => {
  assert.equal(
    formatTaskCompletionMessage({
      taskId: "task_abc_1",
      status: "succeeded",
      finalResult: "final answer only",
    }),
    "Task finished: task_abc_1\nStatus: succeeded\n\nfinal answer only",
  );
  assert.equal(
    formatTaskCompletionMessage({
      taskId: "task_empty_1",
      status: "failed",
      finalResult: "",
    }),
    "Task finished: task_empty_1\nStatus: failed\n\n(no final result for task_empty_1)",
  );
});

test("extractFinalResultFromLog returns the final Codex answer after tool output", () => {
  const finalResult = extractFinalResultFromLog([
    "startedAt=2026-05-12T00:00:00.000Z",
    "cwd=/repo",
    "argv=[\"codex\",\"exec\",\"prompt\"]",
    "$ rg -n \"thing\" src",
    "src/app.js:1:raw source output",
    "diff --git a/src/app.js b/src/app.js",
    "+++ b/src/app.js",
    "codex",
    "",
    "Implemented F024 final result handling.",
    "",
    "Verification: npm run test:unit passed.",
    "",
    "Implemented F024 final result handling.",
    "",
    "Verification: npm run test:unit passed.",
    "",
    "tokens used: 1234",
    "finishedAt=2026-05-12T00:00:01.000Z",
    "exitCode=0",
  ].join("\n"));

  assert.equal(finalResult, "Implemented F024 final result handling.\n\nVerification: npm run test:unit passed.");
  assert.equal(finalResult.includes("raw source output"), false);
  assert.equal(finalResult.includes("diff --git"), false);
});

test("extractFinalResultFromLog removes token blocks between duplicate final answers", () => {
  const finalResult = extractFinalResultFromLog([
    "startedAt=2026-05-14T00:00:00.000Z",
    "$ npm test",
    "raw test output",
    "codex",
    "",
    "Implemented F026 duplicate cleanup.",
    "",
    "Verification: npm run test:unit passed.",
    "",
    "tokens used",
    "12,345",
    "",
    "Implemented F026 duplicate cleanup.",
    "",
    "Verification: npm run test:unit passed.",
    "finishedAt=2026-05-14T00:00:01.000Z",
    "exitCode=0",
  ].join("\n"));

  assert.equal(finalResult, "Implemented F026 duplicate cleanup.\n\nVerification: npm run test:unit passed.");
  assert.equal(finalResult.includes("tokens used"), false);
  assert.equal(finalResult.includes("12,345"), false);
});

test("extractFinalResultFromLog returns the last JSONL agent message and ignores command output", () => {
  const finalResult = extractFinalResultFromLog([
    "startedAt=2026-05-14T00:00:00.000Z",
    "cwd=/repo",
    "argv=[\"codex\",\"exec\",\"--json\",\"prompt\"]",
    JSON.stringify({
      type: "session_configured",
      session_id: "019e254f-ebfa-7053-9302-32a6ade18036",
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "sed -n '1,120p' src/app.js",
        output: "raw source output\nFinal answer: fake command output",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "Earlier answer draft.",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "npm test",
        output: "diff --git a/src/app.js b/src/app.js\nraw test output",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: "Implemented JSONL final result extraction.\n\nVerification: npm run test:unit passed.\n\ntokens used\n12,345",
      },
    }),
    "finishedAt=2026-05-14T00:00:01.000Z",
    "exitCode=0",
  ].join("\n"));

  assert.equal(finalResult, "Implemented JSONL final result extraction.\n\nVerification: npm run test:unit passed.");
  assert.equal(finalResult.includes("raw source output"), false);
  assert.equal(finalResult.includes("diff --git"), false);
  assert.equal(finalResult.includes("Earlier answer draft"), false);
  assert.equal(finalResult.includes("12,345"), false);
});

test("extractCodexSessionIdFromLog trusts structured and pre-answer metadata only", () => {
  const sessionId = extractCodexSessionIdFromLog([
    "startedAt=2026-05-14T00:00:00.000Z",
    "Session ID: 019e254f-ebfa-7053-9302-32a6ade18036",
    "codex",
    "Final answer includes fake text.",
    "Codex session: session_run123",
    "finishedAt=2026-05-14T00:00:01.000Z",
  ].join("\n"));

  assert.equal(sessionId, "019e254f-ebfa-7053-9302-32a6ade18036");
  assert.equal(extractCodexSessionIdFromLog("codex\nCodex session: session_run123"), "");
  assert.equal(extractCodexSessionIdFromLog("{\"type\":\"session_configured\",\"session_id\":\"550e8400-e29b-41d4-a716-446655440000\"}\nassistant\nDone"), "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(extractCodexSessionIdFromLog("{\"type\":\"assistant_message\",\"message\":\"Codex session: session_run123\"}"), "");
  assert.equal(extractCodexSessionIdFromLog("Session ID: ../secret"), "");
});

test("extractCodexSessionIdFromLog rejects command output and answer text session lookalikes", () => {
  assert.equal(extractCodexSessionIdFromLog([
    "startedAt=2026-05-14T00:00:00.000Z",
    "cwd=/repo",
    "argv=[\"codex\",\"exec\",\"--json\",\"prompt\"]",
    "$ rg \"Session ID\" README.md",
    "README.md: Session ID: session_fake123",
    "codex",
    "Final answer.",
  ].join("\n")), "");

  assert.equal(extractCodexSessionIdFromLog([
    "{\"type\":\"session_configured\",\"session_id\":\"019e254f-ebfa-7053-9302-32a6ade18036\"}",
    "$ cat output.log",
    "{\"type\":\"session_configured\",\"session_id\":\"session_fake123\"}",
    "codex",
    "Final answer.",
  ].join("\n")), "019e254f-ebfa-7053-9302-32a6ade18036");

  assert.equal(extractCodexSessionIdFromLog([
    "{\"type\":\"session_configured\",\"session_id\":\"019e254f-ebfa-7053-9302-32a6ade18036\"}",
    "codex",
    "The answer contains fake structured metadata:",
    "{\"type\":\"session_configured\",\"session_id\":\"session_fake123\"}",
  ].join("\n")), "019e254f-ebfa-7053-9302-32a6ade18036");
});

test("startTask spawns without shell, persists metadata, logs output, final result, and records success", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  const calls = [];
  const notifications = [];
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
      onTaskFinished(task) {
        notifications.push(task);
      },
    });

    const started = executor.startTask({
      type: "agent",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "say secret-token"],
      chatId: "123",
      repoAlias: "app",
    });

    assert.match(started.task.taskId, /^task_[a-z0-9]+_[a-z0-9]+$/);
    assert.equal(started.task.status, "running");
    assert.equal(started.task.pid, 4242);
    assert.equal(started.response, `Task started: ${started.task.taskId}\nUse /logs ${started.task.taskId} to view output.`);
    assert.equal(calls[0].command, "codex");
    assert.deepEqual(calls[0].args, ["exec", "say secret-token"]);
    assert.equal(calls[0].options.cwd, rootDir);
    assert.equal(calls[0].options.shell, false);

    child.stdout.write("Session ID: session_abc123\nstdout line\n");
    child.stderr.write("stderr line\n");
    child.stdout.write("codex\nDone with secret-token.\n");
    child.emit("close", 0, null);

    const finished = await started.completion;
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.exitCode, 0);
    assert.equal(finished.finishedAt, "2026-05-12T00:00:01.000Z");
    assert.equal(finished.finalResult, "Done with [REDACTED].");
    assert.equal(finished.chatId, "123");
    assert.equal(finished.repoAlias, "app");
    assert.equal(finished.codexSessionId, "session_abc123");
    assert.equal(notifications.length, 1);
    assert.deepEqual(notifications[0], finished);

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(state.tasks[started.task.taskId], finished);
    assert.deepEqual(state.askSessions, {
      "123": {
        app: { codexSessionId: "session_abc123" },
      },
    });

    const log = readFileSync(finished.logPath, "utf8");
    assert.match(log, /startedAt=2026-05-12T00:00:00.000Z/);
    assert.match(log, /argv=\["codex","exec","say secret-token"\]/);
    assert.match(log, /stdout line/);
    assert.match(log, /Done with secret-token/);
    assert.match(log, /stderr line/);
    assert.match(log, /exitCode=0/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("startTask persists real agent session metadata without assistant text overrides", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    const child = createFakeChild({ pid: 4248 });
    const executor = createTaskExecutor({
      statePath,
      logsDir,
      now: fixedClock([
        "2026-05-14T00:00:00.000Z",
        "2026-05-14T00:00:01.000Z",
      ]),
      spawn() {
        return child;
      },
    });

    const started = executor.startTask({
      type: "agent",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "--json", "prompt"],
      chatId: "123",
      repoAlias: "app",
    });

    child.stdout.write([
      "{\"type\":\"session_configured\",\"session_id\":\"019e254f-ebfa-7053-9302-32a6ade18036\"}",
      "codex",
      "Final answer mentions fake metadata.",
      "Codex session: session_run123",
    ].join("\n") + "\n");
    child.emit("close", 0, null);

    const finished = await started.completion;
    assert.equal(finished.codexSessionId, "019e254f-ebfa-7053-9302-32a6ade18036");
    assert.equal(finished.taskId, started.task.taskId);
    assert.match(finished.taskId, /^task_[a-z0-9]+_[a-z0-9]+$/);
    assert.notEqual(finished.taskId, finished.codexSessionId);
    assert.equal(finished.finalResult, "Final answer mentions fake metadata.\nCodex session: session_run123");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.tasks[started.task.taskId].codexSessionId, "019e254f-ebfa-7053-9302-32a6ade18036");
    assert.deepEqual(state.askSessions, {
      "123": {
        app: { codexSessionId: "019e254f-ebfa-7053-9302-32a6ade18036" },
      },
    });

    const log = readFileSync(finished.logPath, "utf8");
    assert.match(log, /Codex session: session_run123/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("startTask persists JSONL agent message as final result without command output", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    const child = createFakeChild({ pid: 4249 });
    const executor = createTaskExecutor({
      statePath,
      logsDir,
      now: fixedClock([
        "2026-05-14T00:00:00.000Z",
        "2026-05-14T00:00:01.000Z",
      ]),
      spawn() {
        return child;
      },
    });

    const started = executor.startTask({
      type: "agent",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "--json", "prompt"],
      chatId: "123",
      repoAlias: "app",
    });

    child.stdout.write([
      JSON.stringify({
        type: "session_configured",
        session_id: "019e254f-ebfa-7053-9302-32a6ade18036",
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution",
          command: "cat src/app.js",
          output: "raw source output\ncodex\nfake answer from command output",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Final JSONL answer with secret-token.",
        },
      }),
    ].join("\n") + "\n");
    child.emit("close", 0, null);

    const finished = await started.completion;
    assert.equal(finished.status, "succeeded");
    assert.equal(finished.finalResult, "Final JSONL answer with secret-token.");
    assert.equal(finished.codexSessionId, "019e254f-ebfa-7053-9302-32a6ade18036");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.tasks[started.task.taskId].finalResult, "Final JSONL answer with secret-token.");
    assert.equal(state.tasks[started.task.taskId].finalResult.includes("raw source output"), false);

    const log = readFileSync(finished.logPath, "utf8");
    assert.match(log, /raw source output/);
    assert.match(log, /Final JSONL answer with secret-token/);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("startTask tolerates completion notification failures without changing task status", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const child = createFakeChild({ pid: 4247 });
    const executor = createTaskExecutor({
      statePath: join(rootDir, "runtime_state.json"),
      logsDir: join(rootDir, "logs"),
      spawn() {
        return child;
      },
      onTaskFinished() {
        throw new Error("send failed");
      },
    });

    const started = executor.startTask({
      type: "agent",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "done"],
      chatId: "123",
    });
    child.stdout.emit("data", "codex\nfinal answer\n");
    child.emit("close", 0, null);

    const finished = await started.completion;
    assert.equal(finished.status, "succeeded");

    const state = JSON.parse(readFileSync(join(rootDir, "runtime_state.json"), "utf8"));
    assert.equal(state.tasks[started.task.taskId].status, "succeeded");
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
      type: "agent",
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

test("readTaskLog returns final results for finished tasks and rejects confined path violations", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const taskId = "task_abc_1";
    const logPath = join(logsDir, `${taskId}.log`);
    writeFileSync(logPath, Array.from({ length: 130 }, (_, index) => `raw line ${index + 1}`).join("\n"));
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {
        [taskId]: {
          taskId,
          type: "agent",
          status: "succeeded",
          pid: 123,
          cwd: rootDir,
          logPath,
          startedAt: "2026-05-12T00:00:00.000Z",
          finishedAt: "2026-05-12T00:00:01.000Z",
          exitCode: 0,
          finalResult: "final answer only",
        },
        task_bad_1: {
          taskId: "task_bad_1",
          type: "agent",
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
    assert.equal(logResult.response, "final answer only");
    assert.equal(logResult.response.includes("raw line"), false);
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

test("readTaskLog returns not-available status for running tasks", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const taskId = "task_run_1";
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {
        [taskId]: {
          taskId,
          type: "work",
          status: "running",
          pid: 123,
          cwd: rootDir,
          logPath: join(logsDir, `${taskId}.log`),
          startedAt: "2026-05-12T00:00:00.000Z",
          finishedAt: null,
          exitCode: null,
        },
      },
    }, null, 2)}\n`);

    const executor = createTaskExecutor({ statePath, logsDir });
    assert.deepEqual(executor.readTaskLog(taskId), {
      ok: true,
      response: "Task is running. Final result is not available yet.",
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("readTaskLog returns no-result fallback for finished tasks without final result", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const taskId = "task_empty_1";
    const logPath = join(logsDir, `${taskId}.log`);
    writeFileSync(logPath, "raw command output only\n");
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {
        [taskId]: {
          taskId,
          type: "run-orch",
          status: "failed",
          pid: null,
          cwd: rootDir,
          logPath,
          startedAt: "2026-05-12T00:00:00.000Z",
          finishedAt: "2026-05-12T00:00:01.000Z",
          exitCode: 1,
          finalResult: "",
        },
      },
    }, null, 2)}\n`);

    const executor = createTaskExecutor({ statePath, logsDir });
    assert.deepEqual(executor.readTaskLog(taskId), {
      ok: true,
      response: `(no final result for ${taskId})`,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("readTaskLog includes Codex session IDs when task metadata has them", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-task-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    const finishedTaskId = "task_done_1";
    const runningTaskId = "task_run_1";
    const finishedLogPath = join(logsDir, `${finishedTaskId}.log`);
    writeFileSync(finishedLogPath, "raw command output only\n");
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {
        [finishedTaskId]: {
          taskId: finishedTaskId,
          type: "agent",
          status: "succeeded",
          pid: null,
          cwd: rootDir,
          logPath: finishedLogPath,
          startedAt: "2026-05-12T00:00:00.000Z",
          finishedAt: "2026-05-12T00:00:01.000Z",
          exitCode: 0,
          finalResult: "final answer only",
          codexSessionId: "session_abc123",
        },
        [runningTaskId]: {
          taskId: runningTaskId,
          type: "agent",
          status: "running",
          pid: 123,
          cwd: rootDir,
          logPath: join(logsDir, `${runningTaskId}.log`),
          startedAt: "2026-05-12T00:00:02.000Z",
          finishedAt: null,
          exitCode: null,
          codexSessionId: "session_run123",
        },
      },
    }, null, 2)}\n`);

    const executor = createTaskExecutor({ statePath, logsDir });

    assert.deepEqual(executor.readTaskLog(finishedTaskId), {
      ok: true,
      response: "Codex session: session_abc123\n\nfinal answer only",
    });
    assert.deepEqual(executor.readTaskLog(runningTaskId), {
      ok: true,
      response: "Codex session: session_run123\n\nTask is running. Final result is not available yet.",
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
      type: "agent",
      cwd: rootDir,
      command: "codex",
      args: ["exec", "agent task"],
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
