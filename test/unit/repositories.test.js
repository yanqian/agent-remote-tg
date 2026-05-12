import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatRepos,
  lookupRepo,
  normalizeRepoConfig,
  validateAlias,
} from "../../src/repositories.js";

test("normalizeRepoConfig resolves relative repository paths", () => {
  const repos = normalizeRepoConfig({ app: "repo" }, "/tmp/base");
  assert.equal(repos.app, "/tmp/base/repo");
});

test("validateAlias rejects traversal and slash aliases", () => {
  assert.throws(() => validateAlias("../repo"), /Invalid repo alias/);
  assert.throws(() => validateAlias("team/repo"), /Invalid repo alias/);
});

test("lookupRepo requires exact aliases and existing directories", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const repos = { app: rootDir };
    assert.deepEqual(lookupRepo(repos, "missing"), {
      ok: false,
      response: "Unknown repo: missing\nUse /repos to list available repos.",
    });
    assert.deepEqual(lookupRepo(repos, "app"), {
      ok: true,
      alias: "app",
      path: rootDir,
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("formatRepos returns aliases and paths", () => {
  assert.equal(formatRepos({ app: "/tmp/app" }), "Available repos:\n- app -> /tmp/app");
});
