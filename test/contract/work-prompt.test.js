import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt } from "../../src/ask.js";
import { buildContinuePrompt, buildWorkPrompt } from "../../src/work.js";

test("/agent prompt contains the required general agent contract", () => {
  const prompt = buildAgentPrompt("Update documentation and verify it.");

  for (const requiredText of [
    "Use repository files and git history as the source of truth.",
    "Do not rely on Telegram chat history.",
    "For implementation requests, read and follow AGENTS.md before changing files.",
    "Preserve unrelated user changes and existing git history.",
    "Use available local tools for repository investigation, implementation, and verification when needed.",
    "You may inspect Git state with read-only commands such as git status, git diff, and git log.",
    "You may edit ordinary workspace files and run tests, but do not attempt Git staging, reset, commit, update-index writes, or push from inside the Codex task sandbox.",
    "Local probes show ordinary workspace writes can succeed while .git metadata writes such as .git/index.lock can fail in this task environment.",
    "Leave repository publication to the Bot-local git command path for commit and push.",
    "Respect the active sandbox, approval policy, repository rules, and user instructions.",
    "The Telegram Bot remains responsible for its own shell-disabled fixed-argv process safety.",
    "Summarize actions taken, changed files, verification commands, remaining issues, and a suggested commit message.",
  ]) {
    assert.ok(prompt.includes(requiredText), `missing prompt text: ${requiredText}`);
  }

  assert.doesNotMatch(prompt, /Keep shell execution disabled/);
  assert.doesNotMatch(prompt, /Do not modify files\./);
  assert.doesNotMatch(prompt, /Do not update SPEC\.md\./);
  assert.doesNotMatch(prompt, /Do not update feature_list\.json\./);
  assert.match(prompt, /Instruction:\nUpdate documentation and verify it\./);
});

test("/work prompt contains the required long-running workflow contract", () => {
  const prompt = buildWorkPrompt("Add a safe rollout requirement.");

  for (const requiredText of [
    "1. Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20.",
    "2. Run ./init.sh before changing files.",
    "3. Determine whether the request is a new requirement or a bug fix.",
    "4. Update SPEC.md through the repository planning workflow.",
    "5. Append new feature entries to feature_list.json when new work is required.",
    "6. Preserve all existing feature IDs, ordering, passes, status, attempts, last_error, and unknown fields.",
    "7. Validate feature_list.json as JSON.",
    "8. Create a planning commit when planning files changed.",
    "9. Run python3 orchestrator.py --max-rounds 1.",
    "10. Treat the task as complete only when the orchestrator and evaluator workflow pass.",
    "11. Summarize changed files, feature IDs, commands run, final status, and remaining issues.",
  ]) {
    assert.ok(prompt.includes(requiredText), `missing prompt text: ${requiredText}`);
  }

  assert.match(prompt, /Requirement:\nAdd a safe rollout requirement\./);
});

test("/continue prompt contains the required recovery contract", () => {
  const prompt = buildContinuePrompt("Resume the interrupted workflow.");

  for (const requiredText of [
    "Do not rely on chat history.",
    "Read AGENTS.md, progress.md, feature_list.json, and git log --oneline -20 before deciding the next action.",
    "Run ./init.sh before changing files.",
    "Use orchestrator.py according to AGENTS.md when implementation or evaluation is required.",
    "Do not overwrite feature_list.json.",
    "Do not reset existing feature state.",
    "Stop and report exact conflicts when repository state is unsafe.",
  ]) {
    assert.ok(prompt.includes(requiredText), `missing prompt text: ${requiredText}`);
  }

  assert.match(prompt, /Instruction:\nResume the interrupted workflow\./);
});
