import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatRepos,
  lookupRepo,
  normalizeRepoConfig,
  parseRepoWhitelistJson,
  validateAlias,
} from "../../src/repositories.js";

test("normalizeRepoConfig resolves relative repository paths", () => {
  const repos = normalizeRepoConfig({ app: "repo" }, "/tmp/base");
  assert.equal(repos.app, "/tmp/base/repo");
});

test("parseRepoWhitelistJson accepts a repository alias map", () => {
  assert.deepEqual(parseRepoWhitelistJson('{"app":"/tmp/app"}'), { app: "/tmp/app" });
  assert.deepEqual(parseRepoWhitelistJson(""), {});
});

test("parseRepoWhitelistJson rejects invalid JSON and non-object values", () => {
  assert.throws(() => parseRepoWhitelistJson("{"), /REPO_WHITELIST_JSON must be valid JSON/);
  assert.throws(
    () => parseRepoWhitelistJson('["/tmp/app"]'),
    /REPO_WHITELIST_JSON must be a JSON object/,
  );
});

test("validateAlias rejects traversal and slash aliases", () => {
  assert.throws(() => validateAlias("../repo"), /Invalid repo alias/);
  assert.throws(() => validateAlias("team/repo"), /Invalid repo alias/);
  assert.throws(() => validateAlias(" app"), /Invalid repo alias/);
});

test("normalizeRepoConfig validates existing repository paths when required", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repos-"));
  const repoDir = join(rootDir, "repo");
  try {
    mkdirSync(repoDir);
    const repos = normalizeRepoConfig({ app: repoDir }, rootDir, { requireExisting: true });
    assert.equal(repos.app, repoDir);
    assert.throws(
      () => normalizeRepoConfig({ missing: join(rootDir, "missing") }, rootDir, { requireExisting: true }),
      /Repo path is not available: missing/,
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
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
