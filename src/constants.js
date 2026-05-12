export const COMMANDS = Object.freeze([
  "/repos",
  "/use",
  "/pwd",
  "/ls",
  "/git",
  "/ask",
  "/work",
  "/continue",
  "/run-orch",
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
  "/run-orch": "Usage: /run-orch <rounds>",
  "/logs": "Usage: /logs <task_id>",
  "/stop": "Usage: /stop <task_id>",
});

export const NO_WORKSPACE_RESPONSE = "No workspace selected.\nUse /repos then /use <repo>.";
export const UNAUTHORIZED_RESPONSE = "Unauthorized chat.";
export const UNKNOWN_COMMAND_RESPONSE = "Unknown command.\nUse /help.";

export const DEFAULT_STATE = Object.freeze({
  currentRepo: null,
  cwd: null,
  tasks: {},
});
