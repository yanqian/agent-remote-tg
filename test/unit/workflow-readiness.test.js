import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORKFLOW_REQUIRED_FILES,
  checkWorkflowReadiness,
  requireWorkflowReadyWorkspace,
} from "../../src/workflow-readiness.js";
import { NO_WORKSPACE_RESPONSE } from "../../src/constants.js";

test("checkWorkflowReadiness reports missing root files", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-ready-"));
  try {
    writeFileSync(join(rootDir, "AGENTS.md"), "");
    writeFileSync(join(rootDir, "SPEC.md"), "");

    const result = checkWorkflowReadiness(rootDir);

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["feature_list.json", "progress.md", "init.sh", "orchestrator.py"]);
    assert.equal(
      result.response,
      "Workspace is not agent-workflow ready.\nMissing required files:\n- feature_list.json\n- progress.md\n- init.sh\n- orchestrator.py",
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("checkWorkflowReadiness requires files, not directories", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-ready-"));
  try {
    for (const fileName of WORKFLOW_REQUIRED_FILES) {
      if (fileName === "init.sh") {
        mkdirSync(join(rootDir, fileName));
      } else {
        writeFileSync(join(rootDir, fileName), "");
      }
    }

    const result = checkWorkflowReadiness(rootDir);

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ["init.sh"]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("requireWorkflowReadyWorkspace rejects no selected workspace", () => {
  assert.deepEqual(requireWorkflowReadyWorkspace({ currentRepo: null, cwd: null, tasks: {} }), {
    ok: false,
    response: NO_WORKSPACE_RESPONSE,
  });
});

test("requireWorkflowReadyWorkspace accepts complete agent workflow roots", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-ready-"));
  try {
    for (const fileName of WORKFLOW_REQUIRED_FILES) {
      writeFileSync(join(rootDir, fileName), "");
    }

    assert.deepEqual(requireWorkflowReadyWorkspace({ currentRepo: "app", cwd: rootDir, tasks: {} }), {
      ok: true,
      cwd: rootDir,
      currentRepo: "app",
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
