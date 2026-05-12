import { spawnSync } from "node:child_process";
import { NO_WORKSPACE_RESPONSE } from "./constants.js";
import { lookupRepo, formatRepos } from "./repositories.js";
import { truncateTelegramResponse } from "./task-executor.js";

export function requireWorkspace(state) {
  if (!state.cwd || !state.currentRepo) {
    return { ok: false, response: NO_WORKSPACE_RESPONSE };
  }

  return { ok: true, cwd: state.cwd, currentRepo: state.currentRepo };
}

export function handleRepos(repos) {
  return { response: formatRepos(repos), stateChanged: false };
}

export function handleUse(args, repos, state) {
  const found = lookupRepo(repos, args);
  if (!found.ok) {
    return { response: found.response, stateChanged: false, state };
  }

  const nextState = {
    ...state,
    currentRepo: found.alias,
    cwd: found.path,
  };

  return {
    response: `Workspace switched:\n${found.alias}\n${found.path}`,
    stateChanged: true,
    state: nextState,
  };
}

export function handlePwd(state) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }

  return { response: workspace.cwd, stateChanged: false };
}

export function handleLs(state, runner = runWorkspaceCommand) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }

  const result = runner(workspace.cwd, "ls", ["-la"]);
  return {
    response: truncateTelegramResponse(formatCommandResult(result, "ls failed.")),
    stateChanged: false,
  };
}

export function handleGit(state, runner = runWorkspaceCommand) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }

  const branch = runner(workspace.cwd, "git", ["branch", "--show-current"]);
  if (!branch.ok) {
    return { response: truncateTelegramResponse(formatCommandResult(branch, "git branch failed.")), stateChanged: false };
  }

  const status = runner(workspace.cwd, "git", ["status", "--short"]);
  if (!status.ok) {
    return { response: truncateTelegramResponse(formatCommandResult(status, "git status failed.")), stateChanged: false };
  }

  const commits = runner(workspace.cwd, "git", ["log", "--oneline", "-5"]);
  if (!commits.ok) {
    return { response: truncateTelegramResponse(formatCommandResult(commits, "git log failed.")), stateChanged: false };
  }

  const response = [
    "Branch:",
    branch.stdout.trim() || "(none)",
    "Status:",
    status.stdout.trim() || "clean",
    "Recent commits:",
    commits.stdout.trim() || "(none)",
  ].join("\n");

  return { response: truncateTelegramResponse(response), stateChanged: false };
}

export function runWorkspaceCommand(cwd, command, args) {
  const result = spawnSync(command, args, {
    cwd,
    shell: false,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });

  return {
    ok: !result.error && result.status === 0,
    command,
    args,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ? result.error.message : "",
  };
}

function formatCommandResult(result, failurePrefix) {
  if (result.ok) {
    return result.stdout || result.stderr || "";
  }

  const details = [result.stderr, result.stdout, result.error].filter(Boolean).join("\n").trim();
  return details ? `${failurePrefix}\n${details}` : failurePrefix;
}
