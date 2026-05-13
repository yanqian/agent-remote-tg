# Progress

## Current System Status

The repository has a runnable zero-dependency Node.js scaffold for the implemented control-plane features plus the shared task executor abstraction.

Existing durable state files:

- `AGENTS.md`
- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `test_plan.md`
- `init.sh`
- `orchestrator.py`

Implemented behavior:

- Startup environment validation for `TELEGRAM_BOT_TOKEN` and `ALLOWED_CHAT_IDS`.
- Runtime path initialization for `runtime_state.json` and `logs/`.
- Command whitelist parsing and required-argument validation.
- Chat ID authorization.
- Repository whitelist normalization and exact alias lookup.
- Workspace runtime state load/save with atomic writes.
- `/repos`, `/use <repo>`, and `/pwd` handlers.
- Workspace inspection handlers for `/ls` and `/git`, running shell-disabled commands in the selected workspace with bounded Telegram responses.
- Task ID generation, shell-disabled task spawning, runtime task metadata persistence, stdout/stderr log persistence, exit code recording, task stop transitions, and Telegram response secret redaction helpers.
- `/ask <question>` handling that starts a read-only `codex exec` task in the selected workspace, uses the required prompt rules, enforces a 10 minute timeout, persists a full task log, and records final status from the process exit code.
- Agent-workflow readiness checks for `/work`, `/continue`, and `/run_orch`, requiring `AGENTS.md`, `SPEC.md`, `feature_list.json`, `progress.md`, `init.sh`, and `orchestrator.py` at the selected workspace root before later workflow process spawning can occur.
- `/work <requirement>` handling that rejects concurrent active workflow tasks in the selected workspace, starts a shell-disabled long-running `codex exec` delegation task with the required workflow prompt, leaves feature-state mutation to the spawned workflow, and relies on task logs for full output.
- `/continue <instruction>` handling that rejects concurrent active workflow tasks in the selected workspace, starts a shell-disabled long-running `codex exec` recovery task with the required repository-state reconstruction prompt, and relies on task logs for full output.
- `/run_orch <rounds>` handling that validates integer rounds from 1 through 5 with the specified invalid-rounds response, rejects concurrent active workflow tasks in the selected workspace, and starts a shell-disabled `python3 orchestrator.py --max-rounds <rounds>` task with full task logging.
- `/status`, `/logs <task_id>`, and `/stop <task_id>` handling for Bot-recorded tasks, including active task and recent finished task display, confined 120-line log tails, unknown task rejection, and SIGTERM only through recorded running task handles.
- `/help` handling with exact command-surface output.
- Root `README.md` documenting the project purpose, exact command surface, repository workflow model, runtime state and logs, local setup, verification, and current limitations.
- `docs/deployment.md` documenting local trusted-host deployment, environment variables, repository whitelist guidance, startup, long-running operation, runtime artifact boundaries, verification, operational checks, and failure handling.
- Reorganized `docs/` with `docs/README.md` as the documentation index, archived original specification content under `docs/archive/original-spec.md`, and agent workflow reference content under `docs/reference/agent-workflow.md`.
- Verification script normalization for F016: `init.sh` now delegates durable state validation to `scripts/verify-state.py`, `scripts/README.md` documents `verify-state.py` and `smoke.js`, and `package.json` exposes `test:smoke` while preserving `smoke`.
- Telegram webhook HTTP transport for F017: `GET /healthz`, `POST /telegram/webhook`, Telegram update parsing, dispatch through the existing app handler, Telegram `sendMessage` replies, invalid JSON handling, non-POST rejection, and `PORT`-based service startup through `src/index.js`.
- Contract verification for exact help output, exact command whitelist, prohibited feature commands, required workflow prompt text, and runtime state schema boundaries.
- Test scripts for build, unit, harness, contract, and smoke verification.
- GCP webhook deployment support for F018: `npm start`, `npm run webhook:set`, Telegram `setWebhook` registration with environment validation, fake Telegram API coverage, CLI missing-environment exit coverage, and deployment documentation.
- Repository whitelist startup configuration for F019 is implemented: `REPO_WHITELIST_JSON` is required at startup, aliases are restricted to letters, numbers, dots, underscores, and hyphens, configured paths must exist, `npm start` runs `node src/index.js`, README/deployment documentation covers the configuration, and automated coverage verifies valid and invalid whitelist configuration.
- Telegram long polling transport for F021: `npm run start:polling` runs `node src/polling.js`, polling mode calls Telegram `getUpdates`, dispatches valid message updates through `createApp().handleMessage(...)`, sends replies through Telegram `sendMessage`, persists the next update offset in `runtime_state.json`, and does not require `TELEGRAM_WEBHOOK_URL`.
- Public server and VPS deployment documentation for F020: webhook-mode docs are generalized beyond provider-specific deployment and cover public server, VPS, VM, container, Cloud Run, hosted Node.js runtime, HTTPS webhook URL, runtime-local repository paths, persistent `runtime_state.json` and `logs/` storage, and `npm start` as the webhook-mode command.
- BotFather-compatible orchestrator command for F022: Telegram command parsing, help output, tests, README, deployment documentation, and active SPEC references now use `/run_orch <rounds>`; `/run-orch` is rejected as an unknown command.
- Polling runtime state preservation for F023: advancing `telegramUpdateOffset` now reloads current runtime state before saving the offset, preserving app handler state changes such as `/use <repo>` workspace selection and task metadata written while handling updates, while still advancing offsets for valid update IDs and ignored non-message updates.
- Task final-result handling for F024: completed Bot tasks now persist a redacted `finalResult` extracted from Codex-style logs while preserving raw local log files, `/logs <task_id>` returns final results for finished tasks, active tasks report that the final result is not available yet, and missing final results use an explicit fallback instead of exposing raw process output.

## Last Completed Feature

`F023` - Fix polling runtime state persistence so advancing `telegramUpdateOffset` after a handled update reloads and preserves app handler state changes, including `/use <repo>` currentRepo and cwd changes plus task metadata writes, while still advancing offsets for valid update IDs and ignored non-message updates, with automated polling tests for workspace preservation and task metadata preservation.

## Next Feature

`F024` is implemented and ready for evaluator verification.

## Known Issues

- F024 implementation is ready for evaluator verification.
