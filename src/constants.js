export const COMMANDS = Object.freeze([
  "/repos",
  "/use",
  "/pwd",
  "/ls",
  "/git",
  "/git_commit_push",
  "/agent",
  "/approve",
  "/reject",
  "/always_allow",
  "/always_reject",
  "/approval_test",
  "/status",
  "/logs",
  "/stop",
  "/help",
]);

export const COMMANDS_REQUIRING_ARGS = Object.freeze({
  "/use": "Usage: /use <repo>",
  "/agent": "Usage: /agent <instruction> | /agent new <instruction> | /agent resume <session_id|--last> <instruction> | /agent exit | /agent session | /agent -- <instruction>",
  "/git_commit_push": "Usage: /git_commit_push <message>",
  "/approve": "Usage: /approve <request_id>",
  "/reject": "Usage: /reject <request_id>",
  "/always_allow": "Usage: /always_allow <request_id>",
  "/always_reject": "Usage: /always_reject <request_id>",
  "/logs": "Usage: /logs <task_id>",
  "/stop": "Usage: /stop <task_id>",
});

export const NO_WORKSPACE_RESPONSE = "No workspace selected.\nUse /repos then /use <repo>.";
export const UNAUTHORIZED_RESPONSE = "Unauthorized chat.";
export const UNKNOWN_COMMAND_RESPONSE = "Unknown command.\nUse /help.";
export const GIT_USAGE_RESPONSE = "Usage: /git [commit_push <message>]";
export const GIT_COMMIT_PUSH_USAGE_RESPONSE = "Usage: /git commit_push <message>";
export const LEGACY_GIT_COMMIT_PUSH_USAGE_RESPONSE = "Usage: /git_commit_push <message>";

export const HELP_RESPONSE = [
  "Available commands:",
  "/repos - list configured repositories",
  "/use <repo> - select a repository",
  "/pwd - show the selected workspace",
  "/ls - list files in the selected workspace",
  "/git - show branch, status, and recent commits",
  "/git commit_push <message> - commit and push selected workspace changes after approval",
  "/git_commit_push <message> - compatibility alias for /git commit_push",
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
