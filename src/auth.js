import { UNAUTHORIZED_RESPONSE } from "./constants.js";

export function isAuthorizedChat(chatId, allowedChatIds) {
  return allowedChatIds.includes(String(chatId));
}

export function authorizeMessage(message, allowedChatIds) {
  if (!isAuthorizedChat(message.chatId, allowedChatIds)) {
    return { ok: false, response: UNAUTHORIZED_RESPONSE };
  }

  return { ok: true };
}
