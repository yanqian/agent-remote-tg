import { requireWorkflowReadyWorkspace } from "./workflow-readiness.js";

export const WORKFLOW_TASK_TYPES = Object.freeze(["work", "continue", "run-orch"]);
export const ACTIVE_TASK_STATUSES = Object.freeze(["running", "stopping"]);

export function buildWorkPrompt(requirement) {
  return [
    "Act as a long-running Codex workflow delegation agent for the selected repository.",
    "",
    "Requirement:",
    requirement,
    "",
    "Required workflow:",
    "1. Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20.",
    "2. Run ./init.sh before changing files.",
    "3. Determine whether the request is a new requirement or a bug fix.",
    "4. Update SPEC.md through the repository planning workflow.",
    "5. Append new feature entries to feature_list.json when new work is required.",
    "6. Preserve all existing feature IDs, ordering, passes, status, attempts, last_error, and unknown fields.",
    "7. Validate feature_list.json as JSON.",
    "8. Create a planning commit when planning files changed.",
    "9. Run python3 orchestrator.py --max-rounds 1.",
    "10. Treat the task as complete only when the orchestrator and evaluator workflow pass.",
    "11. Summarize changed files, feature IDs, commands run, final status, and remaining issues.",
    "",
    "Bot boundary:",
    "- The Telegram Bot only delegated this task.",
    "- Do not rely on chat history.",
    "- Use repository files as the source of truth.",
  ].join("\n");
}

export function findActiveWorkflowTask(state, cwd) {
  const tasks = state && state.tasks && typeof state.tasks === "object" ? state.tasks : {};
  for (const task of Object.values(tasks)) {
    if (
      task
      && task.cwd === cwd
      && WORKFLOW_TASK_TYPES.includes(task.type)
      && ACTIVE_TASK_STATUSES.includes(task.status)
    ) {
      return task;
    }
  }
  return null;
}

export function handleWork(args, state, taskExecutor) {
  const readiness = requireWorkflowReadyWorkspace(state);
  if (!readiness.ok) {
    return { response: readiness.response, stateChanged: false };
  }
  if (!taskExecutor || typeof taskExecutor.startTask !== "function") {
    throw new Error("taskExecutor.startTask is required.");
  }

  const activeTask = findActiveWorkflowTask(state, readiness.cwd);
  if (activeTask) {
    return {
      response: `Active workflow task already running in this workspace: ${activeTask.taskId}\nUse /status or /logs ${activeTask.taskId}.`,
      stateChanged: false,
    };
  }

  const started = taskExecutor.startTask({
    type: "work",
    cwd: readiness.cwd,
    command: "codex",
    args: ["exec", buildWorkPrompt(args)],
    timeoutMs: null,
  });

  return { response: started.response, stateChanged: false };
}
