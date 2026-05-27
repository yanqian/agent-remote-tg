import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyPushFailure,
  handleGitCommitPush,
  parseStatusShort,
  resolveGitCommitPushApproval,
} from "../../src/git-commit-push.js";

test("handleGitCommitPush requires workspace, message, branch, and changes before approval", () => {
  assert.equal(handleGitCommitPush("", {}, "123").response, "Usage: /git_commit_push <message>");
  assert.equal(
    handleGitCommitPush("Publish changes", {}, "123").response,
    "No workspace selected.\nUse /repos then /use <repo>.",
  );

  const clean = handleGitCommitPush("Publish changes", { currentRepo: "app", cwd: "/repo" }, "123", gitRunner({
    "git rev-parse --abbrev-ref HEAD": { ok: true, stdout: "main\n" },
    "git status --short --untracked-files=all": { ok: true, stdout: "" },
    "git diff --cached --name-status": { ok: true, stdout: "" },
  }));
  assert.equal(clean.response, "No changes to commit in the selected repository.");

  const detached = handleGitCommitPush("Publish changes", { currentRepo: "app", cwd: "/repo" }, "123", gitRunner({
    "git rev-parse --abbrev-ref HEAD": { ok: true, stdout: "HEAD\n" },
  }));
  assert.equal(detached.response, "Cannot commit and push because the current branch could not be determined.");
});

test("handleGitCommitPush creates a bounded approval request with preview metadata", () => {
  const calls = [];
  const result = handleGitCommitPush("Publish changes", { currentRepo: "app", cwd: "/repo" }, "123", gitRunner({
    "git rev-parse --abbrev-ref HEAD": { ok: true, stdout: "main\n" },
    "git status --short --untracked-files=all": { ok: true, stdout: " M README.md\n?? src/new.js\n" },
    "git diff --cached --name-status": { ok: true, stdout: "M\tREADME.md\n" },
  }, calls), new Date("2026-05-27T00:00:00.000Z"));

  assert.equal(result.stateChanged, true);
  assert.match(result.response, /^Git commit\/push approval request: gcp_/);
  assert.match(result.response, /Branch:\nmain/);
  assert.match(result.response, /Staged files:\nM\tREADME\.md/);
  assert.match(result.response, /Files to stage:\nREADME\.md\nsrc\/new\.js/);
  const [requestId, request] = Object.entries(result.state.approvalRequests)[0];
  assert.equal(request.requestId, requestId);
  assert.equal(request.source, "git_commit_push");
  assert.equal(request.repoAlias, "app");
  assert.equal(request.cwd, "/repo");
  assert.equal(request.branch, "main");
  assert.deepEqual(request.fileList, ["README.md", "src/new.js"]);
  assert.equal(request.commitMessage, "Publish changes");
  assert.equal(result.approvalNotification.replyMarkup.inline_keyboard[0].length, 2);
  assert.deepEqual(calls.map((call) => call.args), [
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["status", "--short", "--untracked-files=all"],
    ["diff", "--cached", "--name-status"],
  ]);
});

test("git commit push requires approval requests to match the whitelisted repository", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-git-push-"));
  try {
    const preview = handleGitCommitPush(
      "Publish changes",
      { currentRepo: "app", cwd: "/not-whitelisted" },
      "123",
      gitRunner({}),
      new Date("2026-05-27T00:00:00.000Z"),
      { app: repoDir },
    );
    assert.equal(
      preview.response,
      "Selected workspace no longer matches the repository whitelist. Use /use <repo> again.",
    );

    const request = {
      requestId: "gcp_test",
      status: "approved",
      source: "git_commit_push",
      chatId: "123",
      repoAlias: "app",
      cwd: "/not-whitelisted",
      branch: "main",
      fileList: ["README.md"],
      commitMessage: "Publish changes",
    };
    const resolved = resolveGitCommitPushApproval({
      request,
      state: { approvalRequests: { gcp_test: request } },
      selectedOption: { decision: "approved" },
      runner() {
        throw new Error("should not run git");
      },
      repos: { app: repoDir },
    });
    assert.equal(resolved.handled, true);
    assert.equal(
      resolved.response,
      "Selected workspace no longer matches the repository whitelist. Use /use <repo> again.",
    );
    assert.equal(resolved.state.approvalRequests.gcp_test.gitCommitPushResult.phase, "validation");
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("parseStatusShort rejects unsafe paths and keeps explicit safe paths", () => {
  assert.deepEqual(parseStatusShort("R  old.js -> new.js\n D dir/file.txt\n", "/repo"), {
    ok: true,
    paths: ["new.js", "dir/file.txt"],
  });
  assert.equal(parseStatusShort("?? ../secret\n", "/repo").ok, false);
  assert.equal(parseStatusShort("?? /tmp/secret\n", "/repo").ok, false);
  assert.equal(parseStatusShort("?? \"quoted name\"\n", "/repo").ok, false);
  assert.equal(parseStatusShort("?? src/\n", "/repo").ok, false);
});

test("resolveGitCommitPushApproval runs fixed git argv and separates commit and push failures", () => {
  const baseRequest = {
    requestId: "gcp_test",
    status: "approved",
    source: "git_commit_push",
    chatId: "123",
    repoAlias: "app",
    cwd: "/repo",
    branch: "main",
    fileList: ["README.md", "src/new.js"],
    commitMessage: "Publish changes",
  };
  const baseState = { approvalRequests: { gcp_test: baseRequest } };

  const calls = [];
  const success = resolveGitCommitPushApproval({
    request: baseRequest,
    state: baseState,
    selectedOption: { decision: "approved" },
    runner: gitRunner({
      "git rev-parse --abbrev-ref HEAD": { ok: true, stdout: "main\n" },
      "git add -- README.md src/new.js": { ok: true },
      "git commit -m Publish changes": { ok: true, stdout: "[main abc123] Publish changes\n" },
      "git push origin main": { ok: true, stderr: "To github.com:owner/repo.git\n" },
    }, calls),
  });
  assert.equal(success.handled, true);
  assert.match(success.response, /Git commit and push succeeded/);
  assert.deepEqual(calls.map((call) => call.args), [
    ["rev-parse", "--abbrev-ref", "HEAD"],
    ["add", "--", "README.md", "src/new.js"],
    ["commit", "-m", "Publish changes"],
    ["push", "origin", "main"],
  ]);
  assert.equal(success.state.approvalRequests.gcp_test.gitCommitPushResult.ok, true);

  const changedBranchCalls = [];
  const changedBranch = resolveGitCommitPushApproval({
    request: baseRequest,
    state: baseState,
    selectedOption: { decision: "approved" },
    runner: gitRunner({
      "git rev-parse --abbrev-ref HEAD": { ok: true, stdout: "release\n" },
    }, changedBranchCalls),
  });
  assert.equal(changedBranch.response, "Git branch changed from main to release. Repository was not changed.");
  assert.equal(changedBranchCalls.some((call) => call.args[0] === "add"), false);
  assert.equal(changedBranch.state.approvalRequests.gcp_test.gitCommitPushResult.phase, "branch");

  const commitFailCalls = [];
  const commitFail = resolveGitCommitPushApproval({
    request: baseRequest,
    state: baseState,
    selectedOption: { decision: "approved" },
    runner: gitRunner({
      "git rev-parse --abbrev-ref HEAD": { ok: true, stdout: "main\n" },
      "git add -- README.md src/new.js": { ok: true },
      "git commit -m Publish changes": { ok: false, stderr: "nothing to commit\n" },
    }, commitFailCalls),
  });
  assert.match(commitFail.response, /Git commit failed\. Push was not run\./);
  assert.equal(commitFailCalls.some((call) => call.args[0] === "push"), false);

  const pushFail = resolveGitCommitPushApproval({
    request: baseRequest,
    state: baseState,
    selectedOption: { decision: "approved" },
    runner: gitRunner({
      "git rev-parse --abbrev-ref HEAD": { ok: true, stdout: "main\n" },
      "git add -- README.md src/new.js": { ok: true },
      "git commit -m Publish changes": { ok: true, stdout: "[main abc123] Publish changes\n" },
      "git push origin main": { ok: false, stderr: "fatal: could not resolve host: github.com\n" },
    }),
  });
  assert.match(pushFail.response, /Git push failed \(network\/DNS\)/);

  const rejected = resolveGitCommitPushApproval({
    request: baseRequest,
    state: baseState,
    selectedOption: { decision: "rejected" },
    runner() {
      throw new Error("should not run git");
    },
  });
  assert.equal(rejected.response, "Git commit/push rejected; repository was not changed.");
});

test("classifyPushFailure recognizes network and authentication failures", () => {
  assert.equal(classifyPushFailure("fatal: could not resolve host: github.com"), "network/DNS");
  assert.equal(classifyPushFailure("Permission denied (publickey)."), "authentication/permission");
  assert.equal(classifyPushFailure("remote rejected"), null);
});

function gitRunner(results, calls = []) {
  return (cwd, command, args) => {
    calls.push({ cwd, command, args });
    const key = `${command} ${args.join(" ")}`;
    return {
      ok: true,
      command,
      args,
      status: 0,
      stdout: "",
      stderr: "",
      error: "",
      ...(results[key] ?? {}),
    };
  };
}
