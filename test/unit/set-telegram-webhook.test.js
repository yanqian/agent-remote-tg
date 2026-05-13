import test from "node:test";
import assert from "node:assert/strict";
import {
  main,
  setTelegramWebhook,
  validateWebhookEnv,
} from "../../scripts/set-telegram-webhook.js";

test("validateWebhookEnv requires TELEGRAM_BOT_TOKEN", () => {
  assert.throws(
    () => validateWebhookEnv({ TELEGRAM_WEBHOOK_URL: "https://example.com/telegram/webhook" }),
    /TELEGRAM_BOT_TOKEN is required/,
  );
});

test("validateWebhookEnv requires TELEGRAM_WEBHOOK_URL", () => {
  assert.throws(
    () => validateWebhookEnv({ TELEGRAM_BOT_TOKEN: "token" }),
    /TELEGRAM_WEBHOOK_URL is required/,
  );
});

test("validateWebhookEnv requires a valid HTTPS webhook URL", () => {
  assert.throws(
    () => validateWebhookEnv({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_WEBHOOK_URL: "not a url" }),
    /valid URL/,
  );
  assert.throws(
    () => validateWebhookEnv({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_WEBHOOK_URL: "http://example.com/hook" }),
    /must use HTTPS/,
  );
});

test("setTelegramWebhook calls Telegram setWebhook with configured URL", async () => {
  const calls = [];
  const payload = await setTelegramWebhook({
    telegramBotToken: "test-token",
    webhookUrl: "https://example.com/telegram/webhook",
    fetchImpl(url, options) {
      calls.push({ url, options });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, result: true }),
      });
    },
  });

  assert.deepEqual(payload, { ok: true, result: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/bottest-token/setWebhook");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    url: "https://example.com/telegram/webhook",
  });
});

test("setTelegramWebhook rejects failed Telegram responses", async () => {
  await assert.rejects(
    () =>
      setTelegramWebhook({
        telegramBotToken: "test-token",
        webhookUrl: "https://example.com/telegram/webhook",
        fetchImpl() {
          return Promise.resolve({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ ok: false, description: "unauthorized" }),
          });
        },
      }),
    /status 401: unauthorized/,
  );
});

test("main validates env, sets webhook, and returns a confirmation", async () => {
  const calls = [];
  const message = await main(
    {
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_WEBHOOK_URL: "https://example.com/telegram/webhook",
    },
    {
      fetchImpl(url, options) {
        calls.push({ url, options });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ok: true, result: true }),
        });
      },
    },
  );

  assert.equal(message, "Telegram webhook set to https://example.com/telegram/webhook");
  assert.equal(calls.length, 1);
});
