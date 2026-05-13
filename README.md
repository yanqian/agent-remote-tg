# Remote Agent Telegram Control Plane

## What This Project Does

This project is a local Telegram Bot control plane for long-running agent workflows in whitelisted repositories. It validates authorized Telegram chats, selects a configured local workspace, starts bounded local Codex or orchestrator tasks, persists runtime task metadata, and writes full task output to logs.

Repository development state remains in repository files and git history. Telegram messages, selected workspace state, Bot task records, and task logs are runtime artifacts only.

## Command Surface

- `/repos` - list configured repositories.
- `/use <repo>` - select a repository by exact configured alias.
- `/pwd` - show the selected workspace path.
- `/ls` - list files in the selected workspace.
- `/git` - show the current branch, short status, and five recent commits.
- `/ask <question>` - start a read-only Codex discussion task in the selected workspace.
- `/work <requirement>` - delegate a repository workflow task to Codex.
- `/continue <instruction>` - resume or recover repository workflow from repository state.
- `/run-orch <rounds>` - run 1 to 5 orchestrator rounds in the selected workspace.
- `/status` - show active tasks and the five most recent finished tasks.
- `/logs <task_id>` - show the last 120 task log lines.
- `/stop <task_id>` - stop a running Bot-recorded task with `SIGTERM`.
- `/help` - show the command list.

## Repository Workflow Model

The Bot is a control plane, not the owner of feature lifecycle decisions. It validates commands, validates the selected workspace, starts local processes with shell execution disabled, records task metadata, and returns bounded Telegram responses.

Target repositories are expected to keep durable agent state in files such as `AGENTS.md`, `SPEC.md`, `feature_list.json`, `progress.md`, `test_plan.md`, `init.sh`, and `orchestrator.py`. The workflow commands `/work`, `/continue`, and `/run-orch` require the selected workspace to contain the required agent workflow files before any process is spawned.

`/work` and `/continue` start `codex exec` tasks with prompts that force the spawned agent to reconstruct context from repository files. `/run-orch` starts `python3 orchestrator.py --max-rounds <rounds>`. Only one active workflow task of type `work`, `continue`, or `run-orch` is allowed per workspace.

## Transport Modes

Webhook mode runs an HTTP server for public HTTPS deployments. Start it with:

```bash
npm start
```

The `npm start` script runs `node src/index.js`.

Polling mode runs on a local machine without a public inbound address. The required command is:

```bash
npm run start:polling
```

The `start:polling` script must run `node src/polling.js`.

Both modes must dispatch Telegram messages into the same `createApp().handleMessage(...)` application path and must send Bot replies through Telegram `sendMessage`.

## Runtime State And Logs

Runtime state is stored in `runtime_state.json`. It contains the selected repository alias, selected workspace path, Bot-started task metadata, and Telegram polling update offset. It must not contain target repository feature objects.

Task logs are stored under `logs/` as `logs/<task_id>.log`. Logs include command argv, timestamps, stdout, stderr, and exit code. Telegram responses are bounded, while full process output remains in the task log.

Runtime artifacts are local to this control-plane process and survive process restart. Target repository source of truth remains in the target repository files and git history.

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
- Workflow commands require agent workflow files in the selected repository root.
- Multiple active workflow tasks in the same workspace are rejected.
