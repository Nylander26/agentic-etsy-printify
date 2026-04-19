import axios from "axios";

// Falla silenciosamente si las vars no están configuradas
function getCredentials(): { token: string; chatId: string } | null {
  const token = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!token || !chatId) return null;
  return { token, chatId };
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
