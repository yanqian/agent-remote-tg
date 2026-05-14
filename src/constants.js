export const COMMANDS = Object.freeze([
  "/repos",
  "/use",
  "/pwd",
  "/ls",
  "/git",
  "/ask",
  "/work",
  "/continue",
  "/run_orch",
  "/status",
  "/logs",
  "/stop",
  "/help",
]);

export const COMMANDS_REQUIRING_ARGS = Object.freeze({
  "/use": "Usage: /use <repo>",
  "/ask": "Usage: /ask <question>",
  "/work": "Usage: /work <requirement>",
  "/continue": "Usage: /continue <instruction>",
  "/run_orch": "Usage: /run_orch <rounds>",
  "/logs": "Usage: /logs <task_id>",
  "/stop": "Usage: /stop <task_id>",
});

export const NO_WORKSPACE_RESPONSE = "No workspace selected.\nUse /repos then /use <repo>.";
export const UNAUTHORIZED_RESPONSE = "Unauthorized chat.";
export const UNKNOWN_COMMAND_RESPONSE = "Unknown command.\nUse /help.";

export const HELP_RESPONSE = [
  "Available commands:",
  "/repos - list configured repositories",
  "/use <repo> - select a repository",
  "/pwd - show the selected workspace",
  "/ls - list files in the selected workspace",
  "/git - show branch, status, and recent commits",
  "/ask <question> - start a read-only Codex discussion task",
  "/work <requirement> - delegate a repository workflow task",
  "/continue <instruction> - resume or recover repository workflow",
  "/run_orch <rounds> - run 1 to 5 orchestrator rounds",
  "/status - show active and recent tasks",
  "/logs <task_id> - show the task final result",
  "/stop <task_id> - stop a running Bot-recorded task",
  "/help - show this command list",
].join("\n");

export const DEFAULT_STATE = Object.freeze({
  currentRepo: null,
  cwd: null,
  tasks: {},
  askSessions: {},
  telegramUpdateOffset: null,
});
