import { statSync } from "node:fs";
import { join } from "node:path";
import { requireWorkspace } from "./workspace.js";

export const WORKFLOW_REQUIRED_FILES = Object.freeze([
  "AGENTS.md",
  "SPEC.md",
  "feature_list.json",
  "progress.md",
  "init.sh",
  "orchestrator.py",
]);

export function checkWorkflowReadiness(cwd) {
  if (!cwd || typeof cwd !== "string") {
    throw new Error("cwd is required.");
  }

  const missing = WORKFLOW_REQUIRED_FILES.filter((fileName) => !isFile(join(cwd, fileName)));
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      response: `Workspace is not agent-workflow ready.\nMissing required files:\n${missing.map((fileName) => `- ${fileName}`).join("\n")}`,
    };
  }

  return { ok: true, missing: [], response: "" };
}

export function requireWorkflowReadyWorkspace(state) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return workspace;
  }

  const readiness = checkWorkflowReadiness(workspace.cwd);
  if (!readiness.ok) {
    return readiness;
  }

  return { ok: true, cwd: workspace.cwd, currentRepo: workspace.currentRepo };
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
