import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import { HELP_RESPONSE } from "../../src/constants.js";
import { createTaskExecutor } from "../../src/task-executor.js";

test("app rejects unauthorized messages before parsing commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
    });
    assert.equal(app.handleMessage({ chatId: "999", text: "/repos" }), "Unauthorized chat.");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app handles /repos, /use, and /pwd with persisted runtime state", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/repos" }), `Available repos:\n- app -> ${repoDir}`);
    assert.equal(app.handleMessage({ chatId: "123", text: "/pwd" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(app.handleMessage({ chatId: "123", text: "/pwd" }), repoDir);

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.currentRepo, "app");
    assert.equal(state.cwd, repoDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app handles /ls and /git in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    writeFileSync(join(repoDir, "README.md"), "# Test repo\n");
    execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    execFileSync("git", ["add", "README.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["branch", "-M", "main"], { cwd: repoDir });

    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath: join(rootDir, "runtime_state.json"),
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/ls" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/git" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.match(app.handleMessage({ chatId: "123", text: "/ls" }), /README\.md/);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/git" }),
      "Branch:\nmain\nStatus:\nclean\nRecent commits:\n" +
        execFileSync("git", ["log", "--oneline", "-1"], { cwd: repoDir, encoding: "utf8" }).trim(),
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app rejects unknown commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
    });
    assert.equal(app.handleMessage({ chatId: "123", text: "/eval-feature F001" }), "Unknown command.\nUse /help.");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app returns exact help output", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
    });
    assert.equal(app.handleMessage({ chatId: "123", text: "/help" }), HELP_RESPONSE);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app handles approval commands and reply-based decisions", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {},
      askSessions: {},
      approvalRequests: {
        req_approve: {
          requestId: "req_approve",
          status: "pending",
          chatId: "123",
          telegramMessageId: 701,
        },
        req_reject: {
          requestId: "req_reject",
          status: "pending",
          chatId: "123",
          telegramMessageId: 702,
        },
        req_always: {
          requestId: "req_always",
          status: "pending",
          chatId: "123",
          telegramMessageId: 703,
          allowRule: {
            cwd: "/repo",
            command: "codex",
          },
        },
      },
      approvalAllowRules: {},
      telegramUpdateOffset: null,
    }, null, 2)}\n`);
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath,
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/approve req_approve" }), "Approved request: req_approve");
    assert.equal(app.handleMessage({ chatId: "123", text: "no", replyToMessageId: 702 }), "Rejected request: req_reject");
    assert.equal(app.handleMessage({ chatId: "123", text: "以后都允许", replyToMessageId: 703 }), "Approved and stored future allow rule: req_always");
    assert.equal(app.handleMessage({ chatId: "123", text: "yes" }), "No workspace selected.\nUse /repos then /use <repo>.");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.approvalRequests.req_approve.status, "approved");
    assert.equal(state.approvalRequests.req_reject.status, "rejected");
    assert.equal(state.approvalRequests.req_always.status, "always_allowed");
    assert.equal(state.approvalAllowRules.req_always.command, "codex");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app rejects unsafe, unknown, expired, resolved, and unauthorized approval requests", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {},
      askSessions: {},
      approvalRequests: {
        req_old: {
          requestId: "req_old",
          status: "pending",
          chatId: "123",
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
        req_done: {
          requestId: "req_done",
          status: "approved",
          chatId: "123",
        },
        req_other: {
          requestId: "req_other",
          status: "pending",
          chatId: "456",
        },
      },
      approvalAllowRules: {},
      telegramUpdateOffset: null,
    }, null, 2)}\n`);
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath,
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/approve ../secret" }), "Invalid approval request ID: ../secret");
    assert.equal(app.handleMessage({ chatId: "123", text: "/approve req_missing" }), "Unknown approval request: req_missing");
    assert.equal(app.handleMessage({ chatId: "123", text: "/approve req_old" }), "Approval request expired: req_old");
    assert.equal(app.handleMessage({ chatId: "123", text: "/approve req_done" }), "Approval request already resolved: req_done");
    assert.equal(app.handleMessage({ chatId: "123", text: "/approve req_other" }), "Unauthorized approval request: req_other");
    assert.equal(app.handleMessage({ chatId: "999", text: "/approve req_other" }), "Unauthorized chat.");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app resolves inline approval callbacks through the running task executor", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const deliveries = [];
  try {
    const statePath = join(rootDir, "runtime_state.json");
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {
        task_run_1: {
          taskId: "task_run_1",
          type: "agent",
          status: "running",
          pid: 123,
          cwd: "/repo",
          logPath: join(rootDir, "logs", "task_run_1.log"),
          startedAt: "2026-05-14T00:00:00.000Z",
          finishedAt: null,
          exitCode: null,
        },
      },
      askSessions: {},
      approvalRequests: {
        req_123: {
          requestId: "req_123",
          status: "pending",
          taskId: "task_run_1",
          chatId: "123",
          codexRequestId: "codex_perm_1",
          options: [
            { optionId: "opt_1", codexOptionId: "approve_once", label: "Approve once", decision: "approved" },
            { optionId: "opt_2", codexOptionId: "reject_once", label: "Reject", decision: "rejected" },
            { optionId: "opt_3", codexOptionId: "always_allow", label: "Always allow", decision: "always_allow" },
          ],
        },
        req_cmd: {
          requestId: "req_cmd",
          status: "pending",
          taskId: "task_run_1",
          chatId: "123",
          codexRequestId: "codex_perm_2",
          options: [
            { optionId: "opt_1", codexOptionId: "approve_once", label: "Approve once", decision: "approved" },
            { optionId: "opt_2", codexOptionId: "reject_once", label: "Reject", decision: "rejected" },
          ],
        },
      },
      approvalAllowRules: {},
      telegramUpdateOffset: null,
    }, null, 2)}\n`);
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath,
      taskExecutor: {
        resolveApprovalOption(request) {
          deliveries.push(request);
          return { ok: true, state: request.state };
        },
      },
    });

    assert.equal(
      app.handleCallbackQuery({ chatId: "123", data: "approval:req_123:opt_3" }),
      "Approved and stored future allow rule: req_123",
    );
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].selectedOption.codexOptionId, "always_allow");
    assert.equal(app.handleMessage({ chatId: "123", text: "/reject req_cmd" }), "Rejected request: req_cmd");
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[1].selectedOption.codexOptionId, "reject_once");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.approvalRequests.req_123.status, "always_allowed");
    assert.equal(state.approvalRequests.req_123.selectedOptionId, "opt_3");
    assert.equal(state.approvalRequests.req_cmd.status, "rejected");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app rejects removed public workflow commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
      taskExecutor: {
        startTask() {
          throw new Error("should not start");
        },
      },
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/ask Explain" }), "Unknown command.\nUse /help.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/work Add docs" }), "Unknown command.\nUse /help.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/run_orch 1" }), "Unknown command.\nUse /help.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/continue Resume" }), "Unknown command.\nUse /help.");
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/run-orch 1" }),
      "Unknown command.\nUse /help.",
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app starts /agent tasks in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  const calls = [];
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath: join(rootDir, "runtime_state.json"),
      taskExecutor: {
        startTask(request) {
          calls.push(request);
          return { response: "Task started: task_abc_1\nUse /logs task_abc_1 to view output." };
        },
      },
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/agent Explain" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent Explain the repo" }),
      "Task started: task_abc_1\nUse /logs task_abc_1 to view output.",
    );
    assert.equal(calls[0].type, "agent");
    assert.equal(calls[0].cwd, repoDir);
    assert.equal(calls[0].command, "codex");
    assert.equal(calls[0].args[0], "exec");
    assert.equal(calls[0].args[1], "--json");
    assert.match(calls[0].args[2], /follow AGENTS\.md/);
    assert.match(calls[0].args[2], /Instruction:\nExplain the repo/);
    assert.equal(calls[0].timeoutMs, null);
    assert.equal(calls[0].chatId, "123");
    assert.equal(calls[0].repoAlias, "app");
    const state = JSON.parse(readFileSync(join(rootDir, "runtime_state.json"), "utf8"));
    assert.deepEqual(state.agentChatModes, {
      "123": {
        app: "enabled",
      },
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app resumes /agent tasks when a chat and repo session binding exists", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  const calls = [];
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      taskExecutor: {
        startTask(request) {
          calls.push(request);
          return { response: "Task started: task_resume_1\nUse /logs task_resume_1 to view output." };
        },
      },
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.askSessions = {
      "123": {
        app: { codexSessionId: "session_abc123" },
      },
    };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent Continue the repo analysis" }),
      "Task started: task_resume_1\nUse /logs task_resume_1 to view output.\nResumed agent session: session_abc123",
    );
    assert.equal(calls[0].type, "agent");
    assert.equal(calls[0].cwd, repoDir);
    assert.equal(calls[0].command, "codex");
    assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "session_abc123", "Continue the repo analysis"]);
    assert.equal(calls[0].timeoutMs, null);
    assert.equal(calls[0].chatId, "123");
    assert.equal(calls[0].repoAlias, "app");
    assert.equal(calls[0].codexSessionId, "session_abc123");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app handles ordinary text in agent chat mode as a session follow-up", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  const calls = [];
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      taskExecutor: {
        startTask(request) {
          calls.push(request);
          return { response: "Task started: task_chat_1\nUse /logs task_chat_1 to view output." };
        },
      },
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "hello" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "hello" }),
      "Agent chat mode is off for the current chat and repository.\nUse /agent <instruction> to begin.",
    );

    let state = JSON.parse(readFileSync(statePath, "utf8"));
    state.agentChatModes = {
      "123": {
        app: "enabled",
      },
    };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "hello" }),
      "No agent session is bound for agent chat mode.\nUse /agent new <instruction> or /agent resume <session_id> <instruction>.",
    );

    state = JSON.parse(readFileSync(statePath, "utf8"));
    state.askSessions = {
      "123": {
        app: { codexSessionId: "session_abc123" },
      },
    };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    assert.equal(
      app.handleMessage({ chatId: "123", text: "Continue without prefix" }),
      "Task started: task_chat_1\nUse /logs task_chat_1 to view output.\nResumed agent session: session_abc123",
    );
    assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "session_abc123", "Continue without prefix"]);
    assert.equal(calls[0].stdinMode, undefined);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app rejects ordinary chat-mode follow-up while an agent task is active in the same repository", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: "app",
      cwd: repoDir,
      tasks: {
        task_run_1: {
          taskId: "task_run_1",
          type: "agent",
          status: "running",
          repoAlias: "app",
          cwd: repoDir,
        },
      },
      askSessions: {
        "123": {
          app: { codexSessionId: "session_abc123" },
        },
      },
      agentChatModes: {
        "123": {
          app: "enabled",
        },
      },
      approvalRequests: {},
      approvalAllowRules: {},
      telegramUpdateOffset: null,
    }, null, 2)}\n`);
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      taskExecutor: {
        startTask() {
          throw new Error("should not start");
        },
      },
    });

    assert.equal(
      app.handleMessage({ chatId: "123", text: "Follow up" }),
      "An agent task is already running for this repository: task_run_1.\nUse /status or /stop task_run_1 before sending another follow-up.",
    );
    assert.equal(app.handleMessage({ chatId: "123", text: "/status" }).includes("task_run_1"), true);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app applies configured timeout to /agent tasks", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  const calls = [];
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath: join(rootDir, "runtime_state.json"),
      agentTaskTimeoutMs: 3600000,
      taskExecutor: {
        startTask(request) {
          calls.push(request);
          return { response: "Task started: task_timeout_1\nUse /logs task_timeout_1 to view output." };
        },
      },
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent Explain timeout config" }),
      "Task started: task_timeout_1\nUse /logs task_timeout_1 to view output.",
    );
    assert.equal(calls[0].timeoutMs, 3600000);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app agent task binds real structured session metadata despite fake answer text", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    const child = createFakeChild({ pid: 5252 });
    let resolveFinished;
    const finishedNotification = new Promise((resolve) => {
      resolveFinished = resolve;
    });
    const executor = createTaskExecutor({
      statePath,
      logsDir,
      spawn(command, args, options) {
        child.spawnCommand = command;
        child.spawnArgs = args;
        child.spawnOptions = options;
        return child;
      },
      onTaskFinished(task) {
        resolveFinished(task);
      },
    });
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      logsDir,
      taskExecutor: executor,
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    const response = app.handleMessage({ chatId: "123", text: "/agent Explain sessions" });
    assert.match(response, /^Task started: task_[a-z0-9]+_[a-z0-9]+\nUse \/logs task_[a-z0-9]+_[a-z0-9]+ to view output\.$/);
    assert.equal(child.spawnCommand, "codex");
    assert.deepEqual(child.spawnArgs.slice(0, 2), ["exec", "--json"]);
    assert.match(child.spawnArgs[2], /Instruction:\nExplain sessions/);
    assert.deepEqual(child.spawnOptions.stdio, ["ignore", "pipe", "pipe"]);

    const taskId = response.match(/^Task started: (task_[a-z0-9]+_[a-z0-9]+)/)[1];
    child.stdout.write([
      "{\"type\":\"session_configured\",\"session_id\":\"019e254f-ebfa-7053-9302-32a6ade18036\"}",
      "codex",
      "Answer text with a fake session.",
      "Codex session: session_run123",
    ].join("\n") + "\n");
    child.emit("close", 0, null);

    await finishedNotification;
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.tasks[taskId].codexSessionId, "019e254f-ebfa-7053-9302-32a6ade18036");
    assert.equal(state.tasks[taskId].taskId, taskId);
    assert.equal(state.tasks[taskId].finalResult, "Answer text with a fake session.\nCodex session: session_run123");
    assert.deepEqual(state.askSessions, {
      "123": {
        app: { codexSessionId: "019e254f-ebfa-7053-9302-32a6ade18036" },
      },
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app /agent new binds thread.started metadata and plain /agent resumes the new thread", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    const children = [
      createFakeChild({ pid: 5253 }),
      createFakeChild({ pid: 5254 }),
    ];
    const spawned = [];
    let finishCount = 0;
    let resolveFirstFinished;
    let resolveSecondFinished;
    const firstFinished = new Promise((resolve) => {
      resolveFirstFinished = resolve;
    });
    const secondFinished = new Promise((resolve) => {
      resolveSecondFinished = resolve;
    });
    const executor = createTaskExecutor({
      statePath,
      logsDir,
      spawn(command, args, options) {
        spawned.push({ command, args, options });
        return children[spawned.length - 1];
      },
      onTaskFinished(task) {
        finishCount += 1;
        if (finishCount === 1) {
          resolveFirstFinished(task);
        } else if (finishCount === 2) {
          resolveSecondFinished(task);
        }
      },
    });
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      logsDir,
      taskExecutor: executor,
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.askSessions = {
      "123": {
        app: { codexSessionId: "session_old123" },
      },
    };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const newResponse = app.handleMessage({ chatId: "123", text: "/agent new Start fresh" });
    assert.match(newResponse, /^Task started: task_[a-z0-9]+_[a-z0-9]+\nUse \/logs task_[a-z0-9]+_[a-z0-9]+ to view output\.$/);
    assert.equal(spawned[0].command, "codex");
    assert.deepEqual(spawned[0].args.slice(0, 2), ["exec", "--json"]);
    assert.match(spawned[0].args[2], /Instruction:\nStart fresh/);
    assert.doesNotMatch(spawned[0].args.join(" "), /\bsession_old123\b/);
    assert.deepEqual(spawned[0].options.stdio, ["ignore", "pipe", "pipe"]);

    children[0].stdout.write([
      JSON.stringify({
        type: "thread.started",
        threadId: "019e254f-ebfa-7053-9302-32a6ade18036",
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "Fresh thread created.",
        },
      }),
    ].join("\n") + "\n");
    children[0].emit("close", 0, null);
    await firstFinished;

    const reboundState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(reboundState.askSessions, {
      "123": {
        app: { codexSessionId: "019e254f-ebfa-7053-9302-32a6ade18036" },
      },
    });

    assert.match(
      app.handleMessage({ chatId: "123", text: "/agent Continue on the fresh thread" }),
      /^Task started: task_[a-z0-9]+_[a-z0-9]+\nUse \/logs task_[a-z0-9]+_[a-z0-9]+ to view output\.\nResumed agent session: 019e254f-ebfa-7053-9302-32a6ade18036$/,
    );
    assert.deepEqual(spawned[1].args, [
      "exec",
      "--json",
      "resume",
      "019e254f-ebfa-7053-9302-32a6ade18036",
      "Continue on the fresh thread",
    ]);
    assert.deepEqual(spawned[1].options.stdio, ["ignore", "pipe", "pipe"]);
    children[1].emit("close", 0, null);
    await secondFinished;
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app handles /agent session, exit, new, resume, resume --last, and literal escape", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  const calls = [];
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
      taskExecutor: {
        startTask(request) {
          calls.push(request);
          return { response: `Task started: task_${calls.length}_1\nUse /logs task_${calls.length}_1 to view output.` };
        },
      },
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent session" }),
      "Current agent session:\nrepo: app\nsession: none\nchat mode: off",
    );
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent resume session_abc123 Continue here" }),
      "Task started: task_1_1\nUse /logs task_1_1 to view output.\nResumed agent session: session_abc123",
    );
    assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "session_abc123", "Continue here"]);
    assert.equal(calls[0].codexSessionId, "session_abc123");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.askSessions = {
      "123": {
        app: { codexSessionId: "session_abc123" },
        other: { codexSessionId: "session_other123" },
      },
    };
    state.agentChatModes = {
      "123": {
        app: "enabled",
        other: "enabled",
      },
    };
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent session" }),
      "Current agent session:\nrepo: app\nsession: session_abc123\nchat mode: on",
    );
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent new Start fresh" }),
      "Task started: task_2_1\nUse /logs task_2_1 to view output.",
    );
    assert.equal(calls[1].args[0], "exec");
    assert.equal(calls[1].args[1], "--json");
    assert.match(calls[1].args[2], /Instruction:\nStart fresh/);
    assert.equal(calls[1].codexSessionId, null);

    assert.match(
      app.handleMessage({ chatId: "123", text: "/agent resume --last Continue most recent" }),
      /^Task started: task_3_1\nUse \/logs task_3_1 to view output\.\nUsing Codex CLI --last for the runtime user account/,
    );
    assert.deepEqual(calls[2].args, ["exec", "--json", "resume", "--last", "Continue most recent"]);

    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent -- new architecture means what?" }),
      "Task started: task_4_1\nUse /logs task_4_1 to view output.\nResumed agent session: session_abc123",
    );
    assert.deepEqual(calls[3].args, ["exec", "--json", "resume", "session_abc123", "new architecture means what?"]);

    assert.equal(
      app.handleMessage({ chatId: "123", text: "/agent exit" }),
      "Agent chat mode disabled for the current chat and repository.",
    );
    const exitedState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(exitedState.askSessions, {
      "123": {
        app: { codexSessionId: "session_abc123" },
        other: { codexSessionId: "session_other123" },
      },
    });
    assert.deepEqual(exitedState.agentChatModes, {
      "123": {
        other: "enabled",
      },
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app handles /status, /logs, and /stop task management commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const logsDir = join(rootDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(statePath, `${JSON.stringify({
      currentRepo: null,
      cwd: null,
      tasks: {
        task_done_1: {
          taskId: "task_done_1",
          type: "ask",
          status: "succeeded",
          pid: null,
          cwd: "/repo",
          logPath: join(logsDir, "task_done_1.log"),
          startedAt: "2026-05-12T00:00:00.000Z",
          finishedAt: "2026-05-12T00:00:01.000Z",
          exitCode: 0,
        },
        task_run_1: {
          taskId: "task_run_1",
          type: "work",
          status: "running",
          pid: 12345,
          cwd: "/repo",
          logPath: join(logsDir, "task_run_1.log"),
          startedAt: "2026-05-12T00:00:02.000Z",
          finishedAt: null,
          exitCode: null,
        },
      },
    }, null, 2)}\n`);
    writeFileSync(join(logsDir, "task_done_1.log"), Array.from({ length: 121 }, (_, index) => `done line ${index + 1}`).join("\n"));

    const stoppedTasks = [];
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath,
      logsDir,
      taskExecutor: {
        readTaskLog(taskId, lineCount) {
          assert.equal(taskId, "task_done_1");
          assert.equal(lineCount, 120);
          return { ok: true, response: "done line 2\ndone line 121" };
        },
        stopTask(taskId) {
          stoppedTasks.push(taskId);
          return { ok: true, response: `Stopping task ${taskId}.` };
        },
      },
    });

    assert.match(app.handleMessage({ chatId: "123", text: "/status" }), /task_run_1\n[\s\S]*status: running[\s\S]*task_done_1/);
    assert.equal(app.handleMessage({ chatId: "123", text: "/logs task_done_1" }), "done line 2\ndone line 121");
    assert.equal(app.handleMessage({ chatId: "123", text: "/logs ../secret" }), "Unknown task: ../secret");
    assert.equal(app.handleMessage({ chatId: "123", text: "/stop task_run_1" }), "Stopping task task_run_1.");
    assert.deepEqual(stoppedTasks, ["task_run_1"]);
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
