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

`/logs <task_id>` must return the stored final task result for a known finished task, return a not-available-yet status for active tasks, and reject unknown IDs.

`/stop <task_id>` must send `SIGTERM` only to a Bot-recorded `running` task and must preserve that task log.

### 4.12 Approval Interaction

The Bot must support approving or rejecting pending agent approval requests from Telegram.

The command surface must include:

- `/approve <request_id>`
- `/reject <request_id>`
- `/always_allow <request_id>`

`/approve <request_id>` must approve only the referenced pending approval request.

`/reject <request_id>` must reject only the referenced pending approval request.

`/always_allow <request_id>` must approve the referenced pending approval request and record an allow rule so equivalent future requests can be approved without asking again.

When the Bot sends an approval request message to Telegram, it must include enough durable runtime metadata to correlate replies to the pending request.

If an authorized user replies to an approval request message with `yes`, `y`, or `approve`, the Bot must perform the same action as `/approve <request_id>` for that request.

If an authorized user replies to an approval request message with `no`, `n`, or `reject`, the Bot must perform the same action as `/reject <request_id>` for that request.

If an authorized user replies to an approval request message with `always`, `always allow`, or `以后都允许`, the Bot must perform the same action as `/always_allow <request_id>` for that request.

Reply-based approval decisions must apply only when the incoming Telegram message is a reply to a Bot approval request message. The same words sent as ordinary non-reply messages must not approve, reject, or always-allow anything.

Approval request IDs must be validated as safe IDs before use, and unknown, expired, already-resolved, or unauthorized approval requests must be rejected with a clear Telegram response.

### 4.13 Codex Permission Prompt Button Bridge

The Bot must provide basic Telegram support for Codex permission prompts raised by Bot-started Codex tasks.

When a running `/agent` or `/continue` Codex task emits a permission or approval request, the Bot must create a pending approval request in runtime state and send an approval message to the originating Telegram chat.

The approval message must summarize the Codex request, including:

- Bot task ID.
- Codex session ID when available.
- Selected repository alias and workspace path when available.
- Requested action or permission category.
- Command, path, or resource details when Codex provides them.
- The exact decision options exposed by Codex.

The Telegram approval message must include inline keyboard buttons that map to the Codex-provided decision options.

If Codex exposes three decision options, the Bot must render three corresponding Telegram buttons. The Bot must not invent extra decision buttons for that prompt.

Each button callback must include only a safe Bot-local approval request ID and a safe option ID. It must not expose raw shell fragments, absolute paths, secrets, or unbounded Codex output in callback data.

Selecting a Telegram approval button must resolve the matching pending approval request and deliver the selected option back to the running Codex task.

If Codex exposes an option equivalent to approve, reject, always allow, or always reject, the Bot may map that option to the existing approval decision model. If Codex exposes differently named options, the Bot must preserve the Codex option identity instead of forcing it into an inaccurate decision.

The explicit `/approve <request_id>`, `/reject <request_id>`, and `/always_allow <request_id>` commands, plus reply-based `yes` and `no` decisions, remain fallback interfaces for compatible approval requests. They do not replace inline button handling.

If a Codex prompt exposes an always-reject option, the Bot must support choosing it through the mapped Telegram button. A command fallback may be added as `/always_reject <request_id>` when the request exposes a compatible always-reject option.

Approval decisions must be accepted only from authorized chats and only for approval requests associated with that chat or explicitly chat-neutral requests.

The Bot must reject button callbacks and command fallbacks for unknown, expired, already-resolved, unauthorized, or option-incompatible approval requests.

The Bot must preserve raw Codex task logs locally while keeping Telegram approval messages bounded and redacted.

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
- `/logs <task_id>` returns the stored final task result.
- `/stop <task_id>` sends `SIGTERM` only to a Bot-recorded running task.
- `/approve <request_id>` approves only the referenced pending approval request.
- `/reject <request_id>` rejects only the referenced pending approval request.
- `/always_allow <request_id>` approves the referenced pending approval request and stores an allow rule for equivalent future requests.
- Replying `yes` or `approve` to a Bot approval request message approves the correlated request.
- Replying `no` or `reject` to a Bot approval request message rejects the correlated request.
- Replying `always`, `always allow`, or `以后都允许` to a Bot approval request message approves the correlated request and stores the future allow rule.
- Approval reply words sent outside a reply to a Bot approval request message do not trigger approval decisions.
- When Codex raises a permission prompt with multiple decision options, the Bot sends one Telegram inline button for each Codex-provided option.
- Selecting an approval button resolves the matching pending request and sends the selected option back to the running Codex task.
- If Codex provides exactly three decision options, the Telegram approval message contains exactly three mapped decision buttons.
- Button callback data contains only safe Bot-local IDs and never contains raw commands, paths, secrets, or unbounded Codex output.
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

## 14. Telegram Task Result Extraction Requirements

### 14.1 Goal

Store the final user-facing result of each completed Bot task separately from the raw process log, and make Telegram task result retrieval return the final result instead of raw process output.

### 14.2 Scope

Include:

- Continue writing full process output to `logs/<task_id>.log` on disk.
- Extract a final result from task logs when a task finishes.
- Persist the extracted final result in the task metadata in `runtime_state.json`.
- Redact secrets from the extracted final result before it is stored or returned to Telegram.
- Bound the stored and returned final result to the existing Telegram response limit.
- Change `/logs <task_id>` so Telegram returns the stored final result for finished tasks.
- Make `/logs <task_id>` avoid returning raw process log tail content to Telegram.
- For running or stopping tasks, make `/logs <task_id>` return task status and a message that the final result is not available yet.
- Preserve local log files for debugging outside Telegram.
- Add tests for final result extraction from Codex logs that include tool output before the final answer.
- Add tests proving `/logs <task_id>` returns the final result and not raw process log lines.

Exclude:

- Do not remove local log files.
- Do not add Telegram access to arbitrary raw log content.
- Do not add a new command name.
- Do not change task IDs.
- Do not change task spawning commands.

### 14.3 Core Concepts

Raw task log is the full local audit trail stored under `logs/`.

Final task result is the last user-facing answer extracted from raw process output after tool output and internal execution traces are removed.

Telegram task result retrieval must show the final task result and must not stream raw process logs.

### 14.4 Core Flow

1. User starts `/ask`, `/work`, `/continue`, or `/run_orch`.
2. The task executor writes stdout and stderr to `logs/<task_id>.log`.
3. When the child process exits, the task executor reads the local log file.
4. The task executor extracts the final user-facing result from the log.
5. The task executor redacts secrets and bounds the final result.
6. The task executor stores the final result in the task metadata.
7. User sends `/logs <task_id>`.
8. Telegram receives the final result for finished tasks.

### 14.5 Constraints

- `/logs <task_id>` must not return raw `exec`, `sed`, `rg`, source-code, test-output, or diff log sections for finished tasks when a final result exists.
- `/logs <task_id>` must return `Task is <status>. Final result is not available yet.` for `running` and `stopping` tasks.
- Finished tasks with no extractable result must return `(no final result for <task_id>)`.
- Final result extraction must handle Codex logs containing `codex` answer markers followed by duplicated final text and trailing `tokens used` lines.
- Secret redaction rules used for Telegram responses must apply to stored final results.

### 14.6 Acceptance Criteria

- Task metadata supports a `finalResult` string for completed tasks.
- `readTaskLog` returns task final result for `succeeded`, `failed`, and `stopped` tasks.
- `readTaskLog` does not return raw process log tail content for finished tasks.
- Unit tests cover extracting the final answer from a Codex log containing command output before the final answer.
- Unit tests cover running-task `/logs` response.
- Unit tests cover fallback when no final result can be extracted.
- `./init.sh` passes.

### 14.7 Verification Plan

- Run `npm run test:unit`.
- Run `npm run test:harness`.
- Run `npm run test:contract`.
- Run `./init.sh`.

## 15. Automatic Telegram Task Completion Push Requirements

### 15.1 Goal

When a Bot-started task finishes, automatically send the task final result to the Telegram chat that started the task.

### 15.2 Scope

Include:

- Record the originating Telegram `chatId` in task metadata when `/ask`, `/work`, `/continue`, or `/run_orch` starts a task.
- Preserve the existing immediate task-start response with task ID.
- After the task reaches `succeeded`, `failed`, or `stopped`, send one Telegram `sendMessage` to the originating chat.
- The automatic completion message must include the task ID, final task status, and stored `finalResult` when present.
- When `finalResult` is empty, the automatic completion message must include `(no final result for <task_id>)`.
- Bound and redact the automatic completion message using the same Telegram response limits and secret redaction rules as other Bot responses.
- Keep `/logs <task_id>` available for explicit retrieval of the stored final result.
- Add automated tests for polling mode completion push with fake Telegram API calls.
- Add automated tests that task completion push uses the originating chat ID and does not send raw process logs.

Exclude:

- Do not block the original Telegram update until the task finishes.
- Do not auto-push raw process logs.
- Do not add a new command.
- Do not remove `/logs`.
- Do not change task IDs.
- Do not send automatic completion messages to chats other than the originating chat.

### 15.3 Core Concepts

Originating chat is the authorized Telegram chat that sent the command which created the task.

Task start response confirms that the task was accepted.

Task completion push is a separate asynchronous Telegram message sent after the task process exits.

### 15.4 Core Flow

1. User sends `/ask <question>`, `/work <requirement>`, `/continue <instruction>`, or `/run_orch <rounds>`.
2. The app starts the task and records the originating `chatId` in the task metadata.
3. The app returns the existing task-start response immediately.
4. The task executor captures the final result when the child process exits.
5. The transport sends a Telegram completion message to the recorded `chatId`.
6. The completion message contains the task ID, final status, and final result fallback.
7. User can still call `/logs <task_id>` to retrieve the stored final result.

### 15.5 Constraints

- Automatic completion push must not delay the response to the original command.
- Telegram send failures during completion push must not change task final status.
- Completion push must be attempted once per task completion in the running process.
- Completion push must not include raw log lines such as `exec`, `rg`, `sed`, source code, diffs, or test output when `finalResult` exists.
- Completion push must respect the existing Telegram response limit.

### 15.6 Acceptance Criteria

- Task metadata includes `chatId` for tasks started from Telegram commands.
- Task completion invokes a configured completion callback after task finalization.
- Polling transport sends an automatic Telegram message to the originating chat after a task completes.
- Automatic completion message includes task ID, status, and final result.
- Automatic completion message uses the no-result fallback when `finalResult` is empty.
- Tests prove automatic completion push does not include raw process log content when `finalResult` exists.
- `./init.sh` passes.

### 15.7 Verification Plan

- Run `npm run test:unit`.
- Run `npm run test:harness`.
- Run `npm run test:contract`.
- Run `./init.sh`.

## 16. Codex Final Result Duplicate Suppression Requirements

### 16.1 Goal

Ensure `extractFinalResultFromLog` returns one copy of the final Codex answer when Codex CLI output contains a `tokens used` block followed by a duplicate copy of the same final answer.

### 16.2 Scope

Include:

- Detect Codex log output where the final answer appears before and after a `tokens used` block.
- Remove the `tokens used` block from the extracted final result.
- Return exactly one copy of the final answer when the text before and after the `tokens used` block is identical after trimming surrounding blank lines.
- Preserve existing final-result extraction behavior for logs without duplicated final answers.
- Preserve existing duplicate suppression for adjacent repeated final answer blocks.
- Add unit test coverage for a Codex log that contains final answer text, a `tokens used` block, a token count line, and the same final answer text again.
- Add unit test coverage proving the extracted final result does not include `tokens used` or the token count line.

Exclude:

- Do not change task spawning behavior.
- Do not change Telegram command handling.
- Do not change automatic completion push formatting.
- Do not change raw local log persistence.
- Do not remove `/logs`.

### 16.3 Core Concepts

Final answer is the assistant-facing answer text that follows the last Codex answer marker in the process log.

Token usage block is a Codex CLI reporting block that starts with `tokens used` and may include a numeric token count on the next line.

Duplicate final answer is the same answer text appearing on both sides of a token usage block in the extracted final-result region.

### 16.4 Core Flow

1. A task finishes and the task executor calls `extractFinalResultFromLog`.
2. The extractor finds the last Codex answer marker.
3. The extractor collects candidate final-result lines after that marker.
4. The extractor removes trailing process metadata and token usage reporting.
5. When the remaining candidate contains two identical answer blocks separated only by token usage reporting and blank lines, the extractor returns the first answer block.
6. The stored `finalResult`, `/logs`, and completion push use the deduplicated final answer.

### 16.5 Constraints

- The returned `finalResult` must not contain `tokens used`.
- The returned `finalResult` must not contain the numeric token count line from the token usage block.
- The extractor must not remove legitimate answer text that is not duplicated around a token usage block.
- The fix must be covered by unit tests in `test/unit/task-executor.test.js`.
- The repository must remain runnable through `./init.sh`.

### 16.6 Acceptance Criteria

- A Codex log containing `answer`, `tokens used`, token count, and the same `answer` returns one `answer`.
- The extracted result for that log does not include `tokens used`.
- The extracted result for that log does not include the token count line.
- Existing `extractFinalResultFromLog` tests continue to pass.
- `./init.sh` passes.

### 16.7 Verification Plan

- Run `npm run test:unit`.
- Run `./init.sh`.

## 17. Codex Ask Session Requirements

### 17.1 Goal

Make `/ask` behave as a Telegram entry point into a Codex ask session for the selected repository, so follow-up `/ask` messages continue the current chat-and-repository session instead of starting unrelated one-shot conversations.

### 17.2 Scope

Include:

- Add durable runtime metadata for ask session bindings keyed by authorized Telegram `chatId` and selected repository alias.
- Extract and persist the Codex session ID from ask task output when a Codex ask task creates or resumes a session.
- Preserve task metadata for each ask invocation, including task ID, status, final result, originating chat ID, selected repository alias, and Codex session ID when known.
- Change plain `/ask <message>` so it resumes the current ask session for the current `chatId` and selected repository when a binding exists.
- Change plain `/ask <message>` so it creates a new Codex ask session when no binding exists.
- Bind the current `chatId` and selected repository to a newly created Codex ask session after the session ID is known.
- Add `/ask new <message>` to force creation of a new Codex ask session and replace the current binding for the current `chatId` and selected repository.
- Add `/ask resume <session_id> <message>` to bind the current `chatId` and selected repository to the provided Codex session ID and send the message to that session.
- Add `/ask resume --last <message>` to resume Codex CLI's most recent session through `codex exec resume --last`.
- Add `/ask exit` to remove the current ask session binding for the current `chatId` and selected repository without deleting Codex session files.
- Add `/ask session` to show the current ask session binding for the current `chatId` and selected repository.
- Add a parser rule for literal user questions that begin with reserved ask subcommand words: `/ask -- <message>` must treat `<message>` as a normal question.
- Enhance `/status` output to show Codex session IDs for tasks that have them.
- Enhance `/logs <task_id>` output to show the Codex session ID for tasks that have one.
- Keep `/work`, `/continue`, and `/run_orch` as task-based workflow commands and do not convert them to chat sessions.

Exclude:

- Do not store Telegram message history as the source of ask context.
- Do not simulate conversation context by concatenating previous final results into prompts.
- Do not delete Codex session files.
- Do not change repository workflow rules for `/work`, `/continue`, or `/run_orch`.
- Do not allow ask sessions to cross authorized chat boundaries.
- Do not allow ask sessions to cross selected repository aliases by default.

### 17.3 Core Concepts

Ask session binding is runtime metadata that maps one authorized Telegram chat and one selected repository alias to one Codex session ID.

Codex session ID is the identifier used by Codex CLI resume commands to continue an existing Codex conversation.

Plain ask is `/ask <message>` with no recognized ask subcommand. Plain ask sends the message to the current binding when one exists, and creates a new session when no binding exists.

Ask subcommands are reserved first tokens after `/ask`: `new`, `resume`, `exit`, and `session`.

Literal ask escape is `/ask -- <message>`, which treats `<message>` as the user question even when it begins with a reserved ask subcommand word.

Workflow commands are `/work`, `/continue`, and `/run_orch`. Workflow commands reconstruct context from repository files and git history, not from Codex ask sessions.

### 17.4 Core Flows

Plain ask with no existing binding:

1. User selects a repository with `/use <repo>`.
2. User sends `/ask <message>`.
3. The app starts a Codex ask task in the selected repository.
4. The app records the task with type `ask`, originating `chatId`, selected repository alias, and no session ID until one is discovered.
5. The app returns the existing immediate task-start response.
6. When task output contains a Codex session ID, the app stores it on the task metadata.
7. The app stores or updates the ask session binding for the current `chatId` and repository alias.

Plain ask with an existing binding:

1. User sends `/ask <follow-up>`.
2. The app finds the current ask session binding for the current `chatId` and selected repository alias.
3. The app starts a task using `codex exec resume <session_id> <follow-up>` in the selected repository.
4. The app records the task with the bound Codex session ID.
5. The completion push and `/logs` return the final result for that follow-up task.

New ask session:

1. User sends `/ask new <message>`.
2. The app starts a new Codex ask task without resuming the existing binding.
3. When the new task exposes a Codex session ID, the app replaces the binding for the current `chatId` and selected repository alias.

Resume specific ask session:

1. User sends `/ask resume <session_id> <message>`.
2. The app validates the session ID syntax.
3. The app stores the binding for the current `chatId` and selected repository alias.
4. The app starts a task using `codex exec resume <session_id> <message>`.

Resume last ask session:

1. User sends `/ask resume --last <message>`.
2. The app starts a task using `codex exec resume --last <message>`.
3. When the task output contains a Codex session ID, the app stores it as the binding for the current `chatId` and selected repository alias.

Exit ask session:

1. User sends `/ask exit`.
2. The app removes the binding for the current `chatId` and selected repository alias.
3. The app returns a confirmation containing the repository alias.
4. The Codex session remains resumable by explicit session ID outside the binding.

Show ask session:

1. User sends `/ask session`.
2. The app returns the current binding for the current `chatId` and selected repository alias.
3. When no binding exists, the app returns an explicit no-session-selected response.

### 17.5 Constraints

- Ask session state must live in `runtime_state.json`.
- Ask session state must preserve existing `currentRepo`, `cwd`, `tasks`, and `telegramUpdateOffset` fields.
- Ask session keys must include `chatId` and repository alias.
- Plain `/ask <message>` must not resume a session bound to another chat.
- Plain `/ask <message>` must not resume a session bound to another repository alias.
- `/ask resume --last` must document and return that `--last` uses Codex CLI's most recent session in the runtime user account.
- Ask session commands must still require a selected workspace.
- Ask session task spawning must keep shell execution disabled.
- `/work`, `/continue`, and `/run_orch` must keep their current commands and concurrency rules.
- Unit, harness, and contract tests must cover ask subcommand parsing, binding persistence, resume command argv, exit behavior, and status/log session display.

### 17.6 Acceptance Criteria

- `runtime_state.json` supports ask session bindings without losing existing runtime state fields.
- `/ask <message>` with no binding starts a new Codex ask task.
- `/ask <message>` with an existing binding starts `codex exec resume <session_id> <message>`.
- `/ask new <message>` starts a new Codex ask task and replaces the current binding when the new session ID is discovered.
- `/ask resume <session_id> <message>` stores the binding and starts `codex exec resume <session_id> <message>`.
- `/ask resume --last <message>` starts `codex exec resume --last <message>` and stores the discovered session ID when available.
- `/ask exit` removes only the current `chatId` and repository alias binding.
- `/ask session` reports the current binding or an explicit no-session-selected response.
- `/ask -- new architecture means what?` is treated as a normal ask message, not an ask subcommand.
- `/status` includes Codex session IDs for tasks that have them.
- `/logs <task_id>` includes the Codex session ID for tasks that have one.
- `/work`, `/continue`, and `/run_orch` behavior remains unchanged.
- `./init.sh` passes.

### 17.7 Subfeatures

- F027: Add ask session runtime schema, session ID extraction, task metadata persistence, and state validation.
- F028: Make plain `/ask <message>` session-aware for current chat and repository.
- F029: Add `/ask new`, `/ask resume`, `/ask exit`, `/ask session`, and `/ask --` parsing and behavior.
- F030: Show Codex session IDs in `/status` and `/logs` for tasks that have them.
- F031: Preserve `/work`, `/continue`, and `/run_orch` task-model behavior with regression tests while ask sessions are added.

### 17.8 Verification Plan

- Run `npm run test:unit`.
- Run `npm run test:harness`.
- Run `npm run test:contract`.
- Run `./init.sh`.

## 18. Codex Structured Session Metadata Requirements

### 18.1 Goal

Make `/ask` session binding use Codex CLI structured metadata instead of scanning human-readable final answer text, so follow-up `/ask` commands resume the real Codex session for the selected Telegram chat and repository.

### 18.2 Scope

Include:

- Use Codex CLI JSONL output for `/ask`, `/ask new`, `/ask resume <session_id> <message>`, and `/ask resume --last <message>` tasks.
- Extract `codexSessionId` only from trusted Codex CLI structured event metadata or from the initial Codex CLI session metadata line before assistant answer content begins.
- Prevent assistant final answers, source code, tests, README text, SPEC text, command output, and log tail text from overriding the real Codex session ID.
- Preserve complete local task logs for debugging.
- Preserve the existing `finalResult` behavior for Telegram completion pushes and `/logs <task_id>`.
- Add a regression test where the log contains a real Codex session ID before assistant answer content and a fake `Codex session: session_run123` string inside the assistant answer, and the persisted binding keeps the real session ID.
- Add tests proving resumed `/ask` task-start responses include the Codex session ID and make it clear the task is a resumed ask invocation.

Exclude:

- Do not implement Telegram approval decisions.
- Do not change `/work`, `/continue`, or `/run_orch` task behavior.
- Do not remove raw task logs.
- Do not make `task_id` equal to Codex session ID.
- Do not store Telegram message history as ask context.

### 18.3 Core Concepts

Task ID is the Bot-local process execution identifier. Every `/ask` invocation creates a new task ID.

Codex session ID is the Codex CLI conversation identifier used by `codex exec resume`.

Trusted session metadata is Codex CLI machine-readable JSONL metadata or the CLI startup metadata emitted before assistant answer content starts.

Assistant answer text is not trusted session metadata.

### 18.4 Core Flows

New ask session:

1. User sends `/ask <message>` or `/ask new <message>` with no selected binding for the current chat and repository.
2. The app starts `codex exec` with JSONL output enabled.
3. The task executor records the Bot task ID immediately.
4. The task executor extracts the Codex session ID from trusted CLI metadata.
5. The task executor stores the Codex session ID on the task and updates the ask session binding.
6. The completion push returns the final result without exposing raw JSONL or raw process logs.

Follow-up ask:

1. User sends `/ask <message>` with an existing binding.
2. The app starts `codex exec resume <session_id> <message>` with JSONL output enabled.
3. The immediate Telegram response includes the new Bot task ID, the bound Codex session ID, and that the ask task is resumed.
4. The task executor ignores fake session-looking text in assistant output.
5. The ask session binding remains the real Codex session ID unless trusted CLI metadata provides a newer real Codex session ID for that run.

### 18.5 Constraints

- Session extraction must not scan assistant answer text as authoritative metadata.
- Fake session-looking strings in final answers must not update `runtime_state.json`.
- `task_id` must remain a Bot-local task identifier.
- `/ask` must keep shell execution disabled.
- The repository must remain runnable through `./init.sh`.

### 18.6 Acceptance Criteria

- A log with `session id: 019e254f-ebfa-7053-9302-32a6ade18036` before assistant output and `Codex session: session_run123` inside assistant output returns `019e254f-ebfa-7053-9302-32a6ade18036`.
- The same log does not return `session_run123`.
- A completed ask task with fake assistant session text persists the real Codex session ID in `runtime_state.json`.
- A follow-up `/ask <message>` with an existing binding starts `codex exec resume <real_session_id> <message>`.
- The immediate response for a resumed ask includes the Codex session ID and a resumed-mode indicator.
- Existing unit, harness, contract, and smoke checks pass.
- `./init.sh` passes.

### 18.7 Verification Plan

- Run focused unit tests for session extraction and ask resume responses.
- Run focused harness tests for `/ask` resume behavior.
- Run `./init.sh`.

## 19. Codex JSONL Final Result Extraction Requirements

### 19.1 Goal

Make completed `/ask` tasks return the final user-facing Codex answer when Codex CLI emits JSONL output, instead of reporting `(no final result for <task_id>)` for successful tasks.

### 19.2 Scope

Include:

- Extract `finalResult` from Codex CLI JSONL events that contain assistant or agent message text.
- Prefer the last completed assistant or agent message as the user-facing final result for JSONL task logs.
- Ignore JSONL command execution events, aggregated command output, raw source output, test output, diffs, and internal metadata when computing `finalResult`.
- Preserve existing plain-text final result extraction behavior for non-JSONL logs.
- Preserve existing token usage cleanup and duplicate final answer cleanup.
- Preserve complete raw local task logs under `logs/<task_id>.log`.
- Preserve Telegram response truncation and secret redaction.
- Add regression coverage using a real-shaped `codex exec --json resume ...` log where the final answer is stored in an `item.completed` event with `item.type="agent_message"` and `item.text`.

Exclude:

- Do not change `/ask` task spawning or session resume behavior.
- Do not change `/work`, `/continue`, or `/run_orch` task behavior.
- Do not expose raw JSONL logs in Telegram completion messages or `/logs <task_id>`.
- Do not mark successful tasks as failed only because the final result is missing.
- Do not implement streaming partial answers to Telegram.

### 19.3 Core Concepts

Raw task log is the full local audit trail and may contain Codex JSONL events, command execution output, metadata, timestamps, and exit codes.

Final task result is the final user-facing assistant or agent answer extracted from the raw task log after internal events and command output are removed.

For JSONL logs, assistant or agent message events are user-facing answer candidates. Command execution events are not final answer candidates.

### 19.4 Core Flow

1. User sends `/ask <message>` or a resumed ask command.
2. The app starts a Bot task with Codex JSONL output enabled.
3. Codex writes structured JSONL events to the raw task log.
4. The task exits with a final status.
5. The task executor extracts the last user-facing assistant or agent message from JSONL events.
6. The task executor stores the extracted text as `finalResult`.
7. The completion push and `/logs <task_id>` return the stored `finalResult` without raw JSONL, raw command output, or internal event metadata.

### 19.5 Constraints

- JSONL parsing must tolerate non-JSON metadata lines already written by the task executor, such as `startedAt=`, `cwd=`, `argv=`, `finishedAt=`, and `exitCode=`.
- JSONL parsing must skip malformed non-JSON lines instead of failing the task.
- If no JSONL final answer candidate exists, the existing fallback behavior may still return `(no final result for <task_id>)`.
- The repository must remain runnable through `./init.sh`.

### 19.6 Acceptance Criteria

- A successful `codex exec --json resume ...` task log with an `item.completed` event containing `item.type="agent_message"` and `item.text` stores that text as `finalResult`.
- When multiple assistant or agent message events exist, the last user-facing message is used as `finalResult`.
- JSONL command execution output is not included in `finalResult`.
- Raw JSONL event text is not returned by `/logs <task_id>` for finished tasks when `finalResult` exists.
- Existing plain-text `codex` answer marker extraction still works.
- Existing token usage cleanup and duplicate final answer cleanup still work for extracted final results.
- Existing unit, harness, contract, and smoke checks pass.
- `./init.sh` passes.

### 19.7 Verification Plan

- Run focused unit tests for JSONL final result extraction.
- Run task executor tests proving completion messages and `/logs <task_id>` use the stored JSONL-derived `finalResult`.
- Run `./init.sh`.

## 20. General Agent Command Surface Requirements

### 20.1 Goal

Replace the user-facing read-only `/ask` entry point with a general-purpose Codex agent command that can discuss, plan, and execute repository work while preserving repository workflow rules and removing low-level workflow commands from the public Telegram command surface.

The Bot should expose a smaller user-facing command surface where users interact with Codex through one general session command instead of choosing between `/ask`, `/work`, and `/run_orch`.

### 20.2 Scope

Include:

- Add `/agent <instruction>` as the general Codex session command for the selected repository.
- Add `/agent new <instruction>`, `/agent resume <session_id|--last> <instruction>`, `/agent exit`, `/agent session`, and `/agent -- <instruction>` equivalents for session management.
- Make `/agent` reuse the existing Codex session binding model by authorized Telegram `chatId` and selected repository alias.
- Make plain `/agent <instruction>` resume the current binding when one exists and start a new Codex session when no binding exists.
- Remove `/ask` from the public command surface, help output, command whitelist, README command surface, deployment command documentation, and BotFather command menu documentation.
- Remove `/work <requirement>` and `/run_orch <rounds>` from the public command surface, help output, command whitelist, README command surface, deployment command documentation, and BotFather command menu documentation.
- Reject `/ask`, `/work`, and `/run_orch` as unknown commands after the public surface is changed.
- Keep `/continue <instruction>` available as an explicit repository-state recovery command.
- Keep `/status`, `/logs <task_id>`, `/stop <task_id>`, and approval commands available.
- Update task metadata and user-visible labels so general-agent tasks are distinguishable from legacy read-only ask tasks.
- Preserve existing Codex JSONL session metadata extraction and final result extraction.
- Preserve task logging, completion pushes, Telegram truncation, secret redaction, repository whitelist checks, and shell-disabled process spawning.
- Update automated unit, harness, contract, and documentation-related tests for the new public command surface.

Exclude:

- Do not expose `/work` or `/run_orch` as aliases.
- Do not expose arbitrary shell execution.
- Do not allow free-form workspace paths.
- Do not remove `orchestrator.py`; it remains the repository workflow implementation mechanism available to Codex agents when AGENTS.md requires it.
- Do not make the Bot itself decide feature lifecycle state outside the existing orchestrator and agent workflow.
- Do not store Telegram message history as repository source of truth.

### 20.3 Core Concepts

`/agent` is the user-facing Codex interaction entry point. It may be used for discussion-only requests or implementation requests.

Discussion-only requests must not modify files.

Implementation requests must follow the selected repository's `AGENTS.md` and use repository files and git history as the durable source of truth.

The selected repository's workflow files, not Telegram chat history, remain the source of truth for durable planning, implementation, evaluation, and progress state.

`/work` and `/run_orch` are low-level workflow controls and must not be part of the user-facing Telegram command surface.

### 20.4 Prompt Requirements

The `/agent` prompt must not contain the old read-only restrictions that categorically forbid file edits, `SPEC.md` updates, `feature_list.json` updates, `orchestrator.py`, or commits.

The `/agent` prompt must require:

```text
Act as a Codex agent for the selected repository.

Rules:
- Treat repository files and git history as the durable source of truth.
- Follow AGENTS.md when modifying files or running repository workflow tasks.
- For discussion-only requests, do not modify files.
- For implementation requests, use the repository workflow documented in AGENTS.md.
- Preserve existing repository state unless the workflow explicitly requires updates.
- Keep the system runnable.
- Summarize actions, changed files, verification, and remaining issues.
```

### 20.5 Core Flows

New general agent session:

1. User sends `/agent <instruction>` or `/agent new <instruction>` with no selected binding for the current chat and repository.
2. The app starts `codex exec --json <agent_prompt>`.
3. The task executor records the Bot task ID immediately.
4. The task executor extracts the Codex session ID from trusted CLI metadata.
5. The task executor stores the Codex session ID on the task and updates the session binding.
6. The completion push returns the final result without exposing raw JSONL or raw process logs.

Follow-up general agent instruction:

1. User sends `/agent <instruction>` with an existing binding.
2. The app starts `codex exec --json resume <session_id> <instruction>`.
3. The immediate Telegram response includes the new Bot task ID, the bound Codex session ID, and that the agent task is resumed.
4. The completion push returns the final result.

Explicit session management:

1. `/agent resume <session_id> <instruction>` stores the binding and resumes the specified Codex session.
2. `/agent resume --last <instruction>` uses Codex CLI `--last` for the runtime user account and stores the discovered session ID when available.
3. `/agent exit` clears only the current chat and repository binding.
4. `/agent session` reports the current binding or an explicit no-session-selected response.
5. `/agent -- <instruction>` treats reserved subcommand words as literal instruction text.

Removed public commands:

1. User sends `/ask <message>`.
2. The Bot returns the unknown command response.
3. User sends `/work <requirement>`.
4. The Bot returns the unknown command response.
5. User sends `/run_orch <rounds>`.
6. The Bot returns the unknown command response.

### 20.6 Constraints

- `/agent` must require a selected workspace.
- `/agent` must keep shell execution disabled.
- `/agent` must keep the 10 minute timeout unless a later requirement changes task timeout policy.
- `/agent` must preserve the existing task final result behavior.
- `/agent` must preserve existing approval command behavior.
- Public help and contract tests must list the new command surface exactly.
- Existing runtime state must normalize safely when legacy `askSessions` or legacy ask task records are present.
- The repository must remain runnable through `./init.sh`.

### 20.7 Acceptance Criteria

- `/agent <instruction>` starts a Codex JSONL task in the selected workspace.
- `/agent <instruction>` with an existing binding resumes `codex exec --json resume <session_id> <instruction>`.
- `/agent new <instruction>` forces a new Codex session.
- `/agent resume <session_id> <instruction>` resumes and binds the specified session.
- `/agent resume --last <instruction>` uses Codex CLI `resume --last`.
- `/agent exit` clears only the current chat and repository binding.
- `/agent session` reports the current binding or explicit no-session-selected response.
- `/agent -- new ...` treats `new` as literal instruction text.
- `/agent` prompts no longer categorically forbid file edits, `SPEC.md`, `feature_list.json`, `orchestrator.py`, or commits.
- `/agent` prompts require following `AGENTS.md` for implementation requests.
- `/ask` returns `Unknown command.\nUse /help.`.
- `/work` returns `Unknown command.\nUse /help.`.
- `/run_orch` returns `Unknown command.\nUse /help.`.
- `/help` lists `/agent` and does not list `/ask`, `/work`, or `/run_orch`.
- README and deployment documentation no longer present `/ask`, `/work`, or `/run_orch` as user-facing commands.
- Existing task status, logs, stop, approval, workspace, webhook, and polling behavior remains functional.
- Existing unit, harness, contract, and smoke checks pass.
- `./init.sh` passes.

### 20.8 Verification Plan

- Run focused unit tests for `/agent` parsing, prompt rules, task argv, session binding, and legacy command rejection.
- Run harness tests for Telegram command handling and help output.
- Run contract tests for exact command whitelist and help output.
- Run `./init.sh`.

## 21. Agent Task Timeout Policy Requirements

### 21.1 Goal

Prevent long-running `/agent` implementation workflows from being killed after the old read-only ask timeout.

The `/agent` command is now a general-purpose Codex repository command that may plan, edit files, run tests, invoke repository workflow scripts, wait for approval, and summarize results. A fixed 10 minute timeout is too short for this use case.

### 21.2 Scope

Include:

- Change `/agent` tasks so they do not use the legacy 10 minute ask timeout by default.
- Add environment configuration for agent task timeout.
- Keep `/continue` tasks without a forced timeout.
- Preserve `/stop <task_id>` as the explicit user-controlled termination mechanism for long-running tasks.
- Preserve task metadata, final result extraction, completion pushes, approval bridging, secret redaction, Telegram truncation, and shell-disabled process spawning.
- Update README and deployment documentation to describe the new timeout behavior.
- Add automated coverage proving default `/agent` tasks have no forced timeout and configured `/agent` timeout values are honored.

Exclude:

- Do not reintroduce `/ask`.
- Do not change `/continue` timeout behavior.
- Do not remove `/stop`.
- Do not add streaming partial output.
- Do not change orchestrator or evaluator timeout behavior inside target repositories.

### 21.3 Configuration

The timeout environment variable must be:

```text
AGENT_TASK_TIMEOUT_MS
```

When `AGENT_TASK_TIMEOUT_MS` is unset or empty, `/agent` tasks must use `timeoutMs: null`.

When `AGENT_TASK_TIMEOUT_MS` is set, it must parse as a positive integer number of milliseconds.

Startup must fail with exit code `1` when `AGENT_TASK_TIMEOUT_MS` is set to a non-integer, zero, or negative value.

### 21.4 Core Flow

Default `/agent` task:

1. User sends `/agent <instruction>`.
2. The app starts a Codex task in the selected workspace.
3. The task metadata records normal task details.
4. The task has no forced timeout.
5. The task runs until Codex exits or the user sends `/stop <task_id>`.

Configured timeout:

1. Runtime starts with `AGENT_TASK_TIMEOUT_MS=3600000`.
2. User sends `/agent <instruction>`.
3. The app starts a Codex task with `timeoutMs=3600000`.
4. If the task exceeds that timeout, the existing task timeout handling terminates the child and records timeout metadata.

### 21.5 Constraints

- `/agent` default timeout must not be inherited from the old read-only ask timeout.
- Invalid `AGENT_TASK_TIMEOUT_MS` values must be rejected during startup instead of being silently ignored.
- `/agent` session commands, including `new`, `resume`, and `resume --last`, must all use the same timeout policy.
- The repository must remain runnable through `./init.sh`.

### 21.6 Acceptance Criteria

- `/agent <instruction>` starts with `timeoutMs: null` when `AGENT_TASK_TIMEOUT_MS` is unset.
- `/agent new <instruction>` starts with `timeoutMs: null` when `AGENT_TASK_TIMEOUT_MS` is unset.
- `/agent resume <session_id> <instruction>` starts with `timeoutMs: null` when `AGENT_TASK_TIMEOUT_MS` is unset.
- `/agent resume --last <instruction>` starts with `timeoutMs: null` when `AGENT_TASK_TIMEOUT_MS` is unset.
- When `AGENT_TASK_TIMEOUT_MS=3600000`, `/agent` task start requests use `timeoutMs=3600000`.
- Startup rejects invalid `AGENT_TASK_TIMEOUT_MS` values with a clear error.
- `/continue` remains `timeoutMs: null`.
- `/stop <task_id>` remains available for user-initiated termination.
- README and deployment documentation describe the default no-timeout `/agent` behavior and timeout environment variable.
- Existing unit, harness, contract, and smoke checks pass.
- `./init.sh` passes.

### 21.7 Verification Plan

- Run focused unit tests for timeout configuration parsing.
- Run focused `/agent` unit and harness tests for default and configured timeout values.
- Run startup configuration tests for invalid timeout values.
- Run `./init.sh`.
