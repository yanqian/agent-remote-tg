import { NO_WORKSPACE_RESPONSE } from "./constants.js";
import { lookupRepo, formatRepos } from "./repositories.js";

export function requireWorkspace(state) {
  if (!state.cwd || !state.currentRepo) {
    return { ok: false, response: NO_WORKSPACE_RESPONSE };
  }

  return { ok: true, cwd: state.cwd, currentRepo: state.currentRepo };
}

export function handleRepos(repos) {
  return { response: formatRepos(repos), stateChanged: false };
}

export function handleUse(args, repos, state) {
  const found = lookupRepo(repos, args);
  if (!found.ok) {
    return { response: found.response, stateChanged: false, state };
  }

  const nextState = {
    ...state,
    currentRepo: found.alias,
    cwd: found.path,
  };

  return {
    response: `Workspace switched:\n${found.alias}\n${found.path}`,
    stateChanged: true,
    state: nextState,
  };
}

export function handlePwd(state) {
  const workspace = requireWorkspace(state);
  if (!workspace.ok) {
    return { response: workspace.response, stateChanged: false };
  }

  return { response: workspace.cwd, stateChanged: false };
}
