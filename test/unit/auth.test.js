import test from "node:test";
import assert from "node:assert/strict";
import { authorizeMessage, isAuthorizedChat } from "../../src/auth.js";
import { UNAUTHORIZED_RESPONSE } from "../../src/constants.js";

test("isAuthorizedChat compares chat IDs as strings", () => {
  assert.equal(isAuthorizedChat(123, ["123"]), true);
  assert.equal(isAuthorizedChat("456", ["123"]), false);
});

test("authorizeMessage rejects unknown chat IDs", () => {
  assert.deepEqual(authorizeMessage({ chatId: "999" }, ["123"]), {
    ok: false,
    response: UNAUTHORIZED_RESPONSE,
  });
});

test("authorizeMessage accepts configured chat IDs", () => {
  assert.deepEqual(authorizeMessage({ chatId: "123" }, ["123"]), { ok: true });
});
