import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeState, saveRuntimeState } from "../src/runtime-state.js";

const ACTIVE_STATUSES = new Set(["running", "stopping"]);

export function clearRuntimeHistory({ rootDir = process.cwd(), dryRun = false } = {}) {
  const resolvedRootDir = resolve(rootDir);
  const statePath = join(resolvedRootDir, "runtime_state.json");
  const logsDir = join(resolvedRootDir, "logs");
  const state = loadRuntimeState(statePath);
  const activeTasks = Object.values(state.tasks ?? {}).filter((task) => ACTIVE_STATUSES.has(task?.status));

  if (activeTasks.length > 0) {
    const activeSummary = activeTasks
      .map((task) => `${task.taskId ?? "(unknown task)"} status=${task.status}`)
      .join("\n");
    throw new Error(`Refusing to clear runtime history while tasks are active:\n${activeSummary}`);
  }

  const logFiles = listLogFiles(logsDir);
  const nextState = {
    ...state,
    tasks: {},
    askSessions: {},
    agentChatModes: {},
    approvalRequests: {},
    approvalAllowRules: {},
  };

  if (!dryRun) {
    saveRuntimeState(statePath, nextState);
    for (const logPath of logFiles) {
      rmSync(logPath, { force: true });
    }
  }

  return {
    statePath,
    logsDir,
    clearedTasks: Object.keys(state.tasks ?? {}).length,
    clearedAskSessions: countNestedBindings(state.askSessions),
    clearedAgentChatModes: countNestedBindings(state.agentChatModes),
    clearedApprovalRequests: Object.keys(state.approvalRequests ?? {}).length,
    clearedApprovalAllowRules: Object.keys(state.approvalAllowRules ?? {}).length,
    clearedLogs: logFiles.length,
    preservedCurrentRepo: state.currentRepo,
    preservedCwd: state.cwd,
    preservedTelegramUpdateOffset: state.telegramUpdateOffset,
    dryRun,
  };
}

function listLogFiles(logsDir) {
  if (!existsSync(logsDir)) {
    return [];
  }

  return readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
    .map((entry) => join(logsDir, entry.name));
}

function countNestedBindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }

  let count = 0;
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      count += Object.keys(nested).length;
    }
  }
  return count;
}

function parseArgs(argv) {
  const options = { rootDir: process.cwd(), dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--root") {
      const rootDir = argv[index + 1];
      if (!rootDir) {
        throw new Error("Usage: node scripts/clear-runtime-history.js [--dry-run] [--root <path>]");
      }
      options.rootDir = rootDir;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printSummary(summary) {
  const action = summary.dryRun ? "Would clear" : "Cleared";
  console.log(`${action} runtime history in ${basename(summary.statePath)}.`);
  console.log(`tasks: ${summary.clearedTasks}`);
  console.log(`askSessions: ${summary.clearedAskSessions}`);
  console.log(`agentChatModes: ${summary.clearedAgentChatModes}`);
  console.log(`approvalRequests: ${summary.clearedApprovalRequests}`);
  console.log(`approvalAllowRules: ${summary.clearedApprovalAllowRules}`);
  console.log(`logs: ${summary.clearedLogs}`);
  console.log(`preserved currentRepo: ${summary.preservedCurrentRepo ?? "null"}`);
  console.log(`preserved cwd: ${summary.preservedCwd ?? "null"}`);
  console.log(`preserved telegramUpdateOffset: ${summary.preservedTelegramUpdateOffset ?? "null"}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    printSummary(clearRuntimeHistory(parseArgs(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
