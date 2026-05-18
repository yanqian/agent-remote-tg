export const COMMANDS = Object.freeze([
  "/repos",
  "/use",
  "/pwd",
  "/ls",
  "/git",
  "/agent",
  "/approve",
  "/reject",
  "/always_allow",
  "/always_reject",
  "/approval_test",
  "/camera_clip",
  "/status",
  "/logs",
  "/stop",
  "/help",
]);

export const COMMANDS_REQUIRING_ARGS = Object.freeze({
  "/use": "Usage: /use <repo>",
  "/agent": "Usage: /agent <instruction> | /agent new <instruction> | /agent resume <session_id|--last> <instruction> | /agent exit | /agent session | /agent -- <instruction>",
  "/approve": "Usage: /approve <request_id>",
  "/reject": "Usage: /reject <request_id>",
  "/always_allow": "Usage: /always_allow <request_id>",
  "/always_reject": "Usage: /always_reject <request_id>",
  "/camera_clip": "Usage: /camera_clip <seconds>",
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
  "/agent <instruction> - start or continue a Codex agent task",
  "/agent new <instruction> - force a new agent session",
  "/agent resume <session_id|--last> <instruction> - resume an agent session",
  "/agent exit - leave agent chat mode",
  "/agent session - show the selected agent session",
  "/agent -- <instruction> - send a literal instruction beginning with a reserved word",
  "/approve <request_id> - approve a pending agent request",
  "/reject <request_id> - reject a pending agent request",
  "/always_allow <request_id> - approve and remember a future allow rule",
  "/always_reject <request_id> - reject and remember a future reject rule",
  "/approval_test - create a safe Bot-local approval request",
  "/camera_clip <seconds> - capture and send a short local camera clip",
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
  agentChatModes: {},
  approvalRequests: {},
  approvalAllowRules: {},
  telegramUpdateOffset: null,
});
