import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultState, normalizeRuntimeState } from "../../src/runtime-state.js";

test("feature_list contains unique feature IDs", () => {
  const data = JSON.parse(readFileSync("feature_list.json", "utf8"));
  const ids = data.features.map((feature) => feature.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("first three features are defined for the implemented initialization scope", () => {
  const data = JSON.parse(readFileSync("feature_list.json", "utf8"));
  const descriptions = Object.fromEntries(data.features.map((feature) => [feature.id, feature.description]));
  assert.match(descriptions.F001, /project scaffold and runtime configuration/);
  assert.match(descriptions.F002, /command parsing and authorization/);
  assert.match(descriptions.F003, /repository whitelist and workspace state management/);
});

test("runtime state schema is limited to workspace and Bot task metadata", () => {
  assert.deepEqual(defaultState(), {
    currentRepo: null,
    cwd: null,
    tasks: {},
  });

  const normalized = normalizeRuntimeState({
    currentRepo: "agent-runtime",
    cwd: "/tmp/agent-runtime",
    tasks: {
      task_abc_1: {
        taskId: "task_abc_1",
        type: "ask",
        status: "succeeded",
      },
    },
    features: [{ id: "F999", passes: true }],
    progress: { current: "F999" },
  });

  assert.deepEqual(Object.keys(normalized), ["currentRepo", "cwd", "tasks"]);
  assert.equal(Object.hasOwn(normalized, "features"), false);
  assert.equal(Object.hasOwn(normalized, "progress"), false);
});
