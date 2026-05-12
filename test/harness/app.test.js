import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.js";

test("app rejects unauthorized messages before parsing commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
    });
    assert.equal(app.handleMessage({ chatId: "999", text: "/repos" }), "Unauthorized chat.");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app handles /repos, /use, and /pwd with persisted runtime state", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const statePath = join(rootDir, "runtime_state.json");
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath,
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/repos" }), `Available repos:\n- app -> ${repoDir}`);
    assert.equal(app.handleMessage({ chatId: "123", text: "/pwd" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(app.handleMessage({ chatId: "123", text: "/pwd" }), repoDir);

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.currentRepo, "app");
    assert.equal(state.cwd, repoDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app handles /ls and /git in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    writeFileSync(join(repoDir, "README.md"), "# Test repo\n");
    execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    execFileSync("git", ["add", "README.md"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: repoDir, stdio: "ignore" });
    execFileSync("git", ["branch", "-M", "main"], { cwd: repoDir });

    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath: join(rootDir, "runtime_state.json"),
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/ls" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/git" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.match(app.handleMessage({ chatId: "123", text: "/ls" }), /README\.md/);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/git" }),
      "Branch:\nmain\nStatus:\nclean\nRecent commits:\n" +
        execFileSync("git", ["log", "--oneline", "-1"], { cwd: repoDir, encoding: "utf8" }).trim(),
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app rejects unknown commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: {},
      statePath: join(rootDir, "runtime_state.json"),
    });
    assert.equal(app.handleMessage({ chatId: "123", text: "/eval-feature F001" }), "Unknown command.\nUse /help.");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("app checks agent workflow readiness for workflow commands", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath: join(rootDir, "runtime_state.json"),
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/work Add a requirement" }),
      "Workspace is not agent-workflow ready.\nMissing required files:\n- AGENTS.md\n- SPEC.md\n- feature_list.json\n- progress.md\n- init.sh\n- orchestrator.py",
    );

    for (const fileName of ["AGENTS.md", "SPEC.md", "feature_list.json", "progress.md", "init.sh", "orchestrator.py"]) {
      writeFileSync(join(repoDir, fileName), "");
    }

    assert.equal(
      app.handleMessage({ chatId: "123", text: "/continue Resume work" }),
      "Command recognized but not implemented in the current feature set.",
    );
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/run-orch 1" }),
      "Command recognized but not implemented in the current feature set.",
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("app starts /ask tasks in the selected workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-app-"));
  const repoDir = mkdtempSync(join(tmpdir(), "agent-remote-tg-repo-"));
  const calls = [];
  try {
    const app = createApp({
      allowedChatIds: ["123"],
      repos: { app: repoDir },
      statePath: join(rootDir, "runtime_state.json"),
      taskExecutor: {
        startTask(request) {
          calls.push(request);
          return { response: "Task started: task_abc_1\nUse /logs task_abc_1 to view output." };
        },
      },
    });

    assert.equal(app.handleMessage({ chatId: "123", text: "/ask Explain" }), "No workspace selected.\nUse /repos then /use <repo>.");
    assert.equal(app.handleMessage({ chatId: "123", text: "/use app" }), `Workspace switched:\napp\n${repoDir}`);
    assert.equal(
      app.handleMessage({ chatId: "123", text: "/ask Explain the repo" }),
      "Task started: task_abc_1\nUse /logs task_abc_1 to view output.",
    );
    assert.equal(calls[0].type, "ask");
    assert.equal(calls[0].cwd, repoDir);
    assert.equal(calls[0].command, "codex");
    assert.equal(calls[0].args[0], "exec");
    assert.match(calls[0].args[1], /Do not run orchestrator\.py\./);
    assert.match(calls[0].args[1], /Question:\nExplain the repo/);
    assert.equal(calls[0].timeoutMs, 600000);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(repoDir, { recursive: true, force: true });
  }
});
