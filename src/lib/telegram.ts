import axios from "axios";

// Falla silenciosamente si las vars no están configuradas
function getCredentials(): { token: string; chatId: string } | null {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return null;
  return { token, chatId };
}

export function isTelegramConfigured(): boolean {
  return getCredentials() !== null;
}

async function send(text: string): Promise<void> {
  const creds = getCredentials();
  if (!creds) return; // Telegram not configured — skip silently

  try {
    await axios.post(
      `https://api.telegram.org/bot${creds.token}/sendMessage`,
      { chat_id: creds.chatId, text, parse_mode: "HTML" },
      { timeout: 10_000 }
    );
  } catch {
    // Never crash the pipeline over a notification failure
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id: number } };
}

/**
 * Polls Telegram getUpdates for a text reply from the configured chat.
 * Returns the raw text (trimmed) of the first matching update, or null if the
 * AbortSignal fires first. Short-polling, 2s intervals.
 *
 * Notes:
 *   - Uses `offset` to consume updates so they don't replay.
 *   - Filters to messages from the configured TELEGRAM_CHAT_ID only.
 *   - Caller is responsible for the timeout (via signal).
 */
export async function waitForTelegramReply(signal: AbortSignal): Promise<string | null> {
  const creds = getCredentials();
  if (!creds) return null;

  // Initialize offset by consuming any pending updates so we only see NEW replies
  let offset: number | null = null;
  try {
    const init = await axios.get(
      `https://api.telegram.org/bot${creds.token}/getUpdates`,
      { params: { timeout: 0, allowed_updates: ["message"] }, timeout: 5_000 }
    );
    const updates = (init.data?.result ?? []) as TelegramUpdate[];
    if (updates.length > 0) offset = (updates[updates.length - 1] as TelegramUpdate).update_id + 1;
  } catch {
    // ignore — getUpdates may not be enabled if webhook is set; user must remove webhook
  }

  while (!signal.aborted) {
    try {
      const res = await axios.get(
        `https://api.telegram.org/bot${creds.token}/getUpdates`,
        {
          params: {
            timeout: 25, // long-poll up to 25s per request
            ...(offset !== null ? { offset } : {}),
            allowed_updates: ["message"],
          },
          timeout: 30_000,
        }
      );
      const updates = (res.data?.result ?? []) as TelegramUpdate[];
      for (const u of updates) {
        offset = u.update_id + 1;
        const fromChat = u.message?.chat?.id;
        if (fromChat?.toString() !== creds.chatId) continue;
        const text = u.message?.text?.trim();
        if (text) return text;
      }
    } catch {
      // Network blip — wait and retry
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
  return null;
}

export async function sendMessage(text: string): Promise<void> {
  await send(text);
}

export async function notifyDesignsReady(
  niches: string[],
  totalDesigns: number
): Promise<void> {
  const nicheList = niches.map((n) => `• ${n}`).join("\n");
  await send(
    `🎨 <b>${totalDesigns} diseños listos para revisar</b>\n\n` +
    `Nichos:\n${nicheList}\n\n` +
    `Ejecuta: <code>pnpm review</code>`
  );
}

export async function notifyPublished(count: number): Promise<void> {
  await send(`✅ <b>${count} productos publicados en Etsy</b>`);
}

export async function notifyError(phase: string, error: string): Promise<void> {
  await send(`❌ <b>Pipeline error en fase: ${phase}</b>\n\n<code>${error.slice(0, 500)}</code>`);
}
