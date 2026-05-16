import { spawn } from "node:child_process";

const ENABLE_ENV = "ENABLE_CODEX_STDIN_PROBE";
const CODEX_BIN_ENV = "CODEX_BIN";
const TIMEOUT_ENV = "CODEX_STDIN_PROBE_TIMEOUT_MS";

if (process.env[ENABLE_ENV] !== "1") {
  console.log(`Codex stdin probe skipped. Set ${ENABLE_ENV}=1 to run the real CLI probe.`);
  process.exit(0);
}

const codexBin = process.env[CODEX_BIN_ENV] || "codex";
const timeoutMs = parsePositiveInt(process.env[TIMEOUT_ENV], 5000);

console.log(`Running real Codex CLI stdin probe with ${codexBin}. Timeout: ${timeoutMs}ms.`);

const help = await runCommand(codexBin, ["exec", "--help"], {
  stdio: ["ignore", "pipe", "pipe"],
  timeoutMs,
});

if (help.exitCode !== 0) {
  fail(`codex exec --help failed with exit code ${help.exitCode}.\n${formatOutput(help)}`);
}

if (!/stdin/i.test(help.output) || !/prompt/i.test(help.output)) {
  fail(`codex exec --help did not document stdin/prompt behavior clearly.\n${formatOutput(help)}`);
}

const prompt = "For this stdin probe, reply with exactly: CODEX_STDIN_PROBE_DONE";
const piped = await runCommand(codexBin, ["exec", "--json", prompt], {
  stdio: ["pipe", "pipe", "pipe"],
  stdinInput: "CODEX_STDIN_PROBE_INPUT\n",
  timeoutMs,
});

console.log("Observed codex exec --json with piped stdin output:");
console.log(formatOutput(piped));

if (!/Reading additional input from stdin|<stdin>|stdin/i.test(combinedOutput(piped))) {
  fail("The piped-stdin probe did not expose observable stdin handling. Review the captured output before relying on Codex CLI stdin behavior.");
}

console.log("Codex stdin probe completed. Bot-started tasks must keep stdin ignored by default unless an explicit interactive protocol opts in.");

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${TIMEOUT_ENV} must be a positive integer when set.`);
  }
  return parsed;
}

function runCommand(command, args, { stdio, stdinInput = null, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: null, timedOut: false, stdout, stderr: `${stderr}${error.message}\n` });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, timedOut, stdout, stderr });
    });

    if (stdinInput !== null) {
      child.stdin?.end(stdinInput);
    }
  });
}

function formatOutput(result) {
  const output = combinedOutput(result);
  return [
    `exitCode=${result.exitCode}`,
    `timedOut=${result.timedOut}`,
    output.trim() || "(no output)",
  ].join("\n");
}

function combinedOutput(result) {
  return result.output ?? `${result.stdout}${result.stderr}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
