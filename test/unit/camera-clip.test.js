import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import {
  CAMERA_CLIP_RESPONSES,
  cleanupCameraClipResult,
  handleCameraClip,
  parseCameraClipConfig,
  parseCameraClipSeconds,
} from "../../src/camera-clip.js";

test("parseCameraClipConfig requires explicit enablement and a safe argv template", () => {
  assert.deepEqual(parseCameraClipConfig({ enabledValue: "", commandJson: "" }), {
    enabled: false,
    argvTemplate: null,
    error: null,
  });

  assert.equal(parseCameraClipConfig({ enabledValue: "1", commandJson: "" }).error.includes("required"), true);
  assert.equal(parseCameraClipConfig({ enabledValue: "1", commandJson: "{" }).error.includes("valid JSON"), true);
  assert.equal(parseCameraClipConfig({
    enabledValue: "1",
    commandJson: JSON.stringify({ argv: ["camera", "--seconds", "{seconds}", "--output", "{output}"] }),
  }).error.includes("array"), true);
  assert.equal(parseCameraClipConfig({ enabledValue: "1", commandJson: JSON.stringify(["camera", "{seconds}"]) }).error.includes("{output}"), true);
  assert.deepEqual(parseCameraClipConfig({
    enabledValue: "1",
    commandJson: JSON.stringify(["camera", "--seconds", "{seconds}", "--output", "{output}"]),
  }), {
    enabled: true,
    argvTemplate: ["camera", "--seconds", "{seconds}", "--output", "{output}"],
    error: null,
  });
});

test("parseCameraClipSeconds accepts only integers from one through ten", () => {
  assert.equal(parseCameraClipSeconds("1"), 1);
  assert.equal(parseCameraClipSeconds("10"), 10);
  assert.equal(parseCameraClipSeconds("0"), null);
  assert.equal(parseCameraClipSeconds("11"), null);
  assert.equal(parseCameraClipSeconds("1.5"), null);
  assert.equal(parseCameraClipSeconds("two"), null);
});

test("handleCameraClip runs shell-disabled capture, returns video result, and leaves cleanup to transport", async () => {
  const calls = [];
  const result = await handleCameraClip("3", {
    enabled: true,
    argvTemplate: ["fake-camera", "--seconds", "{seconds}", "--output", "{output}"],
    error: null,
  }, {
    timeoutMs: 1000,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      setImmediate(() => {
        writeFileSync(args[3], "fake-video");
        child.emit("close", 0);
      });
      child.kill = () => true;
      return child;
    },
  });

  assert.equal(result.response, "Camera clip ready: 3s");
  assert.equal(result.telegramVideo.caption, "Camera clip (3s)");
  assert.equal(existsSync(result.telegramVideo.path), true);
  assert.equal(calls[0].command, "fake-camera");
  assert.deepEqual(calls[0].args.slice(0, 3), ["--seconds", "3", "--output"]);
  assert.deepEqual(calls[0].options, {
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
  cleanupCameraClipResult(result);
  assert.equal(existsSync(result.telegramVideo.path), false);
});

test("handleCameraClip works with a real shell-disabled argv process fixture", async () => {
  const result = await handleCameraClip("1", {
    enabled: true,
    argvTemplate: [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync(process.argv.at(-1), 'real-video')",
      "{seconds}",
      "{output}",
    ],
    error: null,
  }, {
    timeoutMs: 1000,
  });

  assert.equal(result.response, "Camera clip ready: 1s");
  assert.equal(existsSync(result.telegramVideo.path), true);
  cleanupCameraClipResult(result);
});

test("handleCameraClip rejects disabled, malformed, failed, timed out, and empty captures", async () => {
  assert.equal((await handleCameraClip("2", { enabled: false })).response, CAMERA_CLIP_RESPONSES.disabled);
  assert.equal((await handleCameraClip("12", { enabled: true })).response, CAMERA_CLIP_RESPONSES.usage);
  assert.equal((await handleCameraClip("2", { enabled: true, error: "bad" })).response, CAMERA_CLIP_RESPONSES.configError);
  assert.equal((await handleCameraClip("2", {
    enabled: true,
    argvTemplate: ["fake-camera", "{seconds}", "{output}"],
  }, {
    timeoutMs: 1000,
    spawnImpl() {
      const child = new EventEmitter();
      setImmediate(() => child.emit("close", 2));
      child.kill = () => true;
      return child;
    },
  })).response, CAMERA_CLIP_RESPONSES.captureFailed);
  assert.equal((await handleCameraClip("2", {
    enabled: true,
    argvTemplate: ["fake-camera", "{seconds}", "{output}"],
  }, {
    timeoutMs: 1,
    spawnImpl() {
      const child = new EventEmitter();
      child.kill = () => true;
      return child;
    },
  })).response, CAMERA_CLIP_RESPONSES.timeout);
  assert.equal((await handleCameraClip("2", {
    enabled: true,
    argvTemplate: ["fake-camera", "{seconds}", "{output}"],
  }, {
    timeoutMs: 1000,
    spawnImpl(command, args) {
      const child = new EventEmitter();
      setImmediate(() => {
        writeFileSync(args[1], "");
        child.emit("close", 0);
      });
      child.kill = () => true;
      return child;
    },
  })).response, CAMERA_CLIP_RESPONSES.emptyOutput);
});
