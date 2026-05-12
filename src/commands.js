import {
  COMMANDS,
  COMMANDS_REQUIRING_ARGS,
  UNKNOWN_COMMAND_RESPONSE,
} from "./constants.js";

const COMMAND_SET = new Set(COMMANDS);

export function parseCommand(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed.startsWith("/")) {
    return { ok: false, response: UNKNOWN_COMMAND_RESPONSE };
  }

  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const command = match?.[1] ?? "";
  const args = (match?.[2] ?? "").trim();

  if (!COMMAND_SET.has(command)) {
    return { ok: false, response: UNKNOWN_COMMAND_RESPONSE };
  }

  const usage = COMMANDS_REQUIRING_ARGS[command];
  if (usage && args.length === 0) {
    return { ok: false, response: usage };
  }

  return { ok: true, command, args };
}

export function commandList() {
  return [...COMMANDS];
}
