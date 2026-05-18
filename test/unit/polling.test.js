import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import { getTelegramUpdates, pollOnce, start } from "../../src/polling.js";
import { createTaskExecutor } from "../../src/task-executor.js";
import { saveRuntimeState } from "../../src/runtime-state.js";
import { createTelegramTaskCompletionNotifier } from "../../src/telegram-transport.js";

test("getTelegramUpdates calls Telegram getUpdates with persisted offset", async () => {
  const calls = [];
  const updates = await getTelegramUpdates({
    botToken: "token",
    offset: 42,
    timeoutSeconds: 7,
    fetchImpl(url, options) {
      calls.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: [{ update_id: 42 }] }),
      });
    },
  });

  assert.deepEqual(updates, [{ update_id: 42 }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.toString(), "https://api.telegram.org/bottoken/getUpdates?timeout=7&offset=42");
  assert.deepEqual(calls[0].options, { method: "GET" });
});

test("pollOnce dispatches valid messages, sends replies, and persists next offset", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const statePath = join(rootDir, "runtime_state.json");
  try {
    saveRuntimeState(statePath, {
      currentRepo: null,
      cwd: null,
      tasks: {},
      telegramUpdateOffset: 5,
    });

    const handled = [];
    const calls = [];
    const count = await pollOnce({
      statePath,
      telegramBotToken: "test-token",
      app: {
        handleMessage(message) {
          handled.push(message);
          return `reply to ${message.text}`;
        },
      },
      fetchImpl(url, options) {
        calls.push({ url: url.toString(), options });
        if (url.toString().includes("/getUpdates")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                { update_id: 5, edited_message: { text: "/ignored" } },
                { update_id: 6, message: { chat: { id: 123 }, text: "/help" } },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      },
      pollTimeoutSeconds: 1,
    });

    assert.equal(count, 2);
    assert.deepEqual(handled, [{ chatId: "123", text: "/help" }]);
    assert.equal(calls[0].url, "https://api.telegram.org/bottest-token/getUpdates?timeout=1&offset=5");
    assert.equal(calls[1].url, "https://api.telegram.org/bottest-token/sendMessage");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      chat_id: "123",
      text: "reply to /help",
    });
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).telegramUpdateOffset, 7);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("pollOnce sends camera clips as Telegram video and deletes temp files", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const statePath = join(rootDir, "runtime_state.json");
  const calls = [];
  const captureOutputs = [];
  try {
    saveRuntimeState(statePath, {
      currentRepo: null,
      cwd: null,
      tasks: {},
      telegramUpdateOffset: 50,
    });

    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath,
      cameraClipConfig: {
        enabled: true,
        argvTemplate: ["fake-camera", "--seconds", "{seconds}", "--output", "{output}"],
        error: null,
      },
      cameraClipOptions: {
        timeoutMs: 1000,
        spawnImpl(command, args) {
          const child = new EventEmitter();
          setImmediate(() => {
            captureOutputs.push(args[3]);
            writeFileSync(args[3], "fake-video");
            child.emit("close", 0);
          });
          child.kill = () => true;
          return child;
        },
      },
    });

    await pollOnce({
      statePath,
      telegramBotToken: "test-token",
      app,
      fetchImpl(url, options) {
        calls.push({ url: url.toString(), options });
        if (url.toString().includes("/getUpdates")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                { update_id: 50, message: { chat: { id: 123 }, text: "/camera_clip 2" } },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      },
      pollTimeoutSeconds: 1,
    });

    assert.equal(calls[1].url, "https://api.telegram.org/bottest-token/sendVideo");
    assert.equal(calls[1].options.method, "POST");
    assert.equal(existsSync(captureOutputs[0]), false);
    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).telegramUpdateOffset, 51);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("pollOnce reports camera video send failures with a bounded text response and deletes temp files", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const statePath = join(rootDir, "runtime_state.json");
  const calls = [];
  const captureOutputs = [];
  try {
    saveRuntimeState(statePath, {
      currentRepo: null,
      cwd: null,
      tasks: {},
      telegramUpdateOffset: 60,
    });

    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath,
      cameraClipConfig: {
        enabled: true,
        argvTemplate: ["fake-camera", "{seconds}", "{output}"],
        error: null,
      },
      cameraClipOptions: {
        timeoutMs: 1000,
        spawnImpl(command, args) {
          const child = new EventEmitter();
          setImmediate(() => {
            captureOutputs.push(args[1]);
            writeFileSync(args[1], "fake-video");
            child.emit("close", 0);
          });
          child.kill = () => true;
          return child;
        },
      },
    });

    await pollOnce({
      statePath,
      telegramBotToken: "test-token",
      app,
      fetchImpl(url, options) {
        calls.push({ url: url.toString(), options });
        if (url.toString().includes("/getUpdates")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                { update_id: 60, message: { chat: { id: 123 }, text: "/camera_clip 1" } },
              ],
            }),
          });
        }
        if (url.toString().includes("/sendVideo")) {
          return Promise.resolve({ ok: false, json: () => Promise.resolve({ ok: false }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      },
      pollTimeoutSeconds: 1,
    });

    assert.equal(calls[1].url, "https://api.telegram.org/bottest-token/sendVideo");
    assert.equal(calls[2].url, "https://api.telegram.org/bottest-token/sendMessage");
    assert.deepEqual(JSON.parse(calls[2].options.body), {
      chat_id: "123",
      text: "Camera clip send failed.",
    });
    assert.equal(existsSync(captureOutputs[0]), false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("pollOnce preserves workspace state saved while handling an update", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const repoDir = join(rootDir, "repo");
  const statePath = join(rootDir, "runtime_state.json");
  try {
    mkdirSync(repoDir);
    saveRuntimeState(statePath, {
      currentRepo: null,
      cwd: null,
      tasks: {},
      telegramUpdateOffset: 11,
    });

    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
    });

    await pollOnce({
      statePath,
      telegramBotToken: "test-token",
      app,
      fetchImpl(url) {
        if (url.toString().includes("/getUpdates")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                { update_id: 11, message: { chat: { id: 123 }, text: "/use app" } },
                { update_id: 12, edited_message: { text: "/ignored" } },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      },
      pollTimeoutSeconds: 1,
    });

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.currentRepo, "app");
    assert.equal(state.cwd, repoDir);
    assert.equal(state.telegramUpdateOffset, 13);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("pollOnce preserves task metadata saved while handling an update", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const repoDir = join(rootDir, "repo");
  const statePath = join(rootDir, "runtime_state.json");
  try {
    mkdirSync(repoDir);
    saveRuntimeState(statePath, {
      currentRepo: "app",
      cwd: repoDir,
      tasks: {},
      telegramUpdateOffset: 21,
    });

    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      taskExecutor: {
        startTask(request) {
          const state = JSON.parse(readFileSync(statePath, "utf8"));
          saveRuntimeState(statePath, {
            ...state,
            tasks: {
              ...state.tasks,
              task_fake_1: {
                taskId: "task_fake_1",
                type: request.type,
                status: "running",
                cwd: request.cwd,
              },
            },
          });
          return { response: "Task started: task_fake_1\nUse /logs task_fake_1 to view output." };
        },
      },
    });

    await pollOnce({
      statePath,
      telegramBotToken: "test-token",
      app,
      fetchImpl(url) {
        if (url.toString().includes("/getUpdates")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ok: true,
              result: [
                { update_id: 21, message: { chat: { id: 123 }, text: "/agent inspect this" } },
              ],
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      },
      pollTimeoutSeconds: 1,
    });

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.telegramUpdateOffset, 22);
    assert.equal(state.tasks.task_fake_1.type, "agent");
    assert.equal(state.tasks.task_fake_1.cwd, repoDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("pollOnce sends completion push with stored final result and preserves /logs retrieval", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const repoDir = join(rootDir, "repo");
  const logsDir = join(rootDir, "logs");
  const statePath = join(rootDir, "runtime_state.json");
  const calls = [];
  let child;
  try {
    mkdirSync(repoDir);
    saveRuntimeState(statePath, {
      currentRepo: "app",
      cwd: repoDir,
      tasks: {},
      telegramUpdateOffset: 31,
    });

    const fetchImpl = (url, options) => {
      calls.push({ url: url.toString(), options });
      if (url.toString().includes("/getUpdates")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [
              { update_id: 31, message: { chat: { id: 123 }, text: "/agent inspect this" } },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    };
    const executor = createTaskExecutor({
      statePath,
      logsDir,
      spawn() {
        child = createFakeChild({ pid: 5555 });
        return child;
      },
      onTaskFinished: createTelegramTaskCompletionNotifier({
        botToken: "test-token",
        fetchImpl,
      }),
    });
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      logsDir,
      taskExecutor: executor,
    });

    await pollOnce({
      statePath,
      telegramBotToken: "test-token",
      app,
      fetchImpl,
      pollTimeoutSeconds: 1,
    });

    const startedState = JSON.parse(readFileSync(statePath, "utf8"));
    const taskId = Object.keys(startedState.tasks)[0];
    assert.equal(startedState.tasks[taskId].chatId, "123");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      chat_id: "123",
      text: `Task started: ${taskId}\nUse /logs ${taskId} to view output.`,
    });

    child.stdout.write("raw tool output\ncodex\nFinal answer only.\n");
    child.emit("close", 0, null);
    await waitFor(() => calls.length === 3);

    assert.deepEqual(JSON.parse(calls[2].options.body), {
      chat_id: "123",
      text: `Task finished: ${taskId}\nStatus: succeeded\n\nFinal answer only.`,
    });
    assert.equal(executor.readTaskLog(taskId).response, "Final answer only.");
    assert.equal(JSON.parse(calls[2].options.body).text.includes("raw tool output"), false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("polling completion push uses no-result fallback without exposing raw logs", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const repoDir = join(rootDir, "repo");
  const logsDir = join(rootDir, "logs");
  const statePath = join(rootDir, "runtime_state.json");
  const calls = [];
  let child;
  try {
    mkdirSync(repoDir);
    saveRuntimeState(statePath, {
      currentRepo: "app",
      cwd: repoDir,
      tasks: {},
      telegramUpdateOffset: 41,
    });

    const fetchImpl = (url, options) => {
      calls.push({ url: url.toString(), options });
      if (url.toString().includes("/getUpdates")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            result: [
              { update_id: 41, message: { chat: { id: 123 }, text: "/agent inspect this" } },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    };
    const executor = createTaskExecutor({
      statePath,
      logsDir,
      spawn() {
        child = createFakeChild({ pid: 5556 });
        return child;
      },
      onTaskFinished: createTelegramTaskCompletionNotifier({
        botToken: "test-token",
        fetchImpl,
      }),
    });
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      logsDir,
      taskExecutor: executor,
    });

    await pollOnce({
      statePath,
      telegramBotToken: "test-token",
      app,
      fetchImpl,
      pollTimeoutSeconds: 1,
    });

    const taskId = Object.keys(JSON.parse(readFileSync(statePath, "utf8")).tasks)[0];
    child.stdout.write("raw process output only\n");
    child.emit("close", 1, null);
    await waitFor(() => calls.length === 3);

    const completion = JSON.parse(calls[2].options.body);
    assert.deepEqual(completion, {
      chat_id: "123",
      text: `Task finished: ${taskId}\nStatus: failed\n\n(no final result for ${taskId})`,
    });
    assert.equal(completion.text.includes("raw process output only"), false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("pollOnce leaves state unchanged when getUpdates fails", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-"));
  const statePath = join(rootDir, "runtime_state.json");
  try {
    saveRuntimeState(statePath, {
      currentRepo: null,
      cwd: null,
      tasks: {},
      telegramUpdateOffset: 9,
    });

    await assert.rejects(
      () => pollOnce({
        statePath,
        telegramBotToken: "test-token",
        app: { handleMessage: () => "unused" },
        fetchImpl: () => Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ ok: false, result: [] }),
        }),
      }),
      /Telegram getUpdates failed/,
    );

    assert.equal(JSON.parse(readFileSync(statePath, "utf8")).telegramUpdateOffset, 9);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("start creates polling context without TELEGRAM_WEBHOOK_URL", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-poll-start-"));
  const repoDir = join(rootDir, "repo");
  try {
    mkdirSync(repoDir);
    const result = start(
      {
        TELEGRAM_BOT_TOKEN: "token",
        ALLOWED_CHAT_IDS: "123",
        NODE_ENV: "test",
        REPO_WHITELIST_JSON: JSON.stringify({ app: "repo" }),
      },
      {
        rootDir,
        app: { handleMessage: () => "ok" },
        fetchImpl: () => Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [] }),
        }),
        pollIntervalMs: 1000000,
      },
    );

    result.controller.stop();
    assert.equal(result.status, "polling");
    assert.equal(result.repoCount, 1);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

function createFakeChild({ pid }) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true);
}
