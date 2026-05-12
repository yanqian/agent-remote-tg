# Remote Agent Control Plane SPEC

## 1. Goal

Build a local Telegram Bot that lets the owner control long-running agent workflows from a phone.

The system must provide a mobile control plane for existing repositories that already use `AGENTS.md`, `feature_list.json`, `progress.md`, `init.sh`, and `orchestrator.py`.

The Bot must keep all durable development state inside the target repository. Telegram messages, Bot runtime files, process logs, and task metadata are runtime artifacts only. They must not become the source of truth for requirements, feature completion, tests, or project progress.

Primary outcome:

```text
Phone command
  -> Telegram Bot
  -> validated local workspace
  -> Codex or orchestrator process
  -> repository state files and git history
```

## 2. Scope

### 2.1 Included

The delivered system must implement these capabilities:

- Receive Telegram messages through a Bot token.
- Reject messages from chat IDs not listed in `ALLOWED_CHAT_IDS`.
- Maintain a selected workspace from a fixed repository whitelist.
- Show the selected workspace path.
- List files in the selected workspace root.
- Show branch, short git status, and recent commits for the selected workspace.
- Run read-only Codex discussion tasks through `/ask`.
- Run long-running development tasks through `/work`.
- Continue or recover repository-driven work through `/continue`.
- Run the target repository orchestrator through `/run-orch`.
- Track Bot-started tasks with task ID, command type, status, PID, workspace, log path, start time, and finish time.
- Persist Bot runtime state in `runtime_state.json`.
- Persist full task output under `logs/`.
- Return bounded Telegram responses and direct the user to `/logs <task_id>` for long output.
- Stop Bot-started tasks through `/stop`.
- Expose `/help` with the exact command set.
- Provide automated tests for command parsing, authorization, workspace lookup, runtime state, task spawning, log truncation, and spec-contract rules.

### 2.2 Excluded

The delivered system must not implement these capabilities:

- Arbitrary shell execution.
- Interactive remote shell.
- Free-form filesystem browsing outside whitelisted repositories.
- Feature lifecycle management inside the Bot.
- Coding Agent implementation inside the Bot.
- Evaluator Agent implementation inside the Bot.
- Direct Bot edits to target repository `feature_list.json`.
- Direct Bot edits to target repository `progress.md`.
- Direct Bot edits to target repository `SPEC.md`.
- Direct Bot commits to target repositories except through a spawned Codex workflow that follows that repository's `AGENTS.md`.
- `/run-feature`.
- `/eval-feature`.
- Web dashboard.
- Slack, Discord, email, or browser control adapters.
- Multi-user role management.
- Cloud deployment automation.
- Scheduled task execution.
- Parallel work tasks in the same workspace.

## 3. Core Concepts

### 3.1 Control Plane

The Bot is a control plane. It accepts validated user intent, starts local processes, stores runtime task metadata, stores logs, and returns summaries.

The Bot must not decide which feature is next, whether a feature passes, how feature state changes, or when a target repository is complete. Those decisions belong to the target repository workflow.

### 3.2 Target Repository

A target repository is a local directory listed in the Bot repository whitelist. A target repository is agent-workflow ready only when all of these files exist at its root:

- `AGENTS.md`
- `feature_list.json`
- `progress.md`
- `init.sh`
- `orchestrator.py`

`/work`, `/continue`, and `/run-orch` must fail before spawning any development process when the selected workspace lacks one or more required files.

### 3.3 Repository Source Of Truth

The target repository source of truth consists of:

- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `test_plan.md`
- `init.sh`
- `orchestrator.py`
- git history

The Bot must not duplicate feature state from these files into `runtime_state.json`. `runtime_state.json` stores only the selected workspace and Bot task metadata.

### 3.4 Workspace

A workspace is the currently selected target repository. The Bot must store it as:

```json
{
  "currentRepo": "agent-runtime",
  "cwd": "/Users/armstrong/projects/agent-runtime"
}
```

`currentRepo` must be a key from the repository whitelist. `cwd` must equal the whitelist value for that key after path normalization.

### 3.5 Task

A task is a Bot-started local process. Each task must have this shape in `runtime_state.json`:

```json
{
  "taskId": "task_20260512_160405_001",
  "type": "work",
  "status": "running",
  "pid": 12345,
  "cwd": "/Users/armstrong/projects/agent-runtime",
  "logPath": "logs/task_20260512_160405_001.log",
  "startedAt": "2026-05-12T08:04:05Z",
  "finishedAt": null,
  "exitCode": null
}
```

Allowed task statuses:

- `running`
- `stopping`
- `stopped`
- `succeeded`
- `failed`

Allowed task types:

- `ask`
- `work`
- `continue`
- `run-orch`

## 4. Core Flows

### 4.1 Authorization Flow

For every inbound Telegram message:

1. Read `ALLOWED_CHAT_IDS`.
2. Parse it as a comma-separated list of decimal chat IDs.
3. Compare the incoming chat ID as a string.
4. Reject the message when the ID is absent.
5. Process the command only when the ID is present.

Rejection response:

```text
Unauthorized chat.
```

`ALLOWED_CHAT_IDS` must be non-empty outside automated tests. Process startup must fail when `ALLOWED_CHAT_IDS` is empty and `NODE_ENV` is not `test`.

### 4.2 Workspace Selection Flow

Command:

```text
/use <repo>
```

Required behavior:

1. Load the repository whitelist.
2. Reject `<repo>` when it is not an exact whitelist key.
3. Resolve the configured path.
4. Reject the repo when the path does not exist or is not a directory.
5. Persist `currentRepo` and `cwd` in `runtime_state.json`.
6. Return the selected repo key and absolute path.

Success response format:

```text
Workspace switched:
<repo>
<absolute_path>
```

Unknown repo response:

```text
Unknown repo: <repo>
Use /repos to list available repos.
```

### 4.3 Workspace Inspection Flow

`/pwd` must return the selected workspace path.

`/ls` must list files in the selected workspace root by spawning:

```text
ls -la
```

`/git` must run these commands in the selected workspace:

```text
git branch --show-current
git status --short
git log --oneline -5
```

`/pwd`, `/ls`, and `/git` must fail when no workspace is selected.

No workspace response:

```text
No workspace selected.
Use /repos then /use <repo>.
```

### 4.4 Read-Only Discussion Flow

Command:

```text
/ask <question>
```

Required behavior:

1. Require selected workspace.
2. Create a task with type `ask`.
3. Spawn `codex exec` in the selected workspace.
4. Use a prompt that explicitly forbids file edits, orchestrator execution, feature creation, and commits.
5. Write full stdout and stderr to the task log.
6. Mark the task `succeeded` on exit code `0`.
7. Mark the task `failed` on non-zero exit.
8. Return task ID, final status, and a bounded output tail.

The `/ask` prompt must contain these rules verbatim:

```text
Rules:
- Discuss and analyze only.
- Do not modify files.
- Do not update SPEC.md.
- Do not update feature_list.json.
- Do not run orchestrator.py.
- Do not commit.
```

### 4.5 Work Flow

Command:

```text
/work <requirement>
```

Required behavior:

1. Require selected workspace.
2. Verify the workspace is agent-workflow ready.
3. Reject the command when a `work`, `continue`, or `run-orch` task is already `running` or `stopping` in the selected workspace.
4. Create a task with type `work`.
5. Spawn `codex exec` in the selected workspace.
6. Use a prompt that delegates planning and execution to the repository workflow.
7. Write full stdout and stderr to the task log.
8. Mark the task `succeeded` on exit code `0`.
9. Mark the task `failed` on non-zero exit.
10. Return task ID, final status, and a bounded output tail.

The `/work` prompt must require this sequence:

```text
1. Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20.
2. Run ./init.sh before changing files.
3. Determine whether the request is a new requirement or a bug fix.
4. Update SPEC.md only through the repository planning workflow.
5. Append new feature entries to feature_list.json when new work is required.
6. Preserve all existing feature IDs, ordering, passes, status, attempts, last_error, and unknown fields.
7. Validate feature_list.json as JSON.
8. Create a planning commit when planning files changed.
9. Run python3 orchestrator.py --max-rounds 1.
10. Treat the task as complete only when the orchestrator and evaluator workflow pass.
11. Summarize changed files, feature IDs, commands run, final status, and remaining issues.
```

The Bot must not parse or rewrite the target repository feature list before spawning Codex.

### 4.6 Continue Flow

Command:

```text
/continue <instruction>
```

Required behavior:

1. Require selected workspace.
2. Verify the workspace is agent-workflow ready.
3. Reject the command when a `work`, `continue`, or `run-orch` task is already `running` or `stopping` in the selected workspace.
4. Create a task with type `continue`.
5. Spawn `codex exec` in the selected workspace.
6. Use a prompt that reconstructs state from repository files and forbids reliance on Telegram history.
7. Write full stdout and stderr to the task log.
8. Persist final task status and exit code.

The `/continue` prompt must contain:

```text
Do not rely on chat history.
Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20 before deciding the next action.
Run ./init.sh before changing files.
Use orchestrator.py according to AGENTS.md when implementation or evaluation is required.
Do not overwrite feature_list.json.
Do not reset existing feature state.
Stop and report exact conflicts when repository state is unsafe.
```

### 4.7 Orchestrator Flow

Command:

```text
/run-orch <rounds>
```

Required behavior:

1. Require selected workspace.
2. Verify the workspace is agent-workflow ready.
3. Parse `<rounds>` as a base-10 integer.
4. Reject values outside `1..5`.
5. Reject the command when a `work`, `continue`, or `run-orch` task is already `running` or `stopping` in the selected workspace.
6. Create a task with type `run-orch`.
7. Spawn this exact command in the selected workspace with shell disabled:

```text
python3 orchestrator.py --max-rounds <rounds>
```

Invalid rounds response:

```text
Invalid rounds. Use an integer from 1 to 5.
```

### 4.8 Status Flow

Command:

```text
/status
```

Required behavior:

1. Load task metadata from `runtime_state.json`.
2. Refresh statuses for live PIDs owned by the Bot process.
3. Return all `running` and `stopping` tasks.
4. Return the five most recent finished tasks.

Response format:

```text
Current tasks:

<task_id>
type: <type>
status: <status>
pid: <pid>
cwd: <cwd>
startedAt: <timestamp>
finishedAt: <timestamp_or_null>
exitCode: <exit_code_or_null>
```

### 4.9 Logs Flow

Command:

```text
/logs <task_id>
```

Required behavior:

1. Look up `<task_id>` in `runtime_state.json`.
2. Reject unknown task IDs.
3. Verify the log path belongs to the Bot `logs/` directory.
4. Return the last 120 lines.
5. Truncate the Telegram message to the configured response limit.

Unknown task response:

```text
Unknown task: <task_id>
```

### 4.10 Stop Flow

Command:

```text
/stop <task_id>
```

Required behavior:

1. Look up `<task_id>` in `runtime_state.json`.
2. Reject unknown task IDs.
3. Reject tasks whose status is not `running`.
4. Send `SIGTERM` only to the recorded PID for that task.
5. Mark the task `stopping`.
6. Mark the task `stopped` when the process exits due to the stop request.
7. Preserve the task log.

The Bot must not stop a process that was not started and recorded by the Bot.

### 4.11 Help Flow

Command:

```text
/help
```

Response must list exactly these commands:

```text
Workspace:
- /repos
- /use <repo>
- /pwd
- /ls
- /git

Discussion:
- /ask <question>

Workflow:
- /work <requirement>
- /continue <instruction>
- /run-orch <rounds>

Task:
- /status
- /logs <task_id>
- /stop <task_id>
- /help
```

## 5. Command Interface

The Bot must recognize exactly these commands:

- `/repos`
- `/use <repo>`
- `/pwd`
- `/ls`
- `/git`
- `/ask <question>`
- `/work <requirement>`
- `/continue <instruction>`
- `/run-orch <rounds>`
- `/status`
- `/logs <task_id>`
- `/stop <task_id>`
- `/help`

Any other leading slash command must return:

```text
Unknown command.
Use /help.
```

Arguments must be trimmed. Empty required arguments must be rejected with the command-specific usage string.

## 6. Runtime Files

### 6.1 `runtime_state.json`

The Bot must create `runtime_state.json` at startup when it does not exist.

Required top-level shape:

```json
{
  "currentRepo": null,
  "cwd": null,
  "tasks": {}
}
```

The Bot must write this file atomically by writing a temporary file in the same directory and renaming it into place.

### 6.2 `logs/`

The Bot must create `logs/` at startup when it does not exist.

Each task must write to:

```text
logs/<task_id>.log
```

The log must include:

- task ID
- task type
- workspace
- command and argv
- start timestamp
- stdout
- stderr
- finish timestamp
- exit code

Secrets must be redacted from Telegram responses. The Bot must redact `TELEGRAM_BOT_TOKEN` values and environment variable values whose names contain `TOKEN`, `SECRET`, `PASSWORD`, or `KEY`.

## 7. Constraints

### 7.1 Security Constraints

- The Bot must use a command whitelist.
- The Bot must use a repository whitelist.
- The Bot must spawn processes with `shell: false`.
- The Bot must pass user text as process arguments or prompt text, not as shell source.
- The Bot must reject absolute paths in `/use`.
- The Bot must reject `..` path traversal in repo aliases and task IDs.
- The Bot must not print full environment dumps to Telegram.
- The Bot must not expose Bot token values in logs or Telegram responses.

### 7.2 Process Constraints

- Only one active `work`, `continue`, or `run-orch` task is allowed per workspace.
- Multiple `ask` tasks are allowed only when they run in different workspaces.
- A process timeout must be enforced for `ask` tasks. The timeout is 10 minutes.
- `work`, `continue`, and `run-orch` tasks must not have a forced timeout.
- `/stop` is the only user command that terminates long-running tasks.

### 7.3 Output Constraints

- Telegram responses must not exceed 3500 characters.
- `/logs` must read the last 120 lines before truncation.
- Task creation responses must include the task ID and log command.
- Full process output must be persisted to the task log.

### 7.4 Repository Constraints

- The Bot must not directly edit target repository planning or progress files.
- The Bot must not treat Telegram history as project context.
- The Bot must not infer feature completion from log text except for reporting task process status.
- The Bot must not mark target repository features as done.
- The Bot must not commit target repository changes outside the spawned Codex or orchestrator workflow.

### 7.5 Implementation Constraints

- Configuration must come from environment variables and a repository whitelist file or module.
- The implementation must separate command parsing, authorization, workspace state, task execution, and Telegram transport into testable units.
- Tests must avoid real Telegram network calls.
- Tests must avoid running real Codex.
- Tests must verify spawned command argv through mocks or fakes.

## 8. Acceptance Criteria

The implementation is complete only when all criteria below pass.

### 8.1 Bot Startup

- Bot starts with a valid `TELEGRAM_BOT_TOKEN` and non-empty `ALLOWED_CHAT_IDS`.
- Bot creates `runtime_state.json` when absent.
- Bot creates `logs/` when absent.
- Bot exits with failure when `ALLOWED_CHAT_IDS` is empty outside `NODE_ENV=test`.

### 8.2 Authorization

- Authorized chat IDs run commands successfully.
- Unauthorized chat IDs receive `Unauthorized chat.`.
- Unauthorized commands do not mutate runtime state.
- Unauthorized commands do not spawn processes.

### 8.3 Workspace Commands

- `/repos` returns all configured repo aliases and absolute paths.
- `/use <repo>` persists the selected workspace.
- `/use <unknown>` returns the unknown repo error.
- `/pwd` returns the selected workspace path.
- `/pwd`, `/ls`, and `/git` return the no-workspace error when no workspace is selected.
- `/ls` runs only in the selected workspace.
- `/git` returns branch, short status, and five recent commits.

### 8.4 Discussion Command

- `/ask <question>` creates an `ask` task.
- `/ask` spawns `codex exec` in the selected workspace.
- `/ask` prompt contains every required read-only rule.
- `/ask` persists full output to the task log.
- `/ask` marks task status from the process exit code.

### 8.5 Workflow Commands

- `/work <requirement>` rejects workspaces missing agent workflow files.
- `/work` rejects concurrent active work in the same workspace.
- `/work` spawns `codex exec` in the selected workspace.
- `/work` prompt contains every required long-running workflow step.
- `/work` does not directly modify target repository state files.
- `/continue <instruction>` prompt forbids reliance on chat history.
- `/continue` verifies agent workflow files before spawning.
- `/run-orch <rounds>` accepts integers from `1` to `5`.
- `/run-orch <rounds>` rejects values outside `1..5`.
- `/run-orch 1` spawns `python3 orchestrator.py --max-rounds 1` with shell disabled.

### 8.6 Task Commands

- `/status` lists active tasks and five recent finished tasks.
- `/logs <task_id>` returns the last 120 log lines within the Telegram response limit.
- `/logs <unknown>` returns the unknown task error.
- `/stop <task_id>` sends `SIGTERM` only to a Bot-recorded running task.
- `/stop <task_id>` preserves the task log.

### 8.7 Command Surface

- `/help` lists exactly the specified commands.
- Unknown slash commands return `Unknown command.\nUse /help.`.
- The Bot does not implement `/run-feature`.
- The Bot does not implement `/eval-feature`.
- The command whitelist test fails when an undocumented command is added.

### 8.8 Persistence

- Selected workspace survives Bot process restart.
- Task metadata survives Bot process restart.
- Completed task logs remain readable after restart.
- Runtime state does not contain target repository feature objects.

## 9. Verification Plan

### 9.1 Static Verification

Run these checks:

```text
npm run lint
npm run typecheck
```

Required result:

- Both commands exit `0`.
- No TypeScript `any` is introduced in command parsing, authorization, workspace state, or task execution modules.

### 9.2 Unit Tests

Run:

```text
npm run test:unit
```

Required unit coverage:

- Command parser accepts all documented commands.
- Command parser rejects unknown commands.
- Command parser validates required arguments.
- Authorization accepts configured chat IDs.
- Authorization rejects unknown chat IDs.
- Repository lookup accepts exact aliases.
- Repository lookup rejects unknown aliases.
- Repository lookup rejects path traversal.
- Runtime state load creates default state when missing.
- Runtime state save is atomic.
- Task ID generation is deterministic under a mocked clock and sequence.
- Rounds validation accepts `1..5`.
- Rounds validation rejects non-integers and out-of-range values.
- Log truncation enforces the 3500 character Telegram limit.
- Secret redaction removes configured token and secret values.

### 9.3 Harness Tests

Run:

```text
npm run test:harness
```

Required harness coverage with fake Telegram and fake process spawner:

- `/repos` returns configured repositories.
- `/use` updates `runtime_state.json`.
- `/pwd` reads persisted workspace state.
- `/ls` spawns `ls -la` in the selected workspace.
- `/git` spawns the three required git commands in the selected workspace.
- `/ask` spawns `codex exec` with the required read-only prompt.
- `/work` spawns `codex exec` with the required workflow prompt.
- `/continue` spawns `codex exec` with the required recovery prompt.
- `/run-orch 1` spawns `python3 orchestrator.py --max-rounds 1`.
- Unauthorized messages do not spawn processes.
- Concurrent active workflow tasks are rejected.
- `/stop` sends `SIGTERM` to the recorded fake process.

### 9.4 Contract Tests

Run:

```text
npm run test:contract
```

Required contract coverage:

- Implemented command whitelist equals the command list in this spec.
- `/help` output equals the required help text.
- `/work` prompt includes all required workflow steps.
- `/ask` prompt includes all required read-only rules.
- `/continue` prompt includes all required recovery rules.
- Source code does not register `/run-feature`.
- Source code does not register `/eval-feature`.
- Runtime state schema excludes target repository feature objects.
- Task log path validation rejects paths outside `logs/`.

### 9.5 Manual Verification

Manual verification must be run against a local test workspace that contains:

- `AGENTS.md`
- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `init.sh`
- `orchestrator.py`

Run this Telegram sequence from an authorized chat:

```text
/repos
/use <test_repo>
/pwd
/ls
/git
/ask Explain the current repository workflow without editing files.
/work Add a harmless documentation-only requirement and run one orchestrator round.
/status
/logs <task_id>
```

Required manual results:

- `/repos` shows the test repo.
- `/use` selects the test repo.
- `/pwd` matches the test repo path.
- `/ls` shows root files.
- `/git` shows branch, status, and commits.
- `/ask` leaves the repository working tree unchanged.
- `/work` creates a task log and delegates planning plus execution to Codex.
- `/status` shows the task lifecycle.
- `/logs` returns the task tail.
- Full logs exist under `logs/`.

## 10. Non-Ambiguity Rules

Implementation agents must follow these rules when this spec conflicts with assumptions:

- Treat every `must` statement as mandatory.
- Treat every item in Scope Excluded as prohibited.
- Do not add commands beyond the command list.
- Do not change response strings that are specified exactly.
- Do not replace repository source-of-truth files with Bot runtime state.
- Do not use Telegram history as context for repository work.
- Do not implement target repository agent roles inside the Bot.
- Do not widen filesystem access beyond whitelisted repositories.
- Do not execute user input through a shell.
- Do not mark a feature complete from the Bot.

## 11. Final Mental Model

The system is not a mobile terminal.

The system is a Telegram-operated control plane for repository-owned long-running agent workflows.

The Bot owns:

- command validation
- workspace selection
- process spawning
- runtime task state
- logs
- bounded Telegram responses

The target repository owns:

- requirements
- feature state
- implementation
- evaluation
- commits
- durable progress
