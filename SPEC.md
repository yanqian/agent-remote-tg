# Remote Agent Telegram Control Plane SPEC

## 1. Goal

Build a local Telegram Bot that lets the owner control long-running agent workflows from a phone.

The Bot is a control plane for repositories that already use `AGENTS.md`, `SPEC.md`, `feature_list.json`, `progress.md`, `test_plan.md`, `init.sh`, and `orchestrator.py`.

Durable development state must remain in repository files and git history. Telegram messages, Bot runtime state, task metadata, and logs are runtime artifacts only.

Primary execution model:

```text
Telegram command
  -> authorized Bot handler
  -> selected whitelisted workspace
  -> local Codex or orchestrator process
  -> target repository state files and git history
```

## 2. Scope

### 2.1 Included

The system must implement:

- Telegram Bot startup from environment configuration.
- Chat ID authorization through `ALLOWED_CHAT_IDS`.
- A fixed repository whitelist.
- Repository whitelist configuration through `REPO_WHITELIST_JSON`.
- Workspace selection through `/use <repo>`.
- Workspace inspection through `/repos`, `/pwd`, `/ls`, and `/git`.
- Read-only Codex discussion through `/ask <question>`.
- Repository workflow delegation through `/work <requirement>`.
- Repository workflow recovery through `/continue <instruction>`.
- Orchestrator execution through `/run_orch <rounds>`.
- Task status inspection through `/status`.
- Task log inspection through `/logs <task_id>`.
- Task termination through `/stop <task_id>`.
- Command discovery through `/help`.
- Telegram webhook transport for receiving Telegram updates over HTTPS on a public server.
- Telegram long polling transport for receiving Telegram updates from a local machine without a public inbound address.
- Public server and VPS deployment support for running the webhook service.
- Runtime task state persistence in `runtime_state.json`.
- Full task output persistence in `logs/<task_id>.log`.
- Automated verification for parser, authorization, workspace, task execution, runtime state, prompts, and command surface.

### 2.2 Excluded

The system must not implement:

- Arbitrary shell command execution.
- Interactive remote shell.
- Free-form absolute path workspace selection.
- Filesystem access outside whitelisted repositories.
- Bot-owned feature lifecycle management.
- Bot-owned Coding Agent behavior.
- Bot-owned Evaluator Agent behavior.
- Direct Bot edits to target repository `SPEC.md`, `feature_list.json`, `progress.md`, or `test_plan.md`.
- Direct Bot commits in target repositories outside spawned Codex or orchestrator workflow.
- `/run-feature`.
- `/eval-feature`.
- Web dashboard.
- Cloud resource provisioning automation.
- Scheduled task execution.
- Multiple active workflow tasks in one workspace.

## 3. Core Concepts

### 3.1 Control Plane

The Bot validates commands, validates workspaces, starts local processes, records runtime task metadata, writes logs, and returns bounded Telegram responses.

The Bot must not decide which target repository feature is next, whether a feature passes, or how target repository state files change.

### 3.2 Target Repository

A target repository is a local directory listed in the repository whitelist.

The repository whitelist must come from `REPO_WHITELIST_JSON`.

`REPO_WHITELIST_JSON` must be a JSON object whose keys are repository aliases and whose values are local repository paths.

Example:

```json
{"agent-remote-tg":"/workspace/agent-remote-tg"}
```

Repository aliases must match `/^[A-Za-z0-9._-]+$/`.

Each repository path must be normalized to an absolute path before use.

Startup must fail with exit code `1` when `REPO_WHITELIST_JSON` is missing, invalid JSON, not a JSON object, contains an empty alias, contains an invalid alias, contains a non-string path value, or contains a path that does not resolve to an existing local directory.

A target repository is agent-workflow ready only when these files exist at its root:

- `AGENTS.md`
- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `init.sh`
- `orchestrator.py`

`/work`, `/continue`, and `/run_orch` must reject a workspace before spawning any process when one or more required files are missing.

### 3.3 Repository Source Of Truth

The target repository source of truth consists of:

- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `test_plan.md`
- `init.sh`
- `orchestrator.py`
- git history

The Bot runtime state must store only Bot-selected workspace data and Bot-started task metadata.

### 3.4 Workspace

A workspace is the currently selected whitelisted target repository.

Runtime state must store:

```json
{
  "currentRepo": "agent-runtime",
  "cwd": "/Users/armstrong/projects/agent-runtime"
}
```

`currentRepo` must be an exact repository whitelist key. `cwd` must equal the normalized absolute path configured for that key.

### 3.5 Task

A task is a Bot-started local process.

Allowed task types:

- `ask`
- `work`
- `continue`
- `run-orch`

Allowed task statuses:

- `running`
- `stopping`
- `stopped`
- `succeeded`
- `failed`

Each task record must include:

- `taskId`
- `type`
- `status`
- `pid`
- `cwd`
- `logPath`
- `startedAt`
- `finishedAt`
- `exitCode`

## 4. Core Flows

### 4.1 Authorization

Every Telegram message must be rejected unless the incoming chat ID is present in `ALLOWED_CHAT_IDS`.

Unauthorized response:

```text
Unauthorized chat.
```

`ALLOWED_CHAT_IDS` must be non-empty unless `NODE_ENV=test`.

### 4.2 Workspace Selection

`/repos` must list configured repository aliases and absolute paths.

`/use <repo>` must:

1. Match `<repo>` against the repository whitelist by exact alias.
2. Reject unknown aliases.
3. Resolve the configured path.
4. Reject paths that do not exist or are not directories.
5. Persist `currentRepo` and `cwd`.
6. Return the selected alias and absolute path.

Unknown repo response:

```text
Unknown repo: <repo>
Use /repos to list available repos.
```

### 4.3 Workspace Inspection

`/pwd` must return the selected workspace path.

`/ls` must spawn `ls -la` in the selected workspace.

`/git` must run these commands in the selected workspace:

```text
git branch --show-current
git status --short
git log --oneline -5
```

When no workspace is selected, `/pwd`, `/ls`, `/git`, `/ask`, `/work`, `/continue`, and `/run_orch` must return:

```text
No workspace selected.
Use /repos then /use <repo>.
```

### 4.4 Read-Only Discussion

`/ask <question>` must create an `ask` task and spawn `codex exec` in the selected workspace.

The prompt must contain these rules:

```text
Rules:
- Discuss and analyze only.
- Do not modify files.
- Do not update SPEC.md.
- Do not update feature_list.json.
- Do not run orchestrator.py.
- Do not commit.
```

The task log must contain stdout, stderr, command argv, timestamps, and exit code.

### 4.5 Work Delegation

`/work <requirement>` must create a `work` task and spawn `codex exec` in the selected workspace after agent-workflow readiness checks pass.

The prompt must require:

```text
1. Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20.
2. Run ./init.sh before changing files.
3. Determine whether the request is a new requirement or a bug fix.
4. Update SPEC.md through the repository planning workflow.
5. Append new feature entries to feature_list.json when new work is required.
6. Preserve all existing feature IDs, ordering, passes, status, attempts, last_error, and unknown fields.
7. Validate feature_list.json as JSON.
8. Create a planning commit when planning files changed.
9. Run python3 orchestrator.py --max-rounds 1.
10. Treat the task as complete only when the orchestrator and evaluator workflow pass.
11. Summarize changed files, feature IDs, commands run, final status, and remaining issues.
```

The Bot must not parse, rewrite, or complete target repository features.

### 4.6 Continue

`/continue <instruction>` must create a `continue` task and spawn `codex exec` in the selected workspace after agent-workflow readiness checks pass.

The prompt must contain:

```text
Do not rely on chat history.
Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20 before deciding the next action.
Run ./init.sh before changing files.
Use orchestrator.py according to AGENTS.md when implementation or evaluation is required.
Do not overwrite feature_list.json.
Do not reset existing feature state.
Stop and report exact conflicts when repository state is unsafe.
```

### 4.7 Telegram Webhook Transport

The service must expose an HTTP webhook endpoint for Telegram updates.

The webhook endpoint path must be:

```text
/telegram/webhook
```

The service must accept only `POST` requests on `/telegram/webhook`.

The service must reject non-`POST` requests to `/telegram/webhook` with HTTP status `405`.

The service must parse the Telegram update JSON body.

The service must process only message updates that contain:

- `message.chat.id`
- `message.text`

Updates without `message.chat.id` or `message.text` must return HTTP status `200` with no command execution.

For a valid message update, the service must call the existing Bot application message handler with:

```json
{
  "chatId": "<message.chat.id as string>",
  "text": "<message.text>"
}
```

The service must send the handler response back to Telegram by calling:

```text
POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage
```

The `sendMessage` request body must include:

- `chat_id`
- `text`

The webhook HTTP response must return status `200` after the service attempts to send the Telegram reply.

Invalid JSON request bodies must return HTTP status `400`.

The webhook transport must not expose arbitrary command execution, workspace paths outside the repository whitelist, or environment variable dumps.

### 4.8 Webhook Registration

The project must provide a script for registering the Telegram webhook URL.

The script path must be:

```text
scripts/set-telegram-webhook.js
```

The script must read:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_URL`

The script must call:

```text
POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook
```

The request body must include:

- `url`

The script must exit `1` when `TELEGRAM_BOT_TOKEN` or `TELEGRAM_WEBHOOK_URL` is missing.

The script must exit `1` when Telegram returns `ok: false`.

### 4.9 Telegram Long Polling Transport

The project must provide a local polling transport that receives Telegram updates by calling:

```text
GET https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```

The polling transport must run from this npm command:

```text
npm run start:polling
```

The exact `start:polling` command must be:

```text
node src/polling.js
```

The polling transport must not require `TELEGRAM_WEBHOOK_URL` or a public inbound network address.

The polling transport must read:

- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_CHAT_IDS`
- `REPO_WHITELIST_JSON`

The polling transport must call Telegram `getUpdates` with an offset that prevents the same update from being processed twice after it has been handled.

For every valid message update, the polling transport must call the existing Bot application message handler with:

```json
{
  "chatId": "<message.chat.id as string>",
  "text": "<message.text>"
}
```

The polling transport must send the handler response back to Telegram through `sendMessage`.

Updates without `message.chat.id` or `message.text` must advance the offset and must not execute a command.

The polling transport must persist the last processed Telegram update offset in `runtime_state.json`.

Polling delivery errors must not corrupt `runtime_state.json`.

### 4.10 Orchestrator Execution

`/run_orch <rounds>` must:

1. Require an agent-workflow ready selected workspace.
2. Parse `<rounds>` as a base-10 integer.
3. Accept only values from `1` through `5`.
4. Spawn `python3 orchestrator.py --max-rounds <rounds>` with shell disabled.

Invalid rounds response:

```text
Invalid rounds. Use an integer from 1 to 5.
```

### 4.11 Task Status, Logs, And Stop

`/status` must return all `running` and `stopping` tasks plus the five most recent finished tasks.

`/logs <task_id>` must return the last 120 log lines for a known task and reject unknown IDs.

`/stop <task_id>` must send `SIGTERM` only to a Bot-recorded `running` task and must preserve that task log.

## 5. Constraints

### 5.1 Security

- Use a command whitelist.
- Use a repository whitelist.
- Spawn processes with `shell: false`.
- Reject absolute paths in `/use`.
- Reject `..` traversal in repo aliases and task IDs.
- Redact `TELEGRAM_BOT_TOKEN` and environment values whose names contain `TOKEN`, `SECRET`, `PASSWORD`, or `KEY`.
- Do not print full environment dumps to Telegram.

### 5.2 Process

- Only one active `work`, `continue`, or `run-orch` task is allowed per workspace.
- `ask` tasks have a 10 minute timeout.
- `work`, `continue`, and `run-orch` tasks have no forced timeout.
- `/stop` is the only user command that terminates long-running tasks.

### 5.3 Output

- Telegram responses must not exceed 3500 characters.
- `/logs` must read the last 120 lines before response truncation.
- Every task creation response must include the task ID and `/logs <task_id>` instruction.
- Full process output must be persisted to the task log.

### 5.4 Implementation

- Separate command parsing, authorization, workspace state, task execution, and Telegram transport into testable units.
- Tests must avoid real Telegram network calls.
- Tests must avoid real Codex execution.
- Tests must verify spawned command argv through mocks or fakes.

### 5.5 Public Server And VPS Deployment

- The supported webhook runtime must be a VPS, VM, container, or Node.js service with a public HTTPS URL.
- The runtime must provide persistent writable storage for `runtime_state.json` and `logs/`, or must mount a persistent volume for those paths.
- The runtime must have access to the whitelisted repositories used by `/use`.
- The runtime must supply `REPO_WHITELIST_JSON` with aliases and paths that exist inside the deployed runtime.
- The runtime must provide `python3` and `codex` when `/work`, `/continue`, `/ask`, or `/run_orch` are used.
- Secrets must be supplied through environment configuration, VPS environment files, systemd environment files, process manager configuration, or cloud secret configuration.
- Secrets must not be committed to git.
- The webhook service must listen on the port specified by `PORT` when `PORT` is set.

## 6. Acceptance Criteria

- Bot starts with `TELEGRAM_BOT_TOKEN` and non-empty `ALLOWED_CHAT_IDS`.
- Bot exits with failure when `ALLOWED_CHAT_IDS` is empty outside `NODE_ENV=test`.
- Bot exits with failure when `REPO_WHITELIST_JSON` is missing or invalid.
- Bot exits with failure when `REPO_WHITELIST_JSON` references a path that does not resolve to an existing local directory.
- Unauthorized chat IDs receive `Unauthorized chat.` and do not spawn processes.
- `/repos` returns repo aliases and absolute paths loaded from `REPO_WHITELIST_JSON`.
- `/use <repo>` persists the selected workspace.
- `/pwd` returns the selected workspace path.
- `/ls` runs `ls -la` in the selected workspace.
- `/git` returns branch, short status, and five recent commits.
- `/ask` spawns `codex exec` with the required read-only prompt.
- `/work` rejects non-ready workspaces.
- `/work` spawns `codex exec` with the required workflow prompt.
- `/continue` spawns `codex exec` with the required recovery prompt.
- `/run_orch 1` spawns `python3 orchestrator.py --max-rounds 1` with shell disabled.
- `/run_orch` rejects non-integers and integers outside `1..5`.
- `/status` lists active tasks and five recent finished tasks.
- `/logs <task_id>` returns bounded log tail.
- `/stop <task_id>` sends `SIGTERM` only to a Bot-recorded running task.
- `/help` lists exactly the documented commands.
- Unknown slash commands return `Unknown command.\nUse /help.`.
- `/run-feature` is not implemented.
- `/eval-feature` is not implemented.
- Runtime state survives process restart.
- Task logs survive process restart.
- Runtime state does not contain target repository feature objects.
- `/telegram/webhook` accepts valid Telegram message updates and sends handler responses through Telegram `sendMessage`.
- `/telegram/webhook` rejects invalid JSON with HTTP status `400`.
- `/telegram/webhook` rejects non-`POST` requests with HTTP status `405`.
- Updates without message text return HTTP status `200` without command execution.
- The webhook registration script registers `TELEGRAM_WEBHOOK_URL` through Telegram `setWebhook`.
- `npm run start:polling` starts the polling transport with `node src/polling.js`.
- The polling transport calls Telegram `getUpdates`, dispatches valid message updates into the existing app handler, sends replies through Telegram `sendMessage`, persists the next update offset, and does not require a public inbound address.

## 7. Verification Plan

Automated verification must run through `./init.sh`.

Required checks:

- Build check for current project files.
- JSON syntax validation for `feature_list.json`.
- Feature ID uniqueness validation.
- Required repository state file existence validation.
- Unit test command when a unit test script exists.
- Harness test command when a harness test script exists.
- Contract test command when a contract test script exists.
- Smoke test command when a smoke test script exists.
- Repository whitelist configuration tests for valid JSON, invalid JSON, invalid aliases, non-string path values, missing paths, and successful `/repos` output.
- Webhook transport tests with fake HTTP requests and fake Telegram API calls.
- Webhook registration tests with fake Telegram API calls.
- Polling transport tests with fake Telegram API calls for `getUpdates`, offset advancement, app handler dispatch, and `sendMessage` replies.

Manual verification sequence:

```text
/repos
/use <test_repo>
/pwd
/ls
/git
/ask Explain the repository workflow without editing files.
/work Add a documentation-only requirement and run one orchestrator round.
/status
/logs <task_id>
```

Manual verification passes only when:

- `/ask` leaves the workspace unchanged.
- `/work` delegates planning and execution to Codex.
- Task status transitions are visible.
- Logs are persisted under `logs/`.

## 8. Non-Ambiguity Rules

- Treat every `must` statement as mandatory.
- Treat every excluded item as prohibited.
- Do not add undocumented commands.
- Do not change exact response strings.
- Do not execute user input through a shell.
- Do not use Telegram history as repository context.
- Do not mark target repository features complete from the Bot.

## 9. Documentation Requirements

### 9.1 README

The repository must include `README.md` at the repository root.

`README.md` must contain these top-level sections in this order:

1. `# Remote Agent Telegram Control Plane`
2. `## What This Project Does`
3. `## Command Surface`
4. `## Repository Workflow Model`
5. `## Transport Modes`
6. `## Runtime State And Logs`
7. `## Local Setup`
8. `## Verification`
9. `## Current Limitations`

The `## Command Surface` section must document exactly these commands and must not document `/run-feature` or `/eval-feature`:

- `/repos`
- `/use <repo>`
- `/pwd`
- `/ls`
- `/git`
- `/ask <question>`
- `/work <requirement>`
- `/continue <instruction>`
- `/run_orch <rounds>`
- `/status`
- `/logs <task_id>`
- `/stop <task_id>`
- `/help`

The `## Local Setup` section must list the required environment variables:

- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_CHAT_IDS`

The `## Verification` section must include this command:

```bash
./init.sh
```

### 9.2 Deployment Documentation

The repository must include `docs/deployment.md`.

`docs/deployment.md` must contain these top-level sections in this order:

1. `# Deployment`
2. `## Runtime Host Requirements`
3. `## Environment Variables`
4. `## Repository Whitelist`
5. `## Start Command`
6. `## Long-Running Operation`
7. `## Logs And State Files`
8. `## Verification Before Start`
9. `## Operational Checks`
10. `## Failure Handling`

The deployment document must state that the service runs as a local process on a trusted host with access to the whitelisted repositories.

The deployment document must include this start command:

```bash
npm start
```

The deployment document must include this polling start command:

```bash
npm run start:polling
```

The deployment document must include this verification command:

```bash
./init.sh
```

The deployment document must state that `runtime_state.json` and `logs/` are runtime artifacts and must not be used as target repository feature state.

## 10. Repository Organization Requirements

### 10.1 Root Directory Contract

The repository root must keep these source-of-truth and execution entry files at the root:

- `AGENTS.md`
- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `test_plan.md`
- `init.sh`
- `orchestrator.py`
- `README.md`
- `package.json`

The repository root must not contain archived drafts, duplicate specs, generated runtime logs, or generated runtime state.

### 10.2 Documentation Directory Contract

The `docs/` directory must contain a `README.md` index that identifies the canonical purpose of each documentation file under `docs/`.

`docs/README.md` must list:

- `deployment.md`
- `reference/agent-workflow.md`
- `archive/original-spec.md`

The archived initial specification draft must live at `docs/archive/original-spec.md`.

The agent workflow reference must live at `docs/reference/agent-workflow.md`.

`docs/deployment.md` must remain at `docs/deployment.md`.

After documentation reorganization, no obsolete pre-reorganization documentation path may remain.

### 10.3 Scripts Directory Contract

The `scripts/` directory must contain reusable verification scripts only.

State validation logic must live in `scripts/verify-state.py`.

`init.sh` must call `python3 scripts/verify-state.py` for feature state validation and banned SPEC wording validation.

`scripts/README.md` must document:

- `verify-state.py`
- `smoke.js`

`package.json` must expose both `smoke` and `test:smoke`, and both commands must run `node scripts/smoke.js`.

### 10.4 Organization Acceptance Criteria

- `./init.sh` passes after the directory organization changes.
- `find docs -maxdepth 3 -type f | sort` shows `docs/README.md`, `docs/archive/original-spec.md`, `docs/deployment.md`, and `docs/reference/agent-workflow.md`.
- `find scripts -maxdepth 2 -type f | sort` shows `scripts/README.md`, `scripts/smoke.js`, and `scripts/verify-state.py`.
- `package.json` contains `smoke` and `test:smoke` scripts with the exact command `node scripts/smoke.js`.
- No repository file references obsolete pre-reorganization documentation paths.

## 11. Public Server And VPS Webhook Deployment Requirements

### 11.1 Required Environment

The deployed service must receive these environment variables:

- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_CHAT_IDS`
- `REPO_WHITELIST_JSON`
- `TELEGRAM_WEBHOOK_URL`
- `PORT`

`PORT` must default to `3000` when it is not set.

`REPO_WHITELIST_JSON` must contain a JSON object mapping exact repository aliases to local repository paths:

```json
{"agent-remote-tg":"/workspace/agent-remote-tg"}
```

Invalid JSON, non-object JSON, empty aliases, invalid aliases, non-string path values, and missing repository paths must fail startup with exit code `1`.

### 11.2 Required NPM Scripts

`package.json` must include:

- `start`
- `start:polling`
- `webhook:set`

The exact `start` command must be:

```text
node src/index.js
```

The exact `webhook:set` command must be:

```text
node scripts/set-telegram-webhook.js
```

The exact `start:polling` command must be:

```text
node src/polling.js
```

### 11.3 Required HTTP Endpoints

The service must expose:

- `GET /healthz`
- `POST /telegram/webhook`

`GET /healthz` must return HTTP status `200` and response body:

```text
ok
```

### 11.4 Verification Requirements

Automated tests must verify:

- `GET /healthz` returns `200` and `ok`.
- `POST /telegram/webhook` passes authorized command text into the app handler.
- `POST /telegram/webhook` calls Telegram `sendMessage` with the handler response.
- Invalid JSON returns `400`.
- Non-`POST` webhook requests return `405`.
- `scripts/set-telegram-webhook.js` exits `1` when required environment variables are missing.
- `scripts/set-telegram-webhook.js` sends the configured webhook URL to Telegram.

### 11.5 Documentation Requirements

`docs/deployment.md` must document public server and VPS webhook deployment steps:

1. Build or deploy the Node.js service on a public server, VPS, VM, container, or hosted Node.js runtime with HTTPS.
2. Configure `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, `REPO_WHITELIST_JSON`, `TELEGRAM_WEBHOOK_URL`, and `PORT`.
3. Ensure persistent storage for `runtime_state.json` and `logs/`.
4. Ensure whitelisted repositories are available to the runtime.
5. Run `npm run webhook:set`.
6. Verify `/healthz`.
7. Send `/help` from an authorized Telegram chat.

`docs/deployment.md` must document local polling deployment steps:

1. Run the service on the local machine that has the target repositories.
2. Configure `TELEGRAM_BOT_TOKEN`, `ALLOWED_CHAT_IDS`, and `REPO_WHITELIST_JSON`.
3. Start polling with `npm run start:polling`.
4. Send `/help` from an authorized Telegram chat.
5. Verify that `/repos` returns aliases loaded from `REPO_WHITELIST_JSON`.

## 12. BotFather-Compatible Orchestrator Command Requirements

### 12.1 Goal

Rename the Telegram orchestrator command from `/run-orch <rounds>` to `/run_orch <rounds>` so the command can be registered in the BotFather command menu.

### 12.2 Scope

Include:

- Replace the supported command `/run-orch` with `/run_orch`.
- Preserve the existing rounds validation for integer values from `1` through `5`.
- Preserve the existing execution behavior: spawn `python3 orchestrator.py --max-rounds <rounds>` with shell execution disabled in the selected workflow-ready workspace.
- Preserve concurrent workflow task rejection for active `work`, `continue`, and orchestrator tasks in the same workspace.
- Update command parsing, help output, command-surface contract tests, harness tests, README command surface, README BotFather command menu, deployment documentation, progress documentation, and SPEC references.
- Register `/run_orch` in the BotFather command menu documentation.

Exclude:

- Do not add a compatibility alias for `/run-orch`.
- Do not change the orchestrator Python script behavior.
- Do not change allowed round values.
- Do not add new workflow commands.
- Do not change task log format.

### 12.3 Core Concepts

`/run_orch <rounds>` is the only Telegram command that starts orchestrator rounds.

`/run-orch` is not a supported Telegram command after this change.

BotFather command names must contain only lowercase letters, digits, and underscores.

### 12.4 Core Flow

1. Authorized user sends `/run_orch <rounds>`.
2. The command parser recognizes `/run_orch`.
3. The app validates `<rounds>` as an integer from `1` through `5`.
4. The app verifies that a workflow-ready workspace is selected.
5. The app rejects the request when an active workflow task already exists in the selected workspace.
6. The app starts a recorded task that runs `python3 orchestrator.py --max-rounds <rounds>` with shell execution disabled.
7. The app returns the task ID and log command to Telegram.

### 12.5 Constraints

- `/run-orch` must return `Unknown command.\nUse /help.`.
- `/help` must list `/run_orch <rounds>` and must not list `/run-orch <rounds>`.
- The command whitelist must include `/run_orch` and must not include `/run-orch`.
- BotFather command menu documentation must include `run_orch - Run orchestrator rounds`.
- Documentation must not instruct users to configure `run-orch` in BotFather.

### 12.6 Acceptance Criteria

- `src/constants.js` exposes `/run_orch` in the command whitelist.
- Missing argument handling returns `Usage: /run_orch <rounds>`.
- Existing `/run-orch` tests are updated to `/run_orch`.
- A test verifies `/run-orch 1` is rejected as an unknown command.
- README command surface documents `/run_orch <rounds>`.
- README BotFather command menu includes `run_orch - Run orchestrator rounds`.
- `docs/deployment.md` documents `/run_orch <rounds>` for long-running operation and operational checks.
- `./init.sh` passes.

### 12.7 Verification Plan

- Run `npm run test:unit`.
- Run `npm run test:harness`.
- Run `npm run test:contract`.
- Run `./init.sh`.

## 13. Polling Runtime State Preservation Requirements

### 13.1 Goal

Fix polling mode so saving `telegramUpdateOffset` after a handled Telegram update does not overwrite runtime state changes written by the app handler.

### 13.2 Scope

Include:

- Preserve `currentRepo` and `cwd` written by `/use <repo>` when polling mode advances `telegramUpdateOffset`.
- Preserve `tasks` written by task-creating commands when polling mode advances `telegramUpdateOffset`.
- Keep advancing `telegramUpdateOffset` after each valid Telegram `update_id`.
- Keep ignoring updates without `message.chat.id` or `message.text` while still advancing `telegramUpdateOffset`.
- Add automated coverage that reproduces `/use <repo>` followed by offset persistence in polling mode.
- Add automated coverage that task metadata created by a handled command is not overwritten by polling offset persistence.

Exclude:

- Do not change webhook transport behavior.
- Do not change the runtime state schema.
- Do not change command responses.
- Do not change Telegram API request shapes.
- Do not add message history storage.

### 13.3 Core Concepts

The app handler owns command state mutations such as selected workspace and task records.

Polling transport owns Telegram update offset advancement.

When both the app handler and polling transport write `runtime_state.json` during the same update, the polling transport must merge the latest persisted runtime state with the new `telegramUpdateOffset`.

### 13.4 Core Flow

1. Polling mode loads the current runtime state to read the current `telegramUpdateOffset`.
2. Polling mode fetches updates from Telegram.
3. Polling mode dispatches a valid message update to `createApp().handleMessage(...)`.
4. The app handler writes command state changes to `runtime_state.json` when the command changes state.
5. Polling mode reloads the latest runtime state after the app handler returns.
6. Polling mode writes the reloaded state with `telegramUpdateOffset` set to `update_id + 1`.
7. A later `/pwd` command sees the workspace selected by the previous `/use <repo>` command.

### 13.5 Constraints

- Polling mode must not write a stale runtime state object after `app.handleMessage(...)` returns.
- Polling mode must preserve `currentRepo`, `cwd`, and `tasks` fields from the latest persisted runtime state.
- Polling mode must persist `telegramUpdateOffset` for updates that contain no executable message.
- Polling mode must not execute a Telegram update more than once after `sendMessage` delivery fails.

### 13.6 Acceptance Criteria

- A polling test proves `/use app` persists `currentRepo` and `cwd` after `telegramUpdateOffset` is advanced.
- A polling test proves task metadata written by a handled command remains present after `telegramUpdateOffset` is advanced.
- Existing polling tests continue to pass.
- `./init.sh` passes.

### 13.7 Verification Plan

- Run `npm run test:unit`.
- Run `npm run test:harness`.
- Run `./init.sh`.
