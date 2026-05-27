import { relative, resolve } from "node:path";
import { buildApprovalInlineKeyboard, buildApprovalTelegramMessage } from "./approval.js";
import { isValidApprovalRequestId, normalizeRuntimeState } from "./runtime-state.js";
import { redactForTelegram, truncateTelegramResponse } from "./task-executor.js";
import { runWorkspaceCommand, requireWorkspace } from "./workspace.js";

let gitCommitPushSequence = 0;

export function handleGitCommitPush(message, state, chatId, runner = runWorkspaceCommand, now = new Date()) {
  const commitMessage = String(message ?? "").trim();
  if (commitMessage.length === 0) {
    return { response: "Usage: /git_commit_push <message>", stateChanged: false };
  }

  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }

  const branch = runner(workspace.cwd, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ok) {
    return { response: redactForTelegram(formatGitFailure("git branch lookup failed.", branch)), stateChanged: false };
  }
  const branchName = branch.stdout.trim();
  if (!isSafeBranchName(branchName)) {
    return { response: "Cannot commit and push because the current branch could not be determined.", stateChanged: false };
  }

  const status = runner(workspace.cwd, "git", ["status", "--short", "--untracked-files=all"]);
  if (!status.ok) {
    return { response: redactForTelegram(formatGitFailure("git status failed.", status)), stateChanged: false };
  }
  const parsedStatus = parseStatusShort(status.stdout, workspace.cwd);
  if (!parsedStatus.ok) {
    return { response: parsedStatus.response, stateChanged: false };
  }
  if (parsedStatus.paths.length === 0) {
    return { response: "No changes to commit in the selected repository.", stateChanged: false };
  }

  const staged = runner(workspace.cwd, "git", ["diff", "--cached", "--name-status"]);
  if (!staged.ok) {
    return { response: redactForTelegram(formatGitFailure("git staged-file preview failed.", staged)), stateChanged: false };
  }

  const normalized = normalizeRuntimeState(state);
  const requestId = generateGitCommitPushRequestId(normalized.approvalRequests);
  const request = {
    requestId,
    status: "pending",
    taskId: null,
    chatId: String(chatId),
    repoAlias: workspace.currentRepo,
    source: "git_commit_push",
    cwd: workspace.cwd,
    branch: branchName,
    fileList: parsedStatus.paths,
    commitMessage,
    detail: {
      category: "git_commit_push",
      action: "commit_and_push",
      command: "git add -- <previewed paths>; git commit -m <message>; git push origin <branch>",
      path: workspace.cwd,
      description: `Commit ${parsedStatus.paths.length} changed path(s) on ${branchName} and push to origin/${branchName}.`,
    },
    options: [
      { optionId: "opt_1", codexOptionId: "approve_git_commit_push", label: "Approve", decision: "approved" },
      { optionId: "opt_2", codexOptionId: "reject_git_commit_push", label: "Reject", decision: "rejected" },
    ],
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    telegramMessageId: null,
    allowRule: {
      source: "git_commit_push",
      repoAlias: workspace.currentRepo,
      cwd: workspace.cwd,
      branch: branchName,
      fileList: parsedStatus.paths,
    },
  };

  return {
    response: truncateTelegramResponse(formatPreviewResponse({
      requestId,
      branch: branchName,
      status: status.stdout,
      staged: staged.stdout,
      files: parsedStatus.paths,
    })),
    stateChanged: true,
    state: {
      ...normalized,
      approvalRequests: {
        ...normalized.approvalRequests,
        [requestId]: request,
      },
    },
    approvalNotification: {
      requestId,
      chatId: String(chatId),
      text: buildApprovalTelegramMessage(request),
      replyMarkup: buildApprovalInlineKeyboard(request),
      request,
    },
  };
}

export function resolveGitCommitPushApproval({ request, state, selectedOption, runner = runWorkspaceCommand }) {
  if (!isGitCommitPushRequest(request)) {
    return { handled: false };
  }
  if (selectedOption?.decision !== "approved") {
    return { handled: true, response: "Git commit/push rejected; repository was not changed.", state };
  }

  const validation = validateGitCommitPushRequest(request);
  if (!validation.ok) {
    return {
      handled: true,
      response: validation.response,
      state: recordGitCommitPushResult(state, request.requestId, { ok: false, phase: "validation", message: validation.response }),
    };
  }

  const branch = runner(request.cwd, "git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch.ok) {
    const response = redactForTelegram(formatGitFailure("Git branch recheck failed. Repository was not changed.", branch));
    return {
      handled: true,
      response,
      state: recordGitCommitPushResult(state, request.requestId, { ok: false, phase: "branch", response }),
    };
  }
  const branchName = branch.stdout.trim();
  if (!isSafeBranchName(branchName)) {
    const response = "Git branch recheck could not determine a safe current branch. Repository was not changed.";
    return {
      handled: true,
      response,
      state: recordGitCommitPushResult(state, request.requestId, { ok: false, phase: "branch", response }),
    };
  }
  if (branchName !== request.branch) {
    const response = `Git branch changed from ${request.branch} to ${branchName || "(unknown)"}. Repository was not changed.`;
    return {
      handled: true,
      response,
      state: recordGitCommitPushResult(state, request.requestId, { ok: false, phase: "branch", response }),
    };
  }

  const add = runner(request.cwd, "git", ["add", "--", ...request.fileList]);
  if (!add.ok) {
    const response = redactForTelegram(formatGitFailure("Git add failed.", add));
    return {
      handled: true,
      response,
      state: recordGitCommitPushResult(state, request.requestId, { ok: false, phase: "add", response }),
    };
  }

  const commit = runner(request.cwd, "git", ["commit", "-m", request.commitMessage]);
  if (!commit.ok) {
    const response = redactForTelegram(formatGitFailure("Git commit failed. Push was not run.", commit));
    return {
      handled: true,
      response,
      state: recordGitCommitPushResult(state, request.requestId, { ok: false, phase: "commit", response }),
    };
  }

  const push = runner(request.cwd, "git", ["push", "origin", request.branch]);
  if (!push.ok) {
    const response = redactForTelegram(formatPushFailure(push));
    return {
      handled: true,
      response,
      state: recordGitCommitPushResult(state, request.requestId, { ok: false, phase: "push", response }),
    };
  }

  const response = redactForTelegram([
    "Git commit and push succeeded.",
    "Commit:",
    firstNonEmptyLine(commit.stdout, commit.stderr) || "(no commit summary)",
    "Push:",
    firstNonEmptyLine(push.stdout, push.stderr) || `pushed origin ${request.branch}`,
  ].join("\n"));
  return {
    handled: true,
    response,
    state: recordGitCommitPushResult(state, request.requestId, { ok: true, phase: "complete", response }),
  };
}

export function parseStatusShort(stdout, cwd) {
  const paths = [];
  const seen = new Set();
  for (const rawLine of String(stdout ?? "").split(/\r?\n/)) {
    if (rawLine.trim().length === 0) {
      continue;
    }
    if (rawLine.length < 4) {
      return { ok: false, response: "Cannot commit because git status output was not recognized." };
    }
    const statusCode = rawLine.slice(0, 2);
    let path = rawLine.slice(3);
    if (/^[RC]/.test(statusCode) && path.includes(" -> ")) {
      path = path.split(" -> ").pop();
    }
    const safe = normalizeGitPath(path, cwd);
    if (!safe.ok) {
      return { ok: false, response: safe.response };
    }
    if (!seen.has(safe.path)) {
      seen.add(safe.path);
      paths.push(safe.path);
    }
  }
  return { ok: true, paths };
}

function validateGitCommitPushRequest(request) {
  if (!isValidApprovalRequestId(request?.requestId)) {
    return { ok: false, response: "Invalid git commit/push approval request." };
  }
  if (!isGitCommitPushRequest(request)) {
    return { ok: false, response: "Approval request is not a git commit/push request." };
  }
  if (typeof request.cwd !== "string" || request.cwd.length === 0) {
    return { ok: false, response: "Git commit/push request is missing its repository path." };
  }
  if (!isSafeBranchName(request.branch)) {
    return { ok: false, response: "Git commit/push request has an unsafe branch name." };
  }
  if (typeof request.commitMessage !== "string" || request.commitMessage.trim().length === 0) {
    return { ok: false, response: "Git commit/push request is missing its commit message." };
  }
  if (!Array.isArray(request.fileList) || request.fileList.length === 0) {
    return { ok: false, response: "Git commit/push request has no explicit files to stage." };
  }
  for (const path of request.fileList) {
    const safe = normalizeGitPath(path, request.cwd);
    if (!safe.ok || safe.path !== path) {
      return { ok: false, response: "Git commit/push request includes an unsafe file path." };
    }
  }
  return { ok: true };
}

function normalizeGitPath(path, cwd) {
  const value = String(path ?? "");
  if (
    value.length === 0 ||
    value.startsWith("\"") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.split(/[\\/]+/).includes("..")
  ) {
    return { ok: false, response: "Cannot commit because git reported an unsafe path." };
  }
  const absolute = resolve(cwd, value);
  const rel = relative(cwd, absolute);
  if (rel.startsWith("..") || rel === "" || resolve(cwd, rel) !== absolute) {
    return { ok: false, response: "Cannot commit because git reported a path outside the selected repository." };
  }
  return { ok: true, path: value };
}

function isGitCommitPushRequest(request) {
  return request?.source === "git_commit_push" || request?.detail?.category === "git_commit_push";
}

function recordGitCommitPushResult(state, requestId, result) {
  const normalized = normalizeRuntimeState(state);
  const request = normalized.approvalRequests[requestId];
  if (!request) {
    return normalized;
  }
  return {
    ...normalized,
    approvalRequests: {
      ...normalized.approvalRequests,
      [requestId]: {
        ...request,
        gitCommitPushResult: {
          ...result,
          recordedAt: new Date().toISOString(),
        },
      },
    },
  };
}

function generateGitCommitPushRequestId(existingRequests = {}) {
  let requestId;
  do {
    gitCommitPushSequence += 1;
    requestId = `gcp_${Date.now().toString(36)}_${gitCommitPushSequence.toString(36)}`;
  } while (existingRequests && Object.hasOwn(existingRequests, requestId));
  return requestId;
}

function isSafeBranchName(value) {
  return typeof value === "string" && value.length > 0 && value !== "HEAD" && !value.startsWith("-") && !/[\u0000-\u001f\u007f\s~^:?*[\\]/.test(value);
}

function formatPreviewResponse({ requestId, branch, status, staged, files }) {
  return [
    `Git commit/push approval request: ${requestId}`,
    `Use /approve ${requestId}`,
    `Use /reject ${requestId}`,
    "Branch:",
    branch,
    "Status:",
    trimTrailing(status) || "clean",
    "Staged files:",
    trimTrailing(staged) || "(none)",
    "Files to stage:",
    files.join("\n"),
  ].join("\n");
}

function formatPushFailure(result) {
  const details = [result.stderr, result.stdout, result.error].filter(Boolean).join("\n");
  const classification = classifyPushFailure(details);
  const prefix = classification ? `Git push failed (${classification}).` : "Git push failed.";
  return formatGitFailure(prefix, result);
}

export function classifyPushFailure(text) {
  const value = String(text ?? "").toLowerCase();
  if (/could not resolve host|name or service not known|temporary failure in name resolution|network is unreachable|failed to connect|couldn't connect|connection timed out/.test(value)) {
    return "network/DNS";
  }
  if (/permission denied|authentication failed|could not read username|repository not found|access denied|403|401|publickey/.test(value)) {
    return "authentication/permission";
  }
  return null;
}

function formatGitFailure(prefix, result) {
  const details = [result.stderr, result.stdout, result.error].filter(Boolean).join("\n").trim();
  return details ? `${prefix}\n${details}` : prefix;
}

function firstNonEmptyLine(...values) {
  for (const value of values) {
    const line = String(value ?? "").split(/\r?\n/).find((candidate) => candidate.trim().length > 0);
    if (line) {
      return line.trim();
    }
  }
  return "";
}

function trimTrailing(value) {
  return String(value ?? "").replace(/[\r\n\s]+$/g, "");
}
