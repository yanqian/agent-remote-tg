import test from "node:test";
import assert from "node:assert/strict";
import { ASK_TIMEOUT_MS, buildAskPrompt, handleAsk } from "../../src/ask.js";

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
  assert.match(calls[0].args[1], /Do not modify files\./);
  assert.match(calls[0].args[1], /Question:\nExplain the workflow\./);
  assert.equal(calls[0].timeoutMs, ASK_TIMEOUT_MS);
  assert.equal(calls[0].repoAlias, "app");
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

  assert.equal(result.response, "Task started: task_resume_1\nUse /logs task_resume_1 to view output.");
  assert.equal(result.stateChanged, false);
  assert.equal(calls[0].type, "ask");
  assert.equal(calls[0].cwd, "/tmp/app");
  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args, ["exec", "resume", "session_abc123", "Continue the analysis."]);
  assert.equal(calls[0].timeoutMs, ASK_TIMEOUT_MS);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].repoAlias, "app");
  assert.equal(calls[0].codexSessionId, "session_abc123");
});
