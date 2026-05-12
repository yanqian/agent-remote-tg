import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContinuePrompt,
  buildWorkPrompt,
  findActiveWorkflowTask,
  handleContinue,
  handleRunOrch,
  handleWork,
  parseOrchestratorRounds,
} from "../../src/work.js";

test("buildWorkPrompt includes the required long-running workflow rules and requirement", () => {
  const prompt = buildWorkPrompt("Add audit logging.");

  assert.match(prompt, /Requirement:\nAdd audit logging\./);
  assert.match(prompt, /1\. Read AGENTS\.md, progress\.md, feature_list\.json, and git log --oneline -20\./);
  assert.match(prompt, /2\. Run \.\/init\.sh before changing files\./);
  assert.match(prompt, /4\. Update SPEC\.md through the repository planning workflow\./);
  assert.match(prompt, /5\. Append new feature entries to feature_list\.json when new work is required\./);
  assert.match(prompt, /6\. Preserve all existing feature IDs, ordering, passes, status, attempts, last_error, and unknown fields\./);
  assert.match(prompt, /8\. Create a planning commit when planning files changed\./);
  assert.match(prompt, /9\. Run python3 orchestrator\.py --max-rounds 1\./);
  assert.match(prompt, /10\. Treat the task as complete only when the orchestrator and evaluator workflow pass\./);
  assert.match(prompt, /Do not rely on chat history\./);
});

test("buildContinuePrompt includes the required recovery rules and instruction", () => {
  const prompt = buildContinuePrompt("Recover the interrupted F009 run.");

  assert.match(prompt, /Instruction:\nRecover the interrupted F009 run\./);
  assert.match(prompt, /Do not rely on chat history\./);
  assert.match(prompt, /Read AGENTS\.md, progress\.md, feature_list\.json, and git log --oneline -20 before deciding the next action\./);
  assert.match(prompt, /Run \.\/init\.sh before changing files\./);
  assert.match(prompt, /Use orchestrator\.py according to AGENTS\.md when implementation or evaluation is required\./);
  assert.match(prompt, /Do not overwrite feature_list\.json\./);
  assert.match(prompt, /Do not reset existing feature state\./);
  assert.match(prompt, /Stop and report exact conflicts when repository state is unsafe\./);
});

test("findActiveWorkflowTask detects only active workflow tasks in the same workspace", () => {
  const state = {
    tasks: {
      task_ask_1: { taskId: "task_ask_1", type: "ask", status: "running", cwd: "/repo" },
      task_done_1: { taskId: "task_done_1", type: "work", status: "succeeded", cwd: "/repo" },
      task_other_1: { taskId: "task_other_1", type: "run-orch", status: "running", cwd: "/other" },
      task_work_1: { taskId: "task_work_1", type: "continue", status: "stopping", cwd: "/repo" },
    },
  };

  assert.deepEqual(findActiveWorkflowTask(state, "/repo"), state.tasks.task_work_1);
  assert.equal(findActiveWorkflowTask(state, "/empty"), null);
});

test("handleWork requires a selected agent-workflow ready workspace", () => {
  const result = handleWork("Add docs", { currentRepo: null, cwd: null, tasks: {} }, {
    startTask() {
      throw new Error("should not start");
    },
  });

  assert.deepEqual(result, {
    response: "No workspace selected.\nUse /repos then /use <repo>.",
    stateChanged: false,
  });
});

test("handleWork rejects concurrent active workflow tasks in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-work-"));
  try {
    writeWorkflowFiles(rootDir);
    const result = handleWork("Add docs", {
      currentRepo: "app",
      cwd: rootDir,
      tasks: {
        task_active_1: {
          taskId: "task_active_1",
          type: "run-orch",
          status: "running",
          cwd: rootDir,
        },
      },
    }, {
      startTask() {
        throw new Error("should not start");
      },
    });

    assert.deepEqual(result, {
      response: "Active workflow task already running in this workspace: task_active_1\nUse /status or /logs task_active_1.",
      stateChanged: false,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("handleWork starts a codex exec workflow task in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-work-"));
  const calls = [];
  try {
    writeWorkflowFiles(rootDir);
    const result = handleWork("Add docs", { currentRepo: "app", cwd: rootDir, tasks: {} }, {
      startTask(request) {
        calls.push(request);
        return { response: "Task started: task_abc_1\nUse /logs task_abc_1 to view output." };
      },
    });

    assert.equal(result.response, "Task started: task_abc_1\nUse /logs task_abc_1 to view output.");
    assert.equal(result.stateChanged, false);
    assert.equal(calls[0].type, "work");
    assert.equal(calls[0].cwd, rootDir);
    assert.equal(calls[0].command, "codex");
    assert.deepEqual(calls[0].args.slice(0, 1), ["exec"]);
    assert.match(calls[0].args[1], /Requirement:\nAdd docs/);
    assert.match(calls[0].args[1], /Run python3 orchestrator\.py --max-rounds 1\./);
    assert.equal(calls[0].timeoutMs, null);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("handleContinue requires a selected agent-workflow ready workspace", () => {
  const result = handleContinue("Resume work", { currentRepo: null, cwd: null, tasks: {} }, {
    startTask() {
      throw new Error("should not start");
    },
  });

  assert.deepEqual(result, {
    response: "No workspace selected.\nUse /repos then /use <repo>.",
    stateChanged: false,
  });
});

test("handleContinue rejects concurrent active workflow tasks in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-continue-"));
  try {
    writeWorkflowFiles(rootDir);
    const result = handleContinue("Resume work", {
      currentRepo: "app",
      cwd: rootDir,
      tasks: {
        task_active_1: {
          taskId: "task_active_1",
          type: "work",
          status: "running",
          cwd: rootDir,
        },
      },
    }, {
      startTask() {
        throw new Error("should not start");
      },
    });

    assert.deepEqual(result, {
      response: "Active workflow task already running in this workspace: task_active_1\nUse /status or /logs task_active_1.",
      stateChanged: false,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("handleContinue starts a codex exec recovery task in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-continue-"));
  const calls = [];
  try {
    writeWorkflowFiles(rootDir);
    const result = handleContinue("Resume F009 from repository state", { currentRepo: "app", cwd: rootDir, tasks: {} }, {
      startTask(request) {
        calls.push(request);
        return { response: "Task started: task_continue_1\nUse /logs task_continue_1 to view output." };
      },
    });

    assert.equal(result.response, "Task started: task_continue_1\nUse /logs task_continue_1 to view output.");
    assert.equal(result.stateChanged, false);
    assert.equal(calls[0].type, "continue");
    assert.equal(calls[0].cwd, rootDir);
    assert.equal(calls[0].command, "codex");
    assert.deepEqual(calls[0].args.slice(0, 1), ["exec"]);
    assert.match(calls[0].args[1], /Instruction:\nResume F009 from repository state/);
    assert.match(calls[0].args[1], /Do not rely on chat history\./);
    assert.match(calls[0].args[1], /Do not reset existing feature state\./);
    assert.equal(calls[0].timeoutMs, null);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("parseOrchestratorRounds accepts only integers from one through five", () => {
  assert.deepEqual(parseOrchestratorRounds("1"), { ok: true, value: 1 });
  assert.deepEqual(parseOrchestratorRounds("5"), { ok: true, value: 5 });
  assert.deepEqual(parseOrchestratorRounds(" 3 "), { ok: true, value: 3 });
  for (const input of ["0", "6", "1.5", "2 rounds", "abc", ""]) {
    assert.deepEqual(parseOrchestratorRounds(input), {
      ok: false,
      response: "Invalid rounds. Use an integer from 1 to 5.",
    });
  }
});

test("handleRunOrch requires valid rounds before workspace readiness", () => {
  const result = handleRunOrch("6", { currentRepo: null, cwd: null, tasks: {} }, {
    startTask() {
      throw new Error("should not start");
    },
  });

  assert.deepEqual(result, {
    response: "Invalid rounds. Use an integer from 1 to 5.",
    stateChanged: false,
  });
});

test("handleRunOrch requires a selected agent-workflow ready workspace", () => {
  const result = handleRunOrch("1", { currentRepo: null, cwd: null, tasks: {} }, {
    startTask() {
      throw new Error("should not start");
    },
  });

  assert.deepEqual(result, {
    response: "No workspace selected.\nUse /repos then /use <repo>.",
    stateChanged: false,
  });
});

test("handleRunOrch rejects concurrent active workflow tasks in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-run-orch-"));
  try {
    writeWorkflowFiles(rootDir);
    const result = handleRunOrch("2", {
      currentRepo: "app",
      cwd: rootDir,
      tasks: {
        task_active_1: {
          taskId: "task_active_1",
          type: "work",
          status: "running",
          cwd: rootDir,
        },
      },
    }, {
      startTask() {
        throw new Error("should not start");
      },
    });

    assert.deepEqual(result, {
      response: "Active workflow task already running in this workspace: task_active_1\nUse /status or /logs task_active_1.",
      stateChanged: false,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("handleRunOrch starts a shell-disabled orchestrator task in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-run-orch-"));
  const calls = [];
  try {
    writeWorkflowFiles(rootDir);
    const result = handleRunOrch("4", { currentRepo: "app", cwd: rootDir, tasks: {} }, {
      startTask(request) {
        calls.push(request);
        return { response: "Task started: task_orch_1\nUse /logs task_orch_1 to view output." };
      },
    });

    assert.equal(result.response, "Task started: task_orch_1\nUse /logs task_orch_1 to view output.");
    assert.equal(result.stateChanged, false);
    assert.equal(calls[0].type, "run-orch");
    assert.equal(calls[0].cwd, rootDir);
    assert.equal(calls[0].command, "python3");
    assert.deepEqual(calls[0].args, ["orchestrator.py", "--max-rounds", "4"]);
    assert.equal(calls[0].timeoutMs, null);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

function writeWorkflowFiles(rootDir) {
  mkdirSync(rootDir, { recursive: true });
  for (const fileName of ["AGENTS.md", "SPEC.md", "feature_list.json", "progress.md", "init.sh", "orchestrator.py"]) {
    writeFileSync(join(rootDir, fileName), "");
  }
}
