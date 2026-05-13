# Test Plan

## Verification Entry Point

All automated verification must run through:

```bash
./init.sh
```

`init.sh` must exit `1` on failure.

## Baseline Checks

The initialization baseline verifies:

- Required state files exist.
- `orchestrator.py` compiles with Python.
- `feature_list.json` is valid JSON.
- `feature_list.json` contains a top-level `features` array.
- Every feature has `id`, `description`, and `passes`.
- Every initial feature has `passes=false`.
- Feature IDs are unique.
- Feature statuses are one of `todo`, `in_progress`, `done`, or `blocked`.
- `SPEC.md` does not contain banned ambiguous planning words from the initialization request.

## Feature Verification Matrix

| Feature | Verification Requirement |
| --- | --- |
| F001 | Startup tests prove environment validation, `runtime_state.json` creation, `logs/` creation, and startup failure for empty `ALLOWED_CHAT_IDS` outside test mode. |
| F002 | Unit tests prove parser and authorization behavior for all documented commands and rejection cases. |
| F003 | Unit and harness tests prove repository whitelist lookup, `/repos`, `/use`, `/pwd`, atomic runtime state writes, and no-workspace errors. |
| F004 | Harness tests prove `/ls` and `/git` spawn the required commands only in the selected workspace. |
| F005 | Unit and harness tests prove shell-disabled spawning, task records, log writing, status transitions, exit code capture, and secret redaction. |
| F006 | Harness and contract tests prove `/ask` uses the required read-only prompt, runs in the selected workspace, enforces timeout, and logs output. |
| F007 | Unit tests prove readiness checks require every agent workflow file before workflow commands spawn. |
| F008 | Harness and contract tests prove `/work` rejects concurrent workflow tasks and uses the required workflow prompt without direct feature-state mutation. |
| F009 | Harness and contract tests prove `/continue` rejects concurrent workflow tasks and uses the required recovery prompt. |
| F010 | Unit and harness tests prove the orchestrator command validates rounds and spawns `python3 orchestrator.py --max-rounds <rounds>` with shell disabled. |
| F011 | Unit and harness tests prove `/status`, `/logs`, and `/stop` behavior, including log confinement and SIGTERM restrictions. |
| F012 | Contract tests prove exact help output, exact command whitelist, absence of prohibited commands, required prompt text, and runtime state schema limits. |

## Script Conventions

When a package manifest exists, these scripts must be wired into `./init.sh`:

- `build`
- `test:unit`
- `test:harness`
- `test:contract`
- `smoke`

Missing package scripts are skipped by `init.sh` until implementation introduces them.

## Manual Verification

Manual verification after Bot implementation must execute this Telegram sequence from an authorized chat:

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
