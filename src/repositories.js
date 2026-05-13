import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function parseRepoWhitelistJson(value) {
  if (!value) {
    throw new Error("REPO_WHITELIST_JSON is required.");
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("REPO_WHITELIST_JSON must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("REPO_WHITELIST_JSON must be a JSON object mapping aliases to paths.");
  }

  return parsed;
}

export function normalizeRepoConfig(rawRepos, baseDir = process.cwd(), options = {}) {
  const repos = {};
  for (const [alias, repoPath] of Object.entries(rawRepos ?? {})) {
    validateAlias(alias);
    if (typeof repoPath !== "string" || repoPath.trim() === "") {
      throw new Error(`Invalid path for repo: ${alias}`);
    }
    const normalizedPath = isAbsolute(repoPath) ? resolve(repoPath) : resolve(baseDir, repoPath);
    if (options.requireExisting && (!existsSync(normalizedPath) || !statSync(normalizedPath).isDirectory())) {
      throw new Error(`Repo path is not available: ${alias}`);
    }
    repos[alias] = normalizedPath;
  }
  return repos;
}

export function validateAlias(alias) {
  if (
    typeof alias !== "string"
    || alias.trim() === ""
    || alias !== alias.trim()
    || !/^[A-Za-z0-9._-]+$/.test(alias)
    || alias.includes("..")
    || alias.includes("/")
    || alias.includes("\\")
  ) {
    throw new Error(`Invalid repo alias: ${alias}`);
  }
}

export function listRepos(repos) {
  return Object.entries(repos).map(([alias, repoPath]) => ({ alias, path: repoPath }));
}

export function lookupRepo(repos, alias) {
  if (!Object.prototype.hasOwnProperty.call(repos, alias)) {
    return {
      ok: false,
      response: `Unknown repo: ${alias}\nUse /repos to list available repos.`,
    };
  }

  const repoPath = repos[alias];
  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    return {
      ok: false,
      response: `Repo path is not available: ${alias}`,
    };
  }

  return { ok: true, alias, path: repoPath };
}

export function formatRepos(repos) {
  const entries = listRepos(repos);
  if (entries.length === 0) {
    return "Available repos:\n";
  }

  return [
    "Available repos:",
    ...entries.map((entry) => `- ${entry.alias} -> ${entry.path}`),
  ].join("\n");
}
