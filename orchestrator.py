#!/usr/bin/env python3
import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Optional

FEATURES_PATH = Path("feature_list.json")
PROGRESS_PATH = Path("progress.md")
MAX_ROUNDS = 5
MAX_ATTEMPTS = 3


class OrchestratorError(Exception):
    pass


def sh(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, check=check)


def run_capture(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, text=True, capture_output=True, check=check)


def load_state() -> dict:
    data = json.loads(FEATURES_PATH.read_text())
    if not isinstance(data, dict) or not isinstance(data.get("features"), list):
        raise OrchestratorError("feature_list.json must contain a top-level features array.")
    return data


def save_state(data: dict) -> None:
    FEATURES_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def features(data: dict) -> list[dict]:
    return data["features"]


def feature_by_id(data: dict, fid: str) -> dict:
    for feature in features(data):
        if feature.get("id") == fid:
            return feature
    raise OrchestratorError(f"Feature not found: {fid}")


def normalize_status(feature: dict) -> str:
    status = feature.get("status", "todo")
    if feature.get("passes") is True:
        return "done"
    if status == "done":
        return "todo"
    return status


def pick_feature(data: dict, max_attempts: int) -> Optional[dict]:
    priority = {"P0": 0, "P1": 1, "P2": 2}
    candidates = []
    for feature in features(data):
        status = normalize_status(feature)
        attempts = int(feature.get("attempts", 0))
        if feature.get("passes") is False and status in {"todo", "in_progress"} and attempts < max_attempts:
            candidates.append(feature)

    candidates.sort(
        key=lambda f: (
            priority.get(f.get("priority", "P2"), 9),
            features(data).index(f),
        )
    )
    return candidates[0] if candidates else None


def mark_in_progress(fid: str) -> None:
    data = load_state()
    feature = feature_by_id(data, fid)
    feature["status"] = "in_progress"
    feature["attempts"] = int(feature.get("attempts", 0)) + 1
    feature["last_error"] = ""
    save_state(data)


def mark_done(fid: str) -> None:
    data = load_state()
    feature = feature_by_id(data, fid)
    feature["passes"] = True
    feature["status"] = "done"
    feature["last_error"] = ""
    save_state(data)


def mark_failed(fid: str, error: str, max_attempts: int) -> None:
    data = load_state()
    feature = feature_by_id(data, fid)
    attempts = int(feature.get("attempts", 0))
    feature["passes"] = False
    feature["status"] = "blocked" if attempts >= max_attempts else "todo"
    feature["last_error"] = error.strip()[:2000]
    save_state(data)


def status_entries() -> dict[str, str]:
    result = run_capture(["git", "status", "--porcelain=v1", "-z"])
    raw = result.stdout
    entries: dict[str, str] = {}
    if not raw:
        return entries

    parts = raw.split("\0")
    index = 0
    while index < len(parts):
        entry = parts[index]
        index += 1
        if not entry:
            continue
        status = entry[:2]
        path = entry[3:]
        if status.startswith("R") or status.startswith("C"):
            old_path = parts[index] if index < len(parts) else ""
            index += 1
            entries[path] = status
            if old_path:
                entries[old_path] = status
        else:
            entries[path] = status
    return entries


def changed_since(baseline: dict[str, str]) -> list[str]:
    current = status_entries()
    return sorted(path for path in current if path not in baseline)


def commit_round(fid: str, message: str, baseline: dict[str, str], dry_run: bool) -> None:
    paths = changed_since(baseline)
    if not paths:
        print(f"No new working tree changes to commit for {fid}.", flush=True)
        return

    if dry_run:
        print("Dry run: would commit these paths:")
        for path in paths:
            print(f"  {path}")
        return

    sh(["git", "add", "--", *paths])
    sh(["git", "commit", "-m", message], check=False)


def startup_protocol() -> None:
    if not PROGRESS_PATH.exists():
        raise OrchestratorError("progress.md is missing.")
    if not FEATURES_PATH.exists():
        raise OrchestratorError("feature_list.json is missing.")

    print("Reading progress.md and feature_list.json.", flush=True)
    PROGRESS_PATH.read_text()
    load_state()
    sh(["git", "log", "--oneline", "-20"])
    sh(["./init.sh"])


def coding_prompt(fid: str) -> str:
    return f"""
Act as Coding Agent.

Strictly follow AGENTS.md, except the parent orchestrator owns the final git commit for this unattended run.

Implement ONLY feature {fid} from feature_list.json.

Rules:
- Read progress.md and feature_list.json.
- Check recent work with: git log --oneline -20
- Run ./init.sh before and after changes.
- Do not implement other features.
- Keep the system runnable.
- Update progress.md.
- Update only feature {fid} in feature_list.json.
- Do not stage or commit changes; the orchestrator will validate and commit this round.
- Do not modify unrelated pre-existing working tree changes.
"""


def evaluator_prompt(fid: str) -> str:
    return f"""
Act as Evaluator Agent.

Your job is to verify whether feature {fid} is truly complete.

You must:
1. Read AGENTS.md
2. Read feature_list.json
3. Read progress.md
4. Run ./init.sh
5. Inspect the implementation related to {fid}
6. Run relevant tests / harness checks if available
7. Verify the feature against its description and acceptance criteria

Strict rules:
- Do NOT implement new features
- Do NOT mark unrelated features as done
- Do NOT accept incomplete work
- Prevent premature completion
- If verification fails, explain the exact failure

Output one of:
- EVAL_PASS: {fid}
- EVAL_FAIL: {fid}: <reason>
"""


def run_agent(prompt: str, dry_run: bool, label: str) -> subprocess.CompletedProcess[str]:
    if dry_run:
        print(f"Dry run: would execute {label} codex prompt:")
        print(prompt)
        return subprocess.CompletedProcess(["codex", "exec", prompt], 0)
    result = subprocess.run(["codex", "exec", prompt], text=True, capture_output=True)
    if result.stdout:
        print(result.stdout, end="", flush=True)
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr, flush=True)
    return result


def run_coding_agent(fid: str, dry_run: bool) -> subprocess.CompletedProcess[str]:
    return run_agent(coding_prompt(fid), dry_run, "Coding Agent")


def run_evaluator_agent(fid: str, dry_run: bool) -> subprocess.CompletedProcess[str]:
    return run_agent(evaluator_prompt(fid), dry_run, "Evaluator Agent")


def evaluator_result(fid: str, result: subprocess.CompletedProcess[str]) -> tuple[bool, str]:
    output = "\n".join(part for part in [result.stdout, result.stderr] if part)
    pass_line = f"EVAL_PASS: {fid}"
    fail_prefix = f"EVAL_FAIL: {fid}:"

    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith(fail_prefix):
            return False, stripped[len(fail_prefix):].strip() or "Evaluator reported failure."

    for line in output.splitlines():
        if line.strip() == pass_line:
            return True, ""

    return False, f"Evaluator did not emit required pass line: {pass_line}"


def evaluate_feature(fid: str, dry_run: bool) -> bool:
    print(f"\n== Evaluate: {fid} ==", flush=True)
    evaluator = run_evaluator_agent(fid, dry_run)
    if dry_run:
        return True

    if evaluator.returncode != 0:
        print(f"EVAL_FAIL: {fid}: evaluator agent exited with code {evaluator.returncode}", flush=True)
        return False

    passed, reason = evaluator_result(fid, evaluator)
    if passed:
        print(f"Evaluator accepted {fid}.", flush=True)
        return True

    print(f"EVAL_FAIL: {fid}: {reason}", flush=True)
    return False


def feature_ids_for_eval(target: str) -> list[str]:
    data = load_state()
    if target == "all":
        return [str(feature["id"]) for feature in features(data)]

    feature_by_id(data, target)
    return [target]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run unattended feature development rounds.")
    parser.add_argument("--max-rounds", type=int, default=MAX_ROUNDS)
    parser.add_argument("--max-attempts", type=int, default=MAX_ATTEMPTS)
    parser.add_argument(
        "--eval-only",
        metavar="FEATURE_ID|all",
        help="Run Evaluator Agent against an existing feature or all features without coding, state updates, or commits.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    startup_protocol()

    if args.eval_only:
        feature_ids = feature_ids_for_eval(args.eval_only)
        results = [evaluate_feature(fid, args.dry_run) for fid in feature_ids]
        return 0 if all(results) else 1

    for round_no in range(1, args.max_rounds + 1):
        data = load_state()
        feature = pick_feature(data, args.max_attempts)
        if not feature:
            print("No runnable unfinished feature left.", flush=True)
            return 0

        fid = feature["id"]
        print(f"\n== Round {round_no}: {fid} ==", flush=True)
        if args.dry_run:
            run_coding_agent(fid, dry_run=True)
            run_evaluator_agent(fid, dry_run=True)
            return 0

        baseline = status_entries()
        mark_in_progress(fid)

        coding_result = run_coding_agent(fid, args.dry_run)
        if coding_result.returncode != 0:
            error = f"coding agent exited with code {coding_result.returncode}"
            mark_failed(fid, error, args.max_attempts)
            commit_round(fid, f"Block {fid}", baseline, args.dry_run)
            print(f"Failed: {fid}: {error}", flush=True)
            continue

        evaluator = run_evaluator_agent(fid, args.dry_run)
        if evaluator.returncode != 0:
            error = f"evaluator agent exited with code {evaluator.returncode}"
            mark_failed(fid, error, args.max_attempts)
            commit_round(fid, f"Block {fid}", baseline, args.dry_run)
            print(f"Evaluation failed: {fid}: {error}", flush=True)
            continue

        passed, reason = evaluator_result(fid, evaluator)
        if not passed:
            error = reason or "Evaluator rejected the feature."
            mark_failed(fid, error, args.max_attempts)
            commit_round(fid, f"Block {fid}", baseline, args.dry_run)
            print(f"Evaluation failed: {fid}: {error}", flush=True)
            continue

        mark_done(fid)
        commit_round(fid, f"Complete {fid}", baseline, args.dry_run)
        print(f"Done: {fid}", flush=True)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except OrchestratorError as exc:
        print(f"orchestrator error: {exc}", file=sys.stderr)
        raise SystemExit(1)
