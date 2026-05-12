# Deployment

## Runtime Host Requirements

Run the service as a local process on a trusted host with access to the whitelisted repositories. The host must have Node.js 20 or newer, local access to the selected repository paths, and the `codex` and `python3` commands available when workflow commands are expected to run.

The trusted host model is intentional. This project is not cloud deployment automation, and it does not provide an isolation boundary for untrusted operators or untrusted repository paths.

## Environment Variables

Set these variables before starting the service:

- `TELEGRAM_BOT_TOKEN` - Telegram Bot token used by the local Bot process.
- `ALLOWED_CHAT_IDS` - comma-separated Telegram chat IDs allowed to use the Bot.

`ALLOWED_CHAT_IDS` must be non-empty outside `NODE_ENV=test`. Keep the Bot token out of source control, runtime logs, and target repository state files.

## Repository Whitelist

Configure only trusted local repositories in the repository whitelist passed to the host process. Each alias must be an exact key, and each path must resolve to an existing local directory.

Use stable aliases that users can type with `/use <repo>`. Do not add broad parent directories, temporary directories, or free-form paths. Workflow commands require the selected repository root to include `AGENTS.md`, `SPEC.md`, `feature_list.json`, `progress.md`, `init.sh`, and `orchestrator.py`.

## Start Command

Start the service from the project root with the required environment available:

```bash
npm start
```

Run the service under a local process supervisor when unattended operation is needed. The supervisor should preserve the working directory, environment variables, and access to the whitelisted repository paths.

## Long-Running Operation

The `/ask`, `/work`, `/continue`, and `/run-orch` commands create Bot-recorded local tasks. Full output is written to task logs, while Telegram responses stay bounded.

Only one active workflow task of type `work`, `continue`, or `run-orch` can run in the same workspace. Use `/status` to inspect active and recent tasks, `/logs <task_id>` to inspect output, and `/stop <task_id>` to send `SIGTERM` to a Bot-recorded running task.

## Logs And State Files

`runtime_state.json` stores the selected repository alias, selected workspace path, and Bot task metadata. `logs/` stores full task output as `logs/<task_id>.log`.

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
