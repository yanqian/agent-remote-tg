import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const CAMERA_CLIP_DISABLED_RESPONSE = "Camera clip command is disabled.";
const CAMERA_CLIP_USAGE = "Usage: /camera_clip <seconds> where seconds is an integer from 1 to 10.";
const CAMERA_CLIP_CONFIG_ERROR_RESPONSE = "Camera clip capture config is missing or malformed.";
const CAMERA_CLIP_BUSY_RESPONSE = "Camera clip capture is already running.";
const CAMERA_CLIP_CAPTURE_FAILED_RESPONSE = "Camera clip capture failed.";
const CAMERA_CLIP_TIMEOUT_RESPONSE = "Camera clip capture timed out.";
const CAMERA_CLIP_EMPTY_OUTPUT_RESPONSE = "Camera clip capture did not produce a video.";
const DEFAULT_CAPTURE_GRACE_MS = 5000;

let activeCapture = false;

export function parseCameraClipConfig({ enabledValue, commandJson }) {
  const enabled = String(enabledValue ?? "").trim() === "1";
  if (!enabled) {
    return { enabled: false, argvTemplate: null, error: null };
  }

  if (commandJson === undefined || commandJson === null || String(commandJson).trim() === "") {
    return { enabled: true, argvTemplate: null, error: "CAMERA_CLIP_COMMAND_JSON is required when ENABLE_CAMERA_CLIP_COMMAND=1." };
  }

  let parsed;
  try {
    parsed = JSON.parse(commandJson);
  } catch {
    return { enabled: true, argvTemplate: null, error: "CAMERA_CLIP_COMMAND_JSON must be valid JSON." };
  }

  const argvTemplate = Array.isArray(parsed) ? parsed : parsed?.argv;
  const validationError = validateCameraClipArgvTemplate(argvTemplate);
  return validationError
    ? { enabled: true, argvTemplate: null, error: validationError }
    : { enabled: true, argvTemplate, error: null };
}

export function validateCameraClipArgvTemplate(argvTemplate) {
  if (!Array.isArray(argvTemplate) || argvTemplate.length === 0) {
    return "CAMERA_CLIP_COMMAND_JSON must provide a non-empty argv template array.";
  }
  if (!argvTemplate.every((item) => typeof item === "string" && item.length > 0)) {
    return "CAMERA_CLIP_COMMAND_JSON argv entries must be non-empty strings.";
  }
  const joined = argvTemplate.join("\n");
  if (!joined.includes("{seconds}") || !joined.includes("{output}")) {
    return "CAMERA_CLIP_COMMAND_JSON argv must include {seconds} and {output}.";
  }
  return null;
}

export function parseCameraClipSeconds(args) {
  const value = String(args ?? "").trim();
  if (!/^\d+$/.test(value)) {
    return null;
  }
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= 10 ? seconds : null;
}

export async function handleCameraClip(args, cameraClipConfig, options = {}) {
  const seconds = parseCameraClipSeconds(args);
  if (seconds === null) {
    return { response: CAMERA_CLIP_USAGE, stateChanged: false };
  }

  if (!cameraClipConfig?.enabled) {
    return { response: CAMERA_CLIP_DISABLED_RESPONSE, stateChanged: false };
  }

  if (cameraClipConfig.error || !cameraClipConfig.argvTemplate) {
    return { response: CAMERA_CLIP_CONFIG_ERROR_RESPONSE, stateChanged: false };
  }

  if (activeCapture) {
    return { response: CAMERA_CLIP_BUSY_RESPONSE, stateChanged: false };
  }

  activeCapture = true;
  let tempDir = null;
  try {
    tempDir = await mkdtemp(join(tmpdir(), "agent-remote-tg-camera-"));
    const outputPath = join(tempDir, "clip.mp4");
    const argv = cameraClipConfig.argvTemplate.map((item) => item
      .replaceAll("{seconds}", String(seconds))
      .replaceAll("{output}", outputPath));
    const result = await runCapture(argv, {
      timeoutMs: options.timeoutMs ?? (seconds * 1000 + DEFAULT_CAPTURE_GRACE_MS),
      spawnImpl: options.spawnImpl,
    });

    if (result.timedOut) {
      cleanupCameraClipResult({ cleanupPaths: [tempDir] });
      return { response: CAMERA_CLIP_TIMEOUT_RESPONSE, stateChanged: false };
    }
    if (result.exitCode !== 0) {
      cleanupCameraClipResult({ cleanupPaths: [tempDir] });
      return { response: CAMERA_CLIP_CAPTURE_FAILED_RESPONSE, stateChanged: false };
    }
    if (!existsSync(outputPath) || statSync(outputPath).size <= 0) {
      cleanupCameraClipResult({ cleanupPaths: [tempDir] });
      return { response: CAMERA_CLIP_EMPTY_OUTPUT_RESPONSE, stateChanged: false };
    }

    return {
      response: `Camera clip ready: ${seconds}s`,
      stateChanged: false,
      telegramVideo: {
        path: outputPath,
        caption: `Camera clip (${seconds}s)`,
        cleanupPaths: [tempDir],
      },
    };
  } catch {
    if (tempDir) {
      cleanupCameraClipResult({ cleanupPaths: [tempDir] });
    }
    return { response: CAMERA_CLIP_CAPTURE_FAILED_RESPONSE, stateChanged: false };
  } finally {
    activeCapture = false;
  }
}

export function cleanupCameraClipResult(result) {
  for (const cleanupPath of result?.cleanupPaths ?? result?.telegramVideo?.cleanupPaths ?? []) {
    rmSync(cleanupPath, { recursive: true, force: true });
  }
}

export async function sendTelegramVideo({ botToken, chatId, videoPath, caption, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required.");
  }

  const body = new FormData();
  body.set("chat_id", String(chatId));
  body.set("caption", String(caption ?? ""));
  body.set("video", new Blob([readFileSync(videoPath)], { type: "video/mp4" }), "camera-clip.mp4");

  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendVideo`, {
    method: "POST",
    body,
  });
  if (!response?.ok) {
    throw new Error("Telegram sendVideo failed.");
  }
  if (typeof response.json === "function") {
    const json = await response.json();
    if (json?.ok !== true) {
      throw new Error("Telegram sendVideo failed.");
    }
  }
  return response;
}

function runCapture(argv, { timeoutMs, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(argv[0], argv.slice(1), {
      shell: false,
      stdio: ["ignore", "ignore", "ignore"],
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      if (typeof child.kill === "function") {
        child.kill("SIGTERM");
      }
      resolve({ exitCode: null, timedOut: true });
    }, timeoutMs);
    child.on("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: 1, timedOut: false });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut: false });
    });
  });
}

export const CAMERA_CLIP_RESPONSES = Object.freeze({
  disabled: CAMERA_CLIP_DISABLED_RESPONSE,
  usage: CAMERA_CLIP_USAGE,
  configError: CAMERA_CLIP_CONFIG_ERROR_RESPONSE,
  busy: CAMERA_CLIP_BUSY_RESPONSE,
  captureFailed: CAMERA_CLIP_CAPTURE_FAILED_RESPONSE,
  timeout: CAMERA_CLIP_TIMEOUT_RESPONSE,
  emptyOutput: CAMERA_CLIP_EMPTY_OUTPUT_RESPONSE,
  sendFailed: "Camera clip send failed.",
});
