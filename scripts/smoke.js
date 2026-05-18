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
  if (result.agentTaskTimeoutMs !== null) {
    throw new Error("smoke startup did not preserve default agent timeout policy");
  }
  if (result.cameraClipConfig.enabled !== false) {
    throw new Error("smoke startup did not keep camera clip disabled by default");
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

  const camera = start(
    {
      NODE_ENV: "test",
      TELEGRAM_BOT_TOKEN: "test-token",
      ALLOWED_CHAT_IDS: "",
      ENABLE_CAMERA_CLIP_COMMAND: "1",
      CAMERA_CLIP_COMMAND_JSON: JSON.stringify(["fake-camera", "{seconds}", "{output}"]),
    },
    { rootDir, repos: {} },
  );
  if (!camera.cameraClipConfig.enabled || camera.cameraClipConfig.error !== null) {
    throw new Error("smoke startup did not parse camera clip config");
  }

  console.log("smoke passed");
} finally {
  rmSync(rootDir, { recursive: true, force: true });
}
