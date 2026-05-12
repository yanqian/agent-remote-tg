import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
