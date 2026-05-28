import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentPrompt } from "../src/ask.js";
import { commandList } from "../src/commands.js";
import { start } from "../src/index.js";

const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-smoke-"));

try {
  const result = start(
    {
      NODE_ENV: "test",
      TELEGRAM_BOT_TOKEN: "test-token",
      ALLOWED_CHAT_IDS: "",
    },
    { rootDir, repos: {} },
  );

  if (result.status !== "ready") {
    throw new Error("smoke startup did not return ready status");
  }
  if (result.agentTaskTimeoutMs !== null) {
    throw new Error("smoke startup did not preserve default agent timeout policy");
  }

  const configured = start(
    {
      NODE_ENV: "test",
      TELEGRAM_BOT_TOKEN: "test-token",
      ALLOWED_CHAT_IDS: "",
      AGENT_TASK_TIMEOUT_MS: "3600000",
    },
    { rootDir, repos: {} },
  );
  if (configured.agentTaskTimeoutMs !== 3600000) {
    throw new Error("smoke startup did not apply configured agent timeout");
  }
  if (!commandList().includes("/git_commit_push")) {
    throw new Error("smoke command surface did not include /git_commit_push");
  }
  if (!commandList().includes("/git")) {
    throw new Error("smoke command surface did not include /git");
  }

  const agentPrompt = buildAgentPrompt("Investigate and verify locally.");
  if (agentPrompt.includes("Keep shell execution disabled")) {
    throw new Error("smoke agent prompt still contains the broad shell-disabled prohibition");
  }
  if (!agentPrompt.includes("Use available local tools for repository investigation, implementation, and verification when needed.")) {
    throw new Error("smoke agent prompt did not allow available local tools");
  }
  if (!agentPrompt.includes("Respect the active sandbox, approval policy, repository rules, and user instructions.")) {
    throw new Error("smoke agent prompt did not preserve sandbox and approval guidance");
  }

  console.log("smoke passed");
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}
