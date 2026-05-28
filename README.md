# Remote Agent Telegram Control Plane

## What This Project Does

This project is a local Telegram Bot control plane for long-running agent workflows in whitelisted repositories. It validates authorized Telegram chats, selects a configured local workspace, starts bounded local Codex agent tasks, persists runtime task metadata, and writes full task output to logs.

Repository development state remains in repository files and git history. Telegram messages, selected workspace state, Bot task records, and task logs are runtime artifacts only.

## Command Surface

- `/repos` - list configured repositories.
- `/use <repo>` - select a repository by exact configured alias.
- `/pwd` - show the selected workspace path.
- `/ls` - list files in the selected workspace.
- `/git` - show the current branch, short status, and five recent commits.
- `/git_commit_push <message>` - preview, approve, commit, and push selected workspace changes with fixed Bot-local git commands.
- `/agent <instruction>` - start or continue a Codex agent task in the selected workspace.
- `/agent new <instruction>` - force a new agent session for the selected workspace.
- `/agent resume <session_id|--last> <instruction>` - resume a specific agent session or Codex CLI's most recent session for the runtime user account.
- `/agent exit` - leave agent chat mode for the current chat and repository.
- `/agent session` - show the selected agent session and agent chat mode status for the current chat and repository.
- `/agent -- <instruction>` - send a literal instruction beginning with a reserved agent subcommand word.
- `/approve <request_id>` - approve a pending agent approval request.
- `/reject <request_id>` - reject a pending agent approval request.
- `/always_allow <request_id>` - approve a pending agent approval request and remember its future allow rule.
- `/always_reject <request_id>` - reject a pending agent approval request and remember its future reject rule.
- `/approval_test` - create a safe Bot-local approval request for testing approval commands, replies, and buttons.
- `/status` - show active tasks and the five most recent finished tasks.
- `/logs <task_id>` - show the stored final task result.
- `/stop <task_id>` - stop a running Bot-recorded task with `SIGTERM`.
- `/help` - show the command list.

## BotFather Command Menu

Use BotFather `/setcommands` with this command menu:

```text
repos - List configured repositories
use - Select a repository by alias
pwd - Show the selected workspace
ls - List selected workspace files
git - Show branch, status, and commits
git_commit_push - Commit and push after approval
agent - Manage Codex agent sessions
approve - Approve a pending agent request
reject - Reject a pending agent request
always_allow - Approve and remember an allow rule
always_reject - Reject and remember a reject rule
approval_test - Create a safe approval test request
status - Show active and recent tasks
logs - Show task final result
stop - Stop a running task
help - Show the command list
```

BotFather command names must use lowercase letters, digits, and underscores. The supported Bot command names are compatible with the BotFather command menu.

## Repository Workflow Model

The Bot is a control plane, not the owner of feature lifecycle decisions. It validates commands, validates the selected workspace, starts local processes with shell execution disabled, records task metadata, and returns bounded Telegram responses.

Target repositories are expected to keep durable agent state in files such as `AGENTS.md`, `SPEC.md`, `feature_list.json`, `progress.md`, `test_plan.md`, `init.sh`, and `orchestrator.py` when repository workflow automation is requested through `/agent`.

`/agent` starts `codex exec --json` tasks for general repository work and session-aware follow-ups. `/agent`, `/agent new`, and `/agent resume ...` enter agent chat mode for the current chat and selected repository. After a Codex session is bound, authorized ordinary text in that chat and repository continues the current session without the `/agent` prefix. Slash commands are still parsed as commands first. Use `/agent exit` to leave agent chat mode, `/agent session` to inspect the current session and mode status, and `/stop <task_id>` when a running task should be terminated. Bot-started Codex agents may inspect Git state with read-only commands such as `git status`, `git diff`, and `git log`, edit ordinary workspace files, and run tests. They are prompted not to attempt Git staging, reset, commit, update-index writes, or push from inside the Codex sandbox because local probes show ordinary workspace writes can succeed while `.git` metadata writes such as `.git/index.lock` can fail. Agent final responses should summarize changed files, verification, remaining issues, and a suggested commit message. When Bot-started Codex tasks emit permission prompts, the Bot stores a pending approval request and sends inline Telegram buttons that map to the Codex-provided options. `/git_commit_push <message>` is also Bot-local: it previews the selected repository branch, `git status --short`, staged files, and explicit paths to stage, then waits for `/approve` or inline approval before running fixed `git add -- <paths>`, `git commit -m <message>`, and `git push origin <branch>` argv without a shell. `/approval_test` creates a Bot-local pending request with approve, reject, always-allow, and always-reject options without starting Codex, running shell commands, requiring a workspace, or using child stdin. Only one active agent task is allowed per workspace for ordinary follow-up text; `work`, `continue`, and `run-orch` may appear only as legacy task records.

## Transport Modes

Webhook mode runs an HTTP server for public HTTPS deployments on a VPS, VM, container, Cloud Run service, or hosted Node.js runtime. The deployed runtime must expose a public HTTPS URL for Telegram, keep the whitelisted repository paths available inside that runtime, and provide persistent writable storage for `runtime_state.json` and `logs/`.

Start webhook mode with:

```bash
npm start
```

The `npm start` script runs `node src/index.js`.

Register the public webhook URL with Telegram by setting `TELEGRAM_WEBHOOK_URL` to the deployed HTTPS URL ending in `/telegram/webhook`, then running:

```bash
npm run webhook:set
```

Polling mode runs on a local machine without a public inbound address. The required command is:

```bash
npm run start:polling
```

The `start:polling` script must run `node src/polling.js`.

Both modes must dispatch Telegram messages into the same `createApp().handleMessage(...)` application path and must send Bot text replies through Telegram `sendMessage`.

## Runtime State And Logs

Runtime state is stored in `runtime_state.json`. It contains the selected repository alias, selected workspace path, Bot-started task metadata, legacy-compatible ask-session bindings used by `/agent`, agent chat mode flags, pending approval requests, remembered approval allow rules, and Telegram polling update offset. It must not contain target repository feature objects.

Task logs are stored under `logs/` as `logs/<task_id>.log`. Logs include command argv, timestamps, stdout, stderr, and exit code. Telegram responses are bounded, while full process output remains in the task log.

Runtime artifacts are local to this control-plane process and survive process restart. Target repository source of truth remains in the target repository files and git history.

For webhook deployments, repository paths in `REPO_WHITELIST_JSON` must be runtime-local paths that exist in the VPS, VM, container, Cloud Run service, or hosted Node.js runtime. Persist or mount `runtime_state.json` and `logs/` so selected workspace state, task records, polling offsets, and task logs survive process restarts and redeploys.

## Local Setup

Use Node.js 20 or newer.

Set the required environment variables:

- `TELEGRAM_BOT_TOKEN` - Telegram Bot token used by the local Bot process.
- `ALLOWED_CHAT_IDS` - comma-separated Telegram chat IDs allowed to use the Bot.
- `REPO_WHITELIST_JSON` - JSON object mapping repository aliases to local repository paths.
- `AGENT_TASK_TIMEOUT_MS` - optional positive integer millisecond timeout for `/agent` task processes. When unset or empty, `/agent` tasks have no forced timeout.

Configure the repository whitelist through the required `REPO_WHITELIST_JSON` value. Repository aliases must be exact keys using only letters, numbers, dots, underscores, and hyphens, and each configured path must resolve to an existing local directory. Startup fails when the JSON is missing or invalid, an alias is unsafe, or a path is missing.

`AGENT_TASK_TIMEOUT_MS` applies to `/agent`, `/agent new`, `/agent resume <session_id> <instruction>`, `/agent resume --last <instruction>`, and ordinary text follow-ups in agent chat mode. Startup rejects non-integer, zero, and negative values. `/stop <task_id>` is the user-controlled termination mechanism.

Home-watch camera functionality is no longer part of this control plane. It moved to `/Users/armstrong/Project/home-watch-tg`.

Example:

```bash
export REPO_WHITELIST_JSON='{"agent-remote-tg":"/Users/armstrong/Project/agent-remote-tg"}'
```

Install dependencies if the project gains external dependencies later:

```bash
npm install
```

Run webhook mode with the required environment available:

```bash
npm start
```

The `npm start` script must run `node src/index.js`.

Run local polling mode with the required environment available:

```bash
npm run start:polling
```

The `start:polling` script must run `node src/polling.js`.

## Verification

Run the full local verification script:

```bash
./init.sh
```

The script checks required project files, validates `feature_list.json`, verifies unique feature IDs, runs the build check, executes unit tests, harness tests, contract tests, and the smoke script when those commands exist.

## Current Limitations

- Only configured local repositories can be selected.
- Arbitrary shell command execution is not supported.
- Free-form absolute path workspace selection is not supported.
- Ordinary text starts an agent follow-up only after agent chat mode is enabled and a session is bound for the current chat and repository.
- Multiple active agent tasks in the same workspace are rejected for ordinary text follow-ups.
- Home-watch camera functionality is handled by `/Users/armstrong/Project/home-watch-tg`, not this repository.
