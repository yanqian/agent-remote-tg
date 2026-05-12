import { createStartupContext } from "./config.js";
import { normalizeRepoConfig } from "./repositories.js";
import { loadRuntimeState } from "./runtime-state.js";

export function start(env = process.env, options = {}) {
  const context = createStartupContext(env, options);
  const repos = normalizeRepoConfig(options.repos ?? {}, context.rootDir);
  loadRuntimeState(context.statePath);

  return {
    status: "ready",
    rootDir: context.rootDir,
    logsDir: context.logsDir,
    statePath: context.statePath,
    repoCount: Object.keys(repos).length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = start();
    console.log(`agent-remote-tg ${result.status}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
