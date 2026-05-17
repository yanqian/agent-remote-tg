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
- Telegram task completion pushes for F025: Bot-started `/ask`, `/work`, `/continue`, and `/run_orch` tasks now record the originating `chatId`, keep immediate task-start and `/logs` behavior unchanged, and send a completion message with task ID, final status, and stored final result while tolerating Telegram send failures without changing task status.
- Duplicate final-result cleanup for F026: `extractFinalResultFromLog` now removes Codex token-usage blocks and token-count lines before collapsing duplicated final answers, preserving the existing extraction behavior while returning exactly one final answer for duplicated-output logs.
- Ask session runtime schema support for F027: runtime state now normalizes `askSessions` bindings by Telegram `chatId` and repository alias, `/ask` tasks record the selected repository alias, task completion extracts Codex session IDs from logs when available, and ask task metadata plus bindings persist discovered `codexSessionId` values.
- Session-aware plain `/ask <message>` behavior for F028: `/ask` starts a new read-only `codex exec` task when no current chatId plus repo binding exists, resumes an existing binding with shell-disabled `codex exec resume <session_id> <message>`, and records chatId, repo alias, and codexSessionId metadata on resumed tasks.
- Explicit ask session management for F029: `/ask new <message>` forces a new read-only Codex ask task, `/ask resume <session_id> <message>` resumes and binds a specific session, `/ask resume --last <message>` uses Codex CLI's runtime-user `--last` session and updates the binding after session discovery, `/ask exit` clears only the current chat and repository binding, `/ask session` reports the selected binding or an explicit no-session response, and `/ask -- <message>` treats reserved ask subcommand words as literal question text.
- Task session ID display for F030: `/status` includes `codexSessionId` for tasks that have Codex session metadata, and `/logs <task_id>` prefixes active-task and finished-task responses with the Codex session ID when present while preserving existing no-session responses and final-result-only log behavior.
- Workflow command regression coverage for F031: unit and harness tests now prove `/work`, `/continue`, and `/run_orch` ignore selected ask session bindings, do not use Codex ask resume argv, preserve workflow command argv, preserve existing chat metadata, and do not attach ask-session metadata to workflow tasks.
- Telegram approval decisions for F032: `/approve <request_id>`, `/reject <request_id>`, and `/always_allow <request_id>` are supported; reply-based decisions approve, reject, or always-allow pending requests through Telegram reply correlation; runtime state persists approval requests and future allow rules; unsafe, unknown, expired, resolved, and unauthorized requests are rejected.
- Structured Codex ask session metadata handling for F033: `/ask`, `/ask new`, `/ask resume <session_id> <message>`, and `/ask resume --last <message>` now run Codex CLI with JSONL output enabled, resumed ask start responses include the Codex session ID and a resumed-mode indicator, and session extraction trusts structured Codex metadata or initial pre-answer CLI session headers only before non-metadata output, preventing command output or assistant answer text from overriding the real session ID.
- Codex JSONL final-result extraction for F034: task logs from `codex exec --json` now prefer the last user-facing `item.completed` `agent_message` or `assistant_message` text as `finalResult`, ignoring command execution JSONL events and raw command output while preserving plain-text marker fallback, token cleanup, duplicate cleanup, raw local logs, Telegram truncation, and secret redaction.
- General Codex agent command for F035: `/agent <instruction>`, `/agent new <instruction>`, `/agent resume <session_id|--last> <instruction>`, `/agent exit`, `/agent session`, and `/agent -- <instruction>` now replace the public read-only `/ask` surface; `/ask`, `/work`, and `/run_orch` are removed from the public whitelist and return unknown command, while `/continue`, task management, workspace, and approval commands remain available. Agent tasks use shell-disabled `codex exec --json`, persist Codex session metadata through the legacy-compatible `askSessions` runtime shape, preserve JSONL final-result extraction and completion pushes, and use a general prompt that follows `AGENTS.md` for implementation requests and summarizes actions, changed files, verification, and remaining issues.
- Basic Codex permission prompt bridging for F036: Bot-started `/agent` and `/continue` task output is scanned for structured Codex permission or approval requests, pending requests persist task/chat/repo/session/detail/options metadata, Telegram approval messages are bounded and redacted with one inline keyboard button per Codex option, callback data uses safe Bot-local request and option IDs, selected options are written back to the running task stdin, compatible `/approve`, `/reject`, `/always_allow`, `/always_reject`, and reply flows remain available, and unsafe, unknown, expired, resolved, unauthorized, or option-incompatible requests are rejected.
- Agent task timeout policy for F037: `/agent`, `/agent new`, `/agent resume <session_id> <instruction>`, and `/agent resume --last <instruction>` now default to `timeoutMs: null`, optional `AGENT_TASK_TIMEOUT_MS` startup configuration applies a positive integer millisecond timeout, invalid configured values fail startup, `/continue` remains untimed, and documentation plus unit, harness, startup, and smoke coverage verify the behavior.
- Codex thread session extraction for F038: `/agent new` task logs now trust real-shaped Codex JSONL `thread.started` events with `thread_id` or `threadId` before assistant output, persist the discovered thread ID as task `codexSessionId`, replace the current chat plus repository binding after completion, and make the next plain `/agent` resume the newly bound thread while preserving existing session and conversation metadata support and rejecting assistant prose or command-output lookalikes.
- Agent chat mode for F039: `/agent`, `/agent new`, `/agent resume <session_id> <instruction>`, and `/agent resume --last <instruction>` now enable chat mode for the authorized Telegram chat plus selected repository; ordinary non-command text in that mode resumes the bound Codex session, clear rejection messages cover missing workspace, disabled mode, missing session, and active same-repository agent tasks, `/agent session` reports repo/session/mode status, `/agent exit` disables only the mode flag while preserving session history, and `/continue` is removed from the public command surface.
- Non-blocking Codex task stdin policy for F040: Bot-started task spawning now ignores child stdin by default while preserving shell-disabled execution, stdout/stderr log capture, final-result extraction, session extraction, timeout handling, completion pushes, `/stop`, `/logs`, Telegram truncation, secret redaction, and approval request detection from output; explicitly opted-in tasks can still request piped stdin, and approval decisions now fail clearly when the running task has no writable stdin.
- External behavior verification guardrails for F041: contract tests now assert that `AGENTS.md` keeps the external behavior verification requirements for mocks, process semantics, structured output fields, and real-shaped fixtures; `npm run test:codex-stdin-probe` provides a disabled-by-default real Codex CLI stdin probe that can be enabled with `ENABLE_CODEX_STDIN_PROBE=1` without adding Codex, network, Telegram, or OpenAI account requirements to default `./init.sh`.
- Bot-local approval testing for F042: `/approval_test` is available to authorized chats, creates a pending Bot-local approval request without requiring a workspace or running Codex task, includes approve, reject, always-allow, and always-reject options, supports command, reply, and callback resolution through the existing approval flow, skips task stdin delivery because no task is associated, and documents the command in help, README, deployment, and BotFather command menu references.

## Last Completed Feature

`F042` - Add a safe Bot-local `/approval_test` command for authorized Telegram chats.

## Next Feature

`F043` - Fix Codex session metadata extraction when harmless CLI prelude lines appear before top-level JSONL `thread.started` metadata.

## Known Issues

- Approval decisions for default non-interactive Bot-started Codex tasks can only be detected and surfaced; delivering a decision requires a future explicit writable-stdin protocol opt-in from the task starter.
