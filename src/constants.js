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
  "/approve",
  "/reject",
  "/always_allow",
  "/status",
  "/logs",
  "/stop",
  "/help",
]);

export const COMMANDS_REQUIRING_ARGS = Object.freeze({
  "/use": "Usage: /use <repo>",
  "/ask": "Usage: /ask <question> | /ask new <message> | /ask resume <session_id|--last> <message> | /ask exit | /ask session | /ask -- <message>",
  "/work": "Usage: /work <requirement>",
  "/continue": "Usage: /continue <instruction>",
  "/run_orch": "Usage: /run_orch <rounds>",
  "/approve": "Usage: /approve <request_id>",
  "/reject": "Usage: /reject <request_id>",
  "/always_allow": "Usage: /always_allow <request_id>",
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
  "/ask <question> - start or continue a read-only Codex discussion task",
  "/ask new <message> - force a new ask session",
  "/ask resume <session_id|--last> <message> - resume an ask session",
  "/ask exit - clear the selected ask session",
  "/ask session - show the selected ask session",
  "/ask -- <message> - ask a literal message beginning with a reserved word",
  "/work <requirement> - delegate a repository workflow task",
  "/continue <instruction> - resume or recover repository workflow",
  "/run_orch <rounds> - run 1 to 5 orchestrator rounds",
  "/approve <request_id> - approve a pending agent request",
  "/reject <request_id> - reject a pending agent request",
  "/always_allow <request_id> - approve and remember a future allow rule",
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
  approvalRequests: {},
  approvalAllowRules: {},
  telegramUpdateOffset: null,
});
