import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkPrompt } from "../../src/work.js";

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
