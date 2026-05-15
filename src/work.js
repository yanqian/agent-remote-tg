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

export function buildContinuePrompt(instruction) {
  return [
    "Act as a Codex repository recovery agent for the selected repository.",
    "",
    "Instruction:",
    instruction,
    "",
    "Repository-state reconstruction rules:",
    "Do not rely on chat history.",
    "Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20 before deciding the next action.",
    "Run ./init.sh before changing files.",
    "Use orchestrator.py according to AGENTS.md when implementation or evaluation is required.",
    "Do not overwrite feature_list.json.",
    "Do not reset existing feature state.",
    "Stop and report exact conflicts when repository state is unsafe.",
    "",
    "Bot boundary:",
    "- The Telegram Bot only delegated this recovery task.",
    "- Use repository files and git history as the source of truth.",
    "- Preserve durable state owned by the target repository workflow.",
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

export function handleWork(args, state, taskExecutor, chatId = null) {
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
    chatId,
    repoAlias: readiness.currentRepo,
  });

  return { response: started.response, stateChanged: false };
}

export function handleContinue(args, state, taskExecutor, chatId = null) {
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
    type: "continue",
    cwd: readiness.cwd,
    command: "codex",
    args: ["exec", buildContinuePrompt(args)],
    timeoutMs: null,
    chatId,
    repoAlias: readiness.currentRepo,
  });

  return { response: started.response, stateChanged: false };
}

export function handleRunOrch(args, state, taskExecutor, chatId = null) {
  const rounds = parseOrchestratorRounds(args);
  if (!rounds.ok) {
    return { response: rounds.response, stateChanged: false };
  }

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
    type: "run-orch",
    cwd: readiness.cwd,
    command: "python3",
    args: ["orchestrator.py", "--max-rounds", String(rounds.value)],
    timeoutMs: null,
    chatId,
  });

  return { response: started.response, stateChanged: false };
}

export function parseOrchestratorRounds(args) {
  const text = String(args ?? "").trim();
  if (!/^[1-5]$/.test(text)) {
    return { ok: false, response: "Invalid rounds. Use an integer from 1 to 5." };
  }
  return { ok: true, value: Number(text) };
}
