import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  console.log("smoke passed");
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}
