# AGENTS.md

This project uses a long-running agent model.

Agents must behave like stateless workers:

* No memory between sessions
* All durable state lives in repository files
* Each session reconstructs context from files

---

# Core Principle

> Never rely on chat history.
> Always rely on project state.

---

# Agent Roles

## Initializer

The initializer bootstraps the repository state.

Responsibilities:

* Create `feature_list.json`
* Create `progress.md`
* Create `init.sh`
* Initialize git
* Do not implement business logic

## Planning Agent

The Planning Agent handles new requirements before implementation begins.

Responsibilities:

* Read `SPEC.md`
* Read `feature_list.json`
* Update `SPEC.md` by appending the new requirement clearly
* Append new features to `feature_list.json`
* Keep all existing requirements and feature entries unchanged unless explicitly instructed

Strict rules:

* Do not modify existing feature IDs
* Do not reset existing fields such as `passes`, `status`, `attempts`, or `last_error`
* Do not reorder existing features
* Only append new feature entries
* Preserve all existing data and state

After updating:

* Ensure `SPEC.md` remains structurally valid
* Ensure `feature_list.json` is valid JSON
* Ensure there are no duplicate feature IDs

## Orchestrator

`orchestrator.py` owns unattended feature execution.

Responsibilities:

* Run the startup protocol before doing anything else
* Pick one unfinished feature per round
* Mark the selected feature `status="in_progress"`
* Increment the selected feature's `attempts`
* Run a Coding Agent for that one feature
* Run an Evaluator Agent for that same feature
* Mark the feature done only after evaluator pass
* Mark the feature failed or blocked after coding/evaluation failure
* Commit the round's new working-tree changes

The normal unattended flow is:

```text
orchestrator.py
  -> Coding Agent implements Fxxx
  -> Evaluator Agent verifies Fxxx
  -> PASS: mark done and commit "Complete Fxxx"
  -> FAIL: mark todo/blocked, record last_error, and commit "Block Fxxx"
```

The orchestrator, not the Coding Agent, owns the final commit during unattended runs.

## Coding Agent

The Coding Agent implements exactly one feature selected by the orchestrator.

Responsibilities:

* Read `AGENTS.md`
* Read `progress.md`
* Read `feature_list.json`
* Check recent work with `git log --oneline -20`
* Run `./init.sh` before and after changes
* Implement only the requested feature
* Keep the system runnable
* Update `progress.md`
* Update only the current feature in `feature_list.json`
* Preserve unknown fields and feature ordering
* Do not stage or commit during orchestrated runs
* Do not modify unrelated pre-existing working-tree changes

The Coding Agent must not mark unrelated features as done.

## Evaluator Agent

The Evaluator Agent verifies whether one feature is truly complete.

Responsibilities:

* Read `AGENTS.md`
* Read `feature_list.json`
* Read `progress.md`
* Run `./init.sh`
* Inspect the implementation related to the target feature
* Run relevant tests or harness checks if available
* Verify the feature against its description and acceptance criteria

Strict rules:

* Do not implement new features
* Do not mark unrelated features as done
* Do not accept incomplete work
* Prevent premature completion
* If verification fails, explain the exact failure

The Evaluator Agent must output exactly one of:

```text
EVAL_PASS: Fxxx
EVAL_FAIL: Fxxx: <reason>
```

---

# Startup Protocol

Every Coding Agent, Evaluator Agent, and orchestrator run must:

1. Read `progress.md`
2. Read `feature_list.json`
3. Check recent work:

   ```bash
   git log --oneline -20
   ```

4. Run:

   ```bash
   ./init.sh
   ```

Then:

* Coding Agent: implement only the requested feature
* Evaluator Agent: verify only the requested feature
* Orchestrator: select and process one feature per round

---

# Orchestrator Commands

Run unattended development rounds:

```bash
python3 orchestrator.py
```

Run a fixed number of rounds:

```bash
python3 orchestrator.py --max-rounds 5
```

Run evaluator only for one completed feature:

```bash
python3 orchestrator.py --eval-only F001
```

Run evaluator only for all features:

```bash
python3 orchestrator.py --eval-only all
```

Preview prompts and actions without executing agents:

```bash
python3 orchestrator.py --dry-run
```

`--eval-only` must not run the Coding Agent, update feature state, or commit.

---

# State Files

## feature_list.json

`feature_list.json` defines the full feature scope and state.

Each feature may include:

* `id` (string, required)
* `description` (string, required)
* `passes` (boolean, required)
* `status` (optional): one of `["todo", "in_progress", "done", "blocked"]`
* `attempts` (optional, integer): retry count
* `last_error` (optional, string): last failure reason
* Other metadata fields such as `priority`

Rules:

* `passes=true` means the feature is complete
* `passes=false` means the feature is not complete
* `status` is orchestration state and must not conflict with `passes`
* `status=blocked` means temporarily skipped after repeated failures
* `attempts` is incremented when the orchestrator starts a round for that feature
* Agents must not delete fields
* Agents must preserve unknown fields

## State Safety Rules

* Do not overwrite the entire `feature_list.json` unnecessarily
* Update only the current feature during Coding Agent work
* Preserve ordering and existing fields
* Do not remove metadata fields

## progress.md

`progress.md` must include:

* Current system status
* Last completed feature
* Next feature
* Known issues

The Coding Agent updates `progress.md` after implementation work.

---

# Work Rules

* Only one feature per Coding Agent run
* Always keep the system runnable
* Always run `./init.sh` before declaring success
* The Coding Agent updates state and progress for its target feature
* The Evaluator Agent verifies without implementation changes
* The orchestrator commits unattended round results

---

# Anti-Patterns

* Doing multiple features in one Coding Agent run
* Relying on previous chat instead of repository files
* Skipping `./init.sh`
* Leaving broken code
* Coding Agent committing during orchestrated runs
* Evaluator Agent accepting incomplete work
* Marking a feature done without evaluator pass

---

# Goal

Make the system:

* Recoverable at any time
* Runnable at any time
* Continuously improvable
* Resistant to premature completion
