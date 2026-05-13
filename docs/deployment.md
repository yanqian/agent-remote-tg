# Deployment

## Runtime Host Requirements

Run the service as a local process on a trusted host with access to the whitelisted repositories. The host must have Node.js 20 or newer, local access to the selected repository paths, and the `codex` and `python3` commands available when workflow commands are expected to run.

The trusted host model is intentional. This project is not cloud deployment automation, and it does not provide an isolation boundary for untrusted operators or untrusted repository paths.

## Environment Variables

Set these variables before starting the service:

- `TELEGRAM_BOT_TOKEN` - Telegram Bot token used by the local Bot process.
- `ALLOWED_CHAT_IDS` - comma-separated Telegram chat IDs allowed to use the Bot.
- `REPO_WHITELIST_JSON` - JSON object mapping repository aliases to local repository paths.
- `TELEGRAM_WEBHOOK_URL` - public HTTPS webhook URL registered with Telegram.
- `PORT` - HTTP port used by the service. When unset, the service uses `3000`.

`ALLOWED_CHAT_IDS` must be non-empty outside `NODE_ENV=test`. Keep the Bot token out of source control, runtime logs, and target repository state files.

Example repository whitelist:

```bash
export REPO_WHITELIST_JSON='{"agent-remote-tg":"/workspace/agent-remote-tg"}'
```

## Repository Whitelist

Configure only trusted local repositories in the required `REPO_WHITELIST_JSON` value. Each alias must be an exact key using only letters, numbers, dots, underscores, and hyphens, and each path must resolve to an existing local directory. Startup validates the JSON shape, aliases, and directory paths before accepting traffic.

Use stable aliases that users can type with `/use <repo>`. Do not add broad parent directories, temporary directories, or free-form paths. Workflow commands require the selected repository root to include `AGENTS.md`, `SPEC.md`, `feature_list.json`, `progress.md`, `init.sh`, and `orchestrator.py`.

## Start Command

Start webhook mode from the project root with the required environment available:

```bash
npm start
```

The `npm start` script must run `node src/index.js`.

Start local polling mode from the project root with the required environment available:

```bash
npm run start:polling
```

The `start:polling` script must run `node src/polling.js`.

Run the service under a local process supervisor when unattended operation is needed. The supervisor should preserve the working directory, environment variables, and access to the whitelisted repository paths.

For public server or VPS webhook deployment:

1. Deploy the Node.js service to a VPS, VM, container, Cloud Run service, or hosted Node.js runtime that exposes a public HTTPS URL.
2. Configure `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, `REPO_WHITELIST_JSON`, `TELEGRAM_WEBHOOK_URL`, and `PORT` in the deployed service environment.
3. Set `TELEGRAM_WEBHOOK_URL` to the deployed HTTPS URL plus `/telegram/webhook`, for example `https://bot.example.com/telegram/webhook`.
4. Provide persistent writable storage for `runtime_state.json` and `logs/`.
5. Ensure every whitelisted repository path exists inside the runtime.
6. Start the service with `npm start`.
7. Register the webhook with Telegram by running `npm run webhook:set` in an environment with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_URL` set.
8. Verify `GET /healthz` returns `ok`.
9. Send `/help` from an authorized Telegram chat.

The `webhook:set` script validates that `TELEGRAM_BOT_TOKEN` is present, validates that `TELEGRAM_WEBHOOK_URL` is a valid HTTPS URL, and calls Telegram `setWebhook` with the configured URL.

For local polling deployment:

1. Run the Node.js service on the local machine that contains the whitelisted repositories.
2. Configure `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, and `REPO_WHITELIST_JSON`.
3. Do not configure `TELEGRAM_WEBHOOK_URL` for polling mode.
4. Start polling with `npm run start:polling`.
5. Send `/help` from an authorized Telegram chat.
6. Verify that `/repos` returns aliases loaded from `REPO_WHITELIST_JSON`.

Polling mode must call Telegram `getUpdates`, dispatch valid message updates into the same app handler used by webhook mode, send replies through Telegram `sendMessage`, and persist the next update offset in `runtime_state.json`.

## Long-Running Operation

The `/ask`, `/work`, `/continue`, and `/run-orch` commands create Bot-recorded local tasks. Full output is written to task logs, while Telegram responses stay bounded.

Only one active workflow task of type `work`, `continue`, or `run-orch` can run in the same workspace. Use `/status` to inspect active and recent tasks, `/logs <task_id>` to inspect output, and `/stop <task_id>` to send `SIGTERM` to a Bot-recorded running task.

## Logs And State Files

`runtime_state.json` stores the selected repository alias, selected workspace path, Bot task metadata, and Telegram polling update offset. `logs/` stores full task output as `logs/<task_id>.log`.

`runtime_state.json` and `logs/` are runtime artifacts and must not be used as target repository feature state. Target repository source of truth remains in `SPEC.md`, `feature_list.json`, `progress.md`, `test_plan.md`, `init.sh`, `orchestrator.py`, and git history.

## Verification Before Start

Run the full local verification script before starting or restarting the service after changes:

```bash
./init.sh
```

The verification script checks required project files, validates `feature_list.json`, verifies unique feature IDs, runs the build check, and executes the available unit, harness, contract, and smoke checks.

## Operational Checks

After startup, verify operation from an authorized Telegram chat:

- `/help` returns the documented command surface.
- `/repos` lists the expected repository aliases and paths.
- `/use <repo>` selects the intended whitelisted repository.
- `/pwd`, `/ls`, and `/git` inspect only the selected workspace.
- `/status` reports active tasks and recent finished tasks.

Before running workflow commands, confirm the selected workspace contains the required agent workflow files and has a clean or intentionally understood working tree.

## Failure Handling

If startup fails, check `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, Node.js version, repository whitelist paths, and file permissions for `runtime_state.json` and `logs/`.

If a command fails, use `/logs <task_id>` for task output when a task was created. For workflow failures, inspect the selected target repository state files and git history because the Bot does not own feature lifecycle state.

If a task is stuck, use `/status` to find the task ID and `/stop <task_id>` to request termination. Re-run `./init.sh` after local changes before restarting unattended operation.
