import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_TIMEOUT_MS, buildAgentPrompt, handleAgent, parseAgentRequest } from "../../src/ask.js";

test("buildAgentPrompt includes the required general agent rules and instruction", () => {
  const prompt = buildAgentPrompt("Implement the workflow.");

  assert.match(prompt, /Use repository files and git history as the source of truth\./);
  assert.match(prompt, /For implementation requests, read and follow AGENTS\.md before changing files\./);
  assert.match(prompt, /Summarize actions taken, changed files, verification commands, and remaining issues\./);
  assert.match(prompt, /Instruction:\nImplement the workflow\./);
});

test("handleAgent requires a selected workspace", () => {
  const result = handleAgent("Explain", { currentRepo: null, cwd: null, tasks: {} }, {
    startTask() {
      throw new Error("should not start");
    },
  });

  assert.deepEqual(result, {
    response: "No workspace selected.\nUse /repos then /use <repo>.",
    stateChanged: false,
  });
});

test("handleAgent starts a codex exec task in the selected workspace", () => {
  const calls = [];
  const result = handleAgent("Implement the workflow.", { currentRepo: "app", cwd: "/tmp/app", tasks: {} }, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_abc_1\nUse /logs task_abc_1 to view output." };
    },
  });

  assert.equal(result.response, "Task started: task_abc_1\nUse /logs task_abc_1 to view output.");
  assert.equal(result.stateChanged, false);
  assert.deepEqual(result.enableAgentChatMode, {
    chatId: null,
    repoAlias: "app",
  });
  assert.equal(calls[0].type, "agent");
  assert.equal(calls[0].cwd, "/tmp/app");
  assert.equal(calls[0].command, "codex");
  assert.equal(calls[0].args[0], "exec");
  assert.equal(calls[0].args[1], "--json");
  assert.match(calls[0].args[2], /follow AGENTS\.md/);
  assert.match(calls[0].args[2], /Instruction:\nImplement the workflow\./);
  assert.equal(calls[0].timeoutMs, AGENT_TIMEOUT_MS);
  assert.equal(calls[0].repoAlias, "app");
});

test("parseAgentRequest handles subcommands and literal reserved words", () => {
  assert.deepEqual(parseAgentRequest("new Explain"), {
    ok: true,
    action: "new",
    message: "Explain",
  });
  assert.deepEqual(parseAgentRequest("resume session_abc123 Continue"), {
    ok: true,
    action: "resume",
    sessionId: "session_abc123",
    message: "Continue",
  });
  assert.deepEqual(parseAgentRequest("resume --last Continue"), {
    ok: true,
    action: "resume-last",
    message: "Continue",
  });
  assert.deepEqual(parseAgentRequest("exit"), {
    ok: true,
    action: "exit",
  });
  assert.deepEqual(parseAgentRequest("session"), {
    ok: true,
    action: "session",
  });
  assert.deepEqual(parseAgentRequest("-- new architecture means what?"), {
    ok: true,
    action: "plain",
    message: "new architecture means what?",
  });
  assert.deepEqual(parseAgentRequest("resume bad Continue"), {
    ok: false,
    response: "Usage: /agent resume <session_id> <instruction>",
  });
});

test("handleAgent resumes the bound Codex session for the current chat and repo", () => {
  const calls = [];
  const state = {
    currentRepo: "app",
    cwd: "/tmp/app",
    tasks: {},
    askSessions: {
      "123": {
        app: { codexSessionId: "session_abc123" },
      },
      "456": {
        app: { codexSessionId: "session_other123" },
      },
    },
  };
  const result = handleAgent("Continue the analysis.", state, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_resume_1\nUse /logs task_resume_1 to view output." };
    },
  }, 123);

  assert.equal(result.response, "Task started: task_resume_1\nUse /logs task_resume_1 to view output.\nResumed agent session: session_abc123");
  assert.equal(result.stateChanged, false);
  assert.equal(calls[0].type, "agent");
  assert.equal(calls[0].cwd, "/tmp/app");
  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "session_abc123", "Continue the analysis."]);
  assert.equal(calls[0].timeoutMs, AGENT_TIMEOUT_MS);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].repoAlias, "app");
  assert.equal(calls[0].codexSessionId, "session_abc123");
});

test("handleAgent defaults all task-starting request forms to no forced timeout", () => {
  const calls = [];
  const taskExecutor = {
    startTask(request) {
      calls.push(request);
      return { response: `Task started: task_${calls.length}\nUse /logs task_${calls.length} to view output.` };
    },
  };
  const state = {
    currentRepo: "app",
    cwd: "/tmp/app",
    tasks: {},
    askSessions: {
      "123": {
        app: { codexSessionId: "session_abc123" },
      },
    },
  };

  handleAgent("Plain follow-up.", state, taskExecutor, 123);
  handleAgent("new Start fresh.", state, taskExecutor, 123);
  handleAgent("resume session_new123 Continue.", state, taskExecutor, 123);
  handleAgent("resume --last Continue last.", state, taskExecutor, 123);

  assert.deepEqual(calls.map((call) => call.timeoutMs), [null, null, null, null]);
});

test("handleAgent applies configured timeout to all task-starting request forms", () => {
  const calls = [];
  const taskExecutor = {
    startTask(request) {
      calls.push(request);
      return { response: `Task started: task_${calls.length}\nUse /logs task_${calls.length} to view output.` };
    },
  };
  const state = {
    currentRepo: "app",
    cwd: "/tmp/app",
    tasks: {},
    askSessions: {
      "123": {
        app: { codexSessionId: "session_abc123" },
      },
    },
  };

  handleAgent("Plain follow-up.", state, taskExecutor, 123, { agentTaskTimeoutMs: 3600000 });
  handleAgent("new Start fresh.", state, taskExecutor, 123, { agentTaskTimeoutMs: 3600000 });
  handleAgent("resume session_new123 Continue.", state, taskExecutor, 123, { agentTaskTimeoutMs: 3600000 });
  handleAgent("resume --last Continue last.", state, taskExecutor, 123, { agentTaskTimeoutMs: 3600000 });

  assert.deepEqual(calls.map((call) => call.timeoutMs), [3600000, 3600000, 3600000, 3600000]);
});

test("handleAgent new forces a new Codex session without existing binding metadata", () => {
  const calls = [];
  const state = {
    currentRepo: "app",
    cwd: "/tmp/app",
    tasks: {},
    askSessions: {
      "123": {
        app: { codexSessionId: "session_abc123" },
      },
    },
  };
  const result = handleAgent("new Start fresh.", state, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_new_1\nUse /logs task_new_1 to view output." };
    },
  }, 123);

  assert.equal(result.response, "Task started: task_new_1\nUse /logs task_new_1 to view output.");
  assert.equal(result.stateChanged, false);
  assert.equal(calls[0].type, "agent");
  assert.deepEqual(calls[0].args.slice(0, 2), ["exec", "--json"]);
  assert.match(calls[0].args[2], /Instruction:\nStart fresh\./);
  assert.equal(calls[0].codexSessionId, null);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].repoAlias, "app");
});

test("handleAgent resume specific session starts resume task with binding metadata", () => {
  const calls = [];
  const result = handleAgent("resume session_new123 Continue here.", { currentRepo: "app", cwd: "/tmp/app", tasks: {} }, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_resume_1\nUse /logs task_resume_1 to view output." };
    },
  }, 123);

  assert.equal(result.response, "Task started: task_resume_1\nUse /logs task_resume_1 to view output.\nResumed agent session: session_new123");
  assert.equal(result.stateChanged, false);
  assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "session_new123", "Continue here."]);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].repoAlias, "app");
  assert.equal(calls[0].codexSessionId, "session_new123");
});

test("handleAgent resume last uses Codex CLI --last without preselected session metadata", () => {
  const calls = [];
  const result = handleAgent("resume --last Continue last.", { currentRepo: "app", cwd: "/tmp/app", tasks: {} }, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_last_1\nUse /logs task_last_1 to view output." };
    },
  }, 123);

  assert.match(result.response, /^Task started: task_last_1/);
  assert.match(result.response, /Using Codex CLI --last for the runtime user account/);
  assert.equal(result.stateChanged, false);
  assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "--last", "Continue last."]);
  assert.equal(calls[0].codexSessionId, null);
});

test("handleAgent exit disables only current chat and repo mode without clearing binding", () => {
  const state = {
    currentRepo: "app",
    cwd: "/tmp/app",
    tasks: {},
    askSessions: {
      "123": {
        app: { codexSessionId: "session_abc123" },
        other: { codexSessionId: "session_other123" },
      },
      "456": {
        app: { codexSessionId: "session_else123" },
      },
    },
    agentChatModes: {
      "123": {
        app: "enabled",
        other: "enabled",
      },
      "456": {
        app: "enabled",
      },
    },
  };
  const result = handleAgent("exit", state, {
    startTask() {
      throw new Error("should not start");
    },
  }, 123);

  assert.equal(result.response, "Agent chat mode disabled for the current chat and repository.");
  assert.equal(result.stateChanged, true);
  assert.deepEqual(result.state.askSessions, {
    "123": {
      app: { codexSessionId: "session_abc123" },
      other: { codexSessionId: "session_other123" },
    },
    "456": {
      app: { codexSessionId: "session_else123" },
    },
  });
  assert.deepEqual(result.state.agentChatModes, {
    "123": {
      other: "enabled",
    },
    "456": {
      app: "enabled",
    },
  });
});

test("handleAgent session reports repo, binding, and chat mode", () => {
  const state = {
    currentRepo: "app",
    cwd: "/tmp/app",
    tasks: {},
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
  };

  assert.deepEqual(handleAgent("session", state, null, 123), {
    response: "Current agent session:\nrepo: app\nsession: session_abc123\nchat mode: on",
    stateChanged: false,
  });
  assert.deepEqual(handleAgent("session", state, null, 456), {
    response: "Current agent session:\nrepo: app\nsession: none\nchat mode: off",
    stateChanged: false,
  });
});
