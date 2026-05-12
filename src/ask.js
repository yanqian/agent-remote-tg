import { requireWorkspace } from "./workspace.js";

export const ASK_TIMEOUT_MS = 10 * 60 * 1000;

export function buildAskPrompt(question) {
  return [
    "Act as a read-only Codex discussion agent for the selected repository.",
    "",
    "Rules:",
    "- Discuss and analyze only.",
    "- Do not modify files.",
    "- Do not update SPEC.md.",
    "- Do not update feature_list.json.",
    "- Do not run orchestrator.py.",
    "- Do not commit.",
    "",
    "Question:",
    question,
  ].join("\n");
}

export function handleAsk(args, state, taskExecutor) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }
  if (!taskExecutor || typeof taskExecutor.startTask !== "function") {
    throw new Error("taskExecutor.startTask is required.");
  }

  const started = taskExecutor.startTask({
    type: "ask",
    cwd: workspace.cwd,
    command: "codex",
    args: ["exec", buildAskPrompt(args)],
    timeoutMs: ASK_TIMEOUT_MS,
  });

  return { response: started.response, stateChanged: false };
}
