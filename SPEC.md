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
- Workspace selection through `/use <repo>`.
- Workspace inspection through `/repos`, `/pwd`, `/ls`, and `/git`.
- Read-only Codex discussion through `/ask <question>`.
- Repository workflow delegation through `/work <requirement>`.
- Repository workflow recovery through `/continue <instruction>`.
- Orchestrator execution through `/run-orch <rounds>`.
- Task status inspection through `/status`.
- Task log inspection through `/logs <task_id>`.
- Task termination through `/stop <task_id>`.
- Command discovery through `/help`.
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
- Cloud deployment automation.
- Scheduled task execution.
- Multiple active workflow tasks in one workspace.

## 3. Core Concepts

### 3.1 Control Plane

The Bot validates commands, validates workspaces, starts local processes, records runtime task metadata, writes logs, and returns bounded Telegram responses.

The Bot must not decide which target repository feature is next, whether a feature passes, or how target repository state files change.

### 3.2 Target Repository

A target repository is a local directory listed in the repository whitelist.

A target repository is agent-workflow ready only when these files exist at its root:

- `AGENTS.md`
- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `init.sh`
- `orchestrator.py`

`/work`, `/continue`, and `/run-orch` must reject a workspace before spawning any process when one or more required files are missing.

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

When no workspace is selected, `/pwd`, `/ls`, `/git`, `/ask`, `/work`, `/continue`, and `/run-orch` must return:

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

### 4.7 Orchestrator Execution

`/run-orch <rounds>` must:

1. Require an agent-workflow ready selected workspace.
2. Parse `<rounds>` as a base-10 integer.
3. Accept only values from `1` through `5`.
4. Spawn `python3 orchestrator.py --max-rounds <rounds>` with shell disabled.

Invalid rounds response:

```text
Invalid rounds. Use an integer from 1 to 5.
```

### 4.8 Task Status, Logs, And Stop

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

## 6. Acceptance Criteria

- Bot starts with `TELEGRAM_BOT_TOKEN` and non-empty `ALLOWED_CHAT_IDS`.
- Bot exits with failure when `ALLOWED_CHAT_IDS` is empty outside `NODE_ENV=test`.
- Unauthorized chat IDs receive `Unauthorized chat.` and do not spawn processes.
- `/repos` returns configured repo aliases and absolute paths.
- `/use <repo>` persists the selected workspace.
- `/pwd` returns the selected workspace path.
- `/ls` runs `ls -la` in the selected workspace.
- `/git` returns branch, short status, and five recent commits.
- `/ask` spawns `codex exec` with the required read-only prompt.
- `/work` rejects non-ready workspaces.
- `/work` spawns `codex exec` with the required workflow prompt.
- `/continue` spawns `codex exec` with the required recovery prompt.
- `/run-orch 1` spawns `python3 orchestrator.py --max-rounds 1` with shell disabled.
- `/run-orch` rejects non-integers and integers outside `1..5`.
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
