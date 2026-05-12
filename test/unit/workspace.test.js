import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleGit, handleLs, handlePwd, handleRepos, handleUse, requireWorkspace } from "../../src/workspace.js";
import { NO_WORKSPACE_RESPONSE } from "../../src/constants.js";

test("requireWorkspace rejects empty workspace state", () => {
  assert.deepEqual(requireWorkspace({ currentRepo: null, cwd: null }), {
    ok: false,
    response: NO_WORKSPACE_RESPONSE,
  });
});

test("handleRepos lists repositories", () => {
  assert.deepEqual(handleRepos({ app: "/tmp/app" }), {
    response: "Available repos:\n- app -> /tmp/app",
    stateChanged: false,
  });
});

test("handleUse persists selected workspace state", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-workspace-"));
  try {
    const result = handleUse("app", { app: rootDir }, { currentRepo: null, cwd: null, tasks: {} });
    assert.equal(result.stateChanged, true);
    assert.deepEqual(result.state, { currentRepo: "app", cwd: rootDir, tasks: {} });
    assert.equal(result.response, `Workspace switched:\napp\n${rootDir}`);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("handlePwd returns selected cwd", () => {
  assert.deepEqual(handlePwd({ currentRepo: "app", cwd: "/tmp/app", tasks: {} }), {
    response: "/tmp/app",
    stateChanged: false,
  });
});

test("handleLs runs ls -la in the selected workspace", () => {
  const calls = [];
  const result = handleLs({ currentRepo: "app", cwd: "/tmp/app", tasks: {} }, (cwd, command, args) => {
    calls.push({ cwd, command, args });
    return { ok: true, stdout: "total 0\n", stderr: "" };
  });

  assert.deepEqual(calls, [{ cwd: "/tmp/app", command: "ls", args: ["-la"] }]);
  assert.deepEqual(result, { response: "total 0\n", stateChanged: false });
});

test("handleLs rejects missing workspace", () => {
  assert.deepEqual(handleLs({ currentRepo: null, cwd: null, tasks: {} }), {
    response: NO_WORKSPACE_RESPONSE,
    stateChanged: false,
  });
});

test("handleGit runs branch, status, and five-commit log in the selected workspace", () => {
  const calls = [];
  const outputs = ["main\n", " M src/app.js\n", "abc1234 Complete feature\n"];
  const result = handleGit({ currentRepo: "app", cwd: "/tmp/app", tasks: {} }, (cwd, command, args) => {
    calls.push({ cwd, command, args });
    return { ok: true, stdout: outputs.shift(), stderr: "" };
  });

  assert.deepEqual(calls, [
    { cwd: "/tmp/app", command: "git", args: ["branch", "--show-current"] },
    { cwd: "/tmp/app", command: "git", args: ["status", "--short"] },
    { cwd: "/tmp/app", command: "git", args: ["log", "--oneline", "-5"] },
  ]);
  assert.deepEqual(result, {
    response: "Branch:\nmain\nStatus:\nM src/app.js\nRecent commits:\nabc1234 Complete feature",
    stateChanged: false,
  });
});

test("handleGit reports clean status and empty branch output", () => {
  const outputs = ["", "", ""];
  const result = handleGit({ currentRepo: "app", cwd: "/tmp/app", tasks: {} }, () => {
    return { ok: true, stdout: outputs.shift(), stderr: "" };
  });

  assert.deepEqual(result, {
    response: "Branch:\n(none)\nStatus:\nclean\nRecent commits:\n(none)",
    stateChanged: false,
  });
});
