import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  console.log("smoke passed");
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}
