import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handlePwd, handleRepos, handleUse, requireWorkspace } from "../../src/workspace.js";
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
