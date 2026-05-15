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
- `/agent <instruction>` - start or continue a Codex agent task in the selected workspace.
- `/agent new <instruction>` - force a new agent session for the selected workspace.
- `/agent resume <session_id|--last> <instruction>` - resume a specific agent session or Codex CLI's most recent session for the runtime user account.
- `/agent exit` - clear the selected agent session for the current chat and repository.
- `/agent session` - show the selected agent session for the current chat and repository.
- `/agent -- <instruction>` - send a literal instruction beginning with a reserved agent subcommand word.
- `/continue <instruction>` - resume or recover repository workflow from repository state.
- `/approve <request_id>` - approve a pending agent approval request.
- `/reject <request_id>` - reject a pending agent approval request.
- `/always_allow <request_id>` - approve a pending agent approval request and remember its future allow rule.
- `/always_reject <request_id>` - reject a pending agent approval request and remember its future reject rule.
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
agent - Manage Codex agent sessions
continue - Resume repository workflow
approve - Approve a pending agent request
reject - Reject a pending agent request
always_allow - Approve and remember an allow rule
always_reject - Reject and remember a reject rule
status - Show active and recent tasks
logs - Show task final result
stop - Stop a running task
help - Show the command list
```

BotFather command names must use lowercase letters, digits, and underscores. The supported Bot command names are compatible with the BotFather command menu.

## Repository Workflow Model

The Bot is a control plane, not the owner of feature lifecycle decisions. It validates commands, validates the selected workspace, starts local processes with shell execution disabled, records task metadata, and returns bounded Telegram responses.

Target repositories are expected to keep durable agent state in files such as `AGENTS.md`, `SPEC.md`, `feature_list.json`, `progress.md`, `test_plan.md`, `init.sh`, and `orchestrator.py`. `/continue` requires the selected workspace to contain the required agent workflow files before any process is spawned.

`/agent` starts `codex exec --json` tasks for general repository work and session-aware follow-ups. `/continue` starts a `codex exec` recovery task that forces the spawned agent to reconstruct context from repository files. When Bot-started Codex tasks emit permission prompts, the Bot stores a pending approval request and sends inline Telegram buttons that map to the Codex-provided options. Only one active workflow task of type `work`, `continue`, or `run-orch` is allowed per workspace; `work` and `run-orch` may appear only as legacy task records.

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

Both modes must dispatch Telegram messages into the same `createApp().handleMessage(...)` application path and must send Bot replies through Telegram `sendMessage`.

## Runtime State And Logs

Runtime state is stored in `runtime_state.json`. It contains the selected repository alias, selected workspace path, Bot-started task metadata, legacy-compatible ask-session bindings used by `/agent`, pending approval requests, remembered approval allow rules, and Telegram polling update offset. It must not contain target repository feature objects.

Task logs are stored under `logs/` as `logs/<task_id>.log`. Logs include command argv, timestamps, stdout, stderr, and exit code. Telegram responses are bounded, while full process output remains in the task log.

Runtime artifacts are local to this control-plane process and survive process restart. Target repository source of truth remains in the target repository files and git history.

For webhook deployments, repository paths in `REPO_WHITELIST_JSON` must be runtime-local paths that exist in the VPS, VM, container, Cloud Run service, or hosted Node.js runtime. Persist or mount `runtime_state.json` and `logs/` so selected workspace state, task records, polling offsets, and task logs survive process restarts and redeploys.

## Local Setup

Use Node.js 20 or newer.

Set the required environment variables:

- `TELEGRAM_BOT_TOKEN` - Telegram Bot token used by the local Bot process.
- `ALLOWED_CHAT_IDS` - comma-separated Telegram chat IDs allowed to use the Bot.
- `REPO_WHITELIST_JSON` - JSON object mapping repository aliases to local repository paths.

Configure the repository whitelist through the required `REPO_WHITELIST_JSON` value. Repository aliases must be exact keys using only letters, numbers, dots, underscores, and hyphens, and each configured path must resolve to an existing local directory. Startup fails when the JSON is missing or invalid, an alias is unsafe, or a path is missing.

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
- `/continue` requires agent workflow files in the selected repository root.
- Multiple active workflow tasks in the same workspace are rejected.
