export function validateWebhookEnv(env = process.env) {
  const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is required.");
  }

  const webhookUrl = env.TELEGRAM_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("TELEGRAM_WEBHOOK_URL is required.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new Error("TELEGRAM_WEBHOOK_URL must be a valid URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("TELEGRAM_WEBHOOK_URL must use HTTPS.");
  }

  return { telegramBotToken, webhookUrl };
}

export async function setTelegramWebhook({ telegramBotToken, webhookUrl, fetchImpl = globalThis.fetch }) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required.");
  }

  const response = await fetchImpl(`https://api.telegram.org/bot${telegramBotToken}/setWebhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ url: webhookUrl }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const description = payload?.description ? `: ${payload.description}` : "";
    throw new Error(`Telegram setWebhook failed with status ${response.status}${description}`);
  }

  return payload;
}

export async function main(env = process.env, options = {}) {
  const { telegramBotToken, webhookUrl } = validateWebhookEnv(env);
  await setTelegramWebhook({
    telegramBotToken,
    webhookUrl,
    fetchImpl: options.fetchImpl,
  });
  return `Telegram webhook set to ${webhookUrl}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((message) => {
      console.log(message);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
