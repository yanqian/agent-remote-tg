import test from "node:test";
import assert from "node:assert/strict";
import { ASK_TIMEOUT_MS, buildAskPrompt, handleAsk, parseAskRequest } from "../../src/ask.js";

test("buildAskPrompt includes the required read-only rules and question", () => {
  const prompt = buildAskPrompt("Explain the workflow.");

  assert.match(prompt, /Rules:\n- Discuss and analyze only\.\n- Do not modify files\.\n- Do not update SPEC\.md\.\n- Do not update feature_list\.json\.\n- Do not run orchestrator\.py\.\n- Do not commit\./);
  assert.match(prompt, /Question:\nExplain the workflow\./);
});

test("handleAsk requires a selected workspace", () => {
  const result = handleAsk("Explain", { currentRepo: null, cwd: null, tasks: {} }, {
    startTask() {
      throw new Error("should not start");
    },
  });

  assert.deepEqual(result, {
    response: "No workspace selected.\nUse /repos then /use <repo>.",
    stateChanged: false,
  });
});

test("handleAsk starts a read-only codex exec task in the selected workspace", () => {
  const calls = [];
  const result = handleAsk("Explain the workflow.", { currentRepo: "app", cwd: "/tmp/app", tasks: {} }, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_abc_1\nUse /logs task_abc_1 to view output." };
    },
  });

  assert.equal(result.response, "Task started: task_abc_1\nUse /logs task_abc_1 to view output.");
  assert.equal(result.stateChanged, false);
  assert.equal(calls[0].type, "ask");
  assert.equal(calls[0].cwd, "/tmp/app");
  assert.equal(calls[0].command, "codex");
  assert.equal(calls[0].args[0], "exec");
  assert.equal(calls[0].args[1], "--json");
  assert.match(calls[0].args[2], /Do not modify files\./);
  assert.match(calls[0].args[2], /Question:\nExplain the workflow\./);
  assert.equal(calls[0].timeoutMs, ASK_TIMEOUT_MS);
  assert.equal(calls[0].repoAlias, "app");
});

test("parseAskRequest handles subcommands and literal reserved words", () => {
  assert.deepEqual(parseAskRequest("new Explain"), {
    ok: true,
    action: "new",
    message: "Explain",
  });
  assert.deepEqual(parseAskRequest("resume session_abc123 Continue"), {
    ok: true,
    action: "resume",
    sessionId: "session_abc123",
    message: "Continue",
  });
  assert.deepEqual(parseAskRequest("resume --last Continue"), {
    ok: true,
    action: "resume-last",
    message: "Continue",
  });
  assert.deepEqual(parseAskRequest("exit"), {
    ok: true,
    action: "exit",
  });
  assert.deepEqual(parseAskRequest("session"), {
    ok: true,
    action: "session",
  });
  assert.deepEqual(parseAskRequest("-- new architecture means what?"), {
    ok: true,
    action: "plain",
    message: "new architecture means what?",
  });
  assert.deepEqual(parseAskRequest("resume bad Continue"), {
    ok: false,
    response: "Usage: /ask resume <session_id> <message>",
  });
});

test("handleAsk resumes the bound Codex session for the current chat and repo", () => {
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
  const result = handleAsk("Continue the analysis.", state, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_resume_1\nUse /logs task_resume_1 to view output." };
    },
  }, 123);

  assert.equal(result.response, "Task started: task_resume_1\nUse /logs task_resume_1 to view output.\nResumed ask session: session_abc123");
  assert.equal(result.stateChanged, false);
  assert.equal(calls[0].type, "ask");
  assert.equal(calls[0].cwd, "/tmp/app");
  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "session_abc123", "Continue the analysis."]);
  assert.equal(calls[0].timeoutMs, ASK_TIMEOUT_MS);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].repoAlias, "app");
  assert.equal(calls[0].codexSessionId, "session_abc123");
});

test("handleAsk new forces a new Codex session without existing binding metadata", () => {
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
  const result = handleAsk("new Start fresh.", state, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_new_1\nUse /logs task_new_1 to view output." };
    },
  }, 123);

  assert.equal(result.response, "Task started: task_new_1\nUse /logs task_new_1 to view output.");
  assert.equal(result.stateChanged, false);
  assert.equal(calls[0].type, "ask");
  assert.deepEqual(calls[0].args.slice(0, 2), ["exec", "--json"]);
  assert.match(calls[0].args[2], /Question:\nStart fresh\./);
  assert.equal(calls[0].codexSessionId, null);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].repoAlias, "app");
});

test("handleAsk resume specific session starts resume task with binding metadata", () => {
  const calls = [];
  const result = handleAsk("resume session_new123 Continue here.", { currentRepo: "app", cwd: "/tmp/app", tasks: {} }, {
    startTask(request) {
      calls.push(request);
      return { response: "Task started: task_resume_1\nUse /logs task_resume_1 to view output." };
    },
  }, 123);

  assert.equal(result.response, "Task started: task_resume_1\nUse /logs task_resume_1 to view output.\nResumed ask session: session_new123");
  assert.equal(result.stateChanged, false);
  assert.deepEqual(calls[0].args, ["exec", "--json", "resume", "session_new123", "Continue here."]);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].repoAlias, "app");
  assert.equal(calls[0].codexSessionId, "session_new123");
});

test("handleAsk resume last uses Codex CLI --last without preselected session metadata", () => {
  const calls = [];
  const result = handleAsk("resume --last Continue last.", { currentRepo: "app", cwd: "/tmp/app", tasks: {} }, {
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

test("handleAsk exit removes only the current chat and repo binding", () => {
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
  };
  const result = handleAsk("exit", state, {
    startTask() {
      throw new Error("should not start");
    },
  }, 123);

  assert.equal(result.response, "Ask session cleared for the current chat and repository.");
  assert.equal(result.stateChanged, true);
  assert.deepEqual(result.state.askSessions, {
    "123": {
      other: { codexSessionId: "session_other123" },
    },
    "456": {
      app: { codexSessionId: "session_else123" },
    },
  });
});

test("handleAsk session reports current binding or no selected session", () => {
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

  assert.deepEqual(handleAsk("session", state, null, 123), {
    response: "Current ask session:\nrepo: app\nsession: session_abc123",
    stateChanged: false,
  });
  assert.deepEqual(handleAsk("session", state, null, 456), {
    response: "No ask session selected for the current chat and repository.",
    stateChanged: false,
  });
});
