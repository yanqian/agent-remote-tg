import test from "node:test";
import assert from "node:assert/strict";
import { handleLogs, handleStatus, handleStop } from "../../src/task-management.js";

test("handleStatus lists active tasks and five most recent finished tasks", () => {
  const state = {
    tasks: {
      task_old_1: task("task_old_1", "ask", "succeeded", "2026-05-12T00:00:00.000Z", "2026-05-12T00:01:00.000Z"),
      task_old_2: task("task_old_2", "ask", "failed", "2026-05-12T00:02:00.000Z", "2026-05-12T00:03:00.000Z"),
      task_recent_3: task("task_recent_3", "work", "stopped", "2026-05-12T00:04:00.000Z", "2026-05-12T00:05:00.000Z"),
      task_recent_4: task("task_recent_4", "work", "succeeded", "2026-05-12T00:06:00.000Z", "2026-05-12T00:07:00.000Z"),
      task_recent_5: task("task_recent_5", "continue", "failed", "2026-05-12T00:08:00.000Z", "2026-05-12T00:09:00.000Z"),
      task_recent_6: task("task_recent_6", "run-orch", "succeeded", "2026-05-12T00:10:00.000Z", "2026-05-12T00:11:00.000Z"),
      task_active_1: task("task_active_1", "work", "running", "2026-05-12T00:12:00.000Z", null, 123),
      task_active_2: task("task_active_2", "continue", "stopping", "2026-05-12T00:13:00.000Z", null, 124),
      task_recent_7: task("task_recent_7", "ask", "succeeded", "2026-05-12T00:14:00.000Z", "2026-05-12T00:15:00.000Z"),
    },
  };

  const result = handleStatus(state);

  assert.match(result.response, /^Current tasks:/);
  assert.match(result.response, /task_active_2\n/);
  assert.match(result.response, /status: running/);
  assert.match(result.response, /finishedAt: null/);
  assert.match(result.response, /exitCode: 0/);
  assert.equal(result.response.includes("task_old_1"), false);
  assert.equal(result.response.includes("task_old_2"), false);
});

test("handleStatus reports no tasks when state is empty", () => {
  assert.deepEqual(handleStatus({ tasks: {} }), {
    response: "Current tasks:\n\nNo active or recent finished tasks.",
    stateChanged: false,
  });
});

test("handleLogs rejects invalid task IDs before reading logs", () => {
  const result = handleLogs("../secret", {
    readTaskLog() {
      throw new Error("should not read invalid task IDs");
    },
  });

  assert.deepEqual(result, { response: "Unknown task: ../secret", stateChanged: false });
});

test("handleLogs returns executor log tail response", () => {
  const result = handleLogs("task_abc_1", {
    readTaskLog(taskId, lineCount) {
      assert.equal(taskId, "task_abc_1");
      assert.equal(lineCount, 120);
      return { ok: true, response: "tail" };
    },
  });

  assert.deepEqual(result, { response: "tail", stateChanged: false });
});

test("handleStop rejects invalid task IDs before stopping", () => {
  const result = handleStop("task_bad/path", {
    stopTask() {
      throw new Error("should not stop invalid task IDs");
    },
  });

  assert.deepEqual(result, { response: "Unknown task: task_bad/path", stateChanged: false });
});

test("handleStop returns executor stop response", () => {
  const result = handleStop("task_abc_1", {
    stopTask(taskId) {
      assert.equal(taskId, "task_abc_1");
      return { ok: true, response: "Stopping task task_abc_1." };
    },
  });

  assert.deepEqual(result, { response: "Stopping task task_abc_1.", stateChanged: false });
});

function task(taskId, type, status, startedAt, finishedAt, pid = null) {
  return {
    taskId,
    type,
    status,
    pid,
    cwd: "/repo",
    logPath: `/logs/${taskId}.log`,
    startedAt,
    finishedAt,
    exitCode: status === "succeeded" ? 0 : null,
  };
}
