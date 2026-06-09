/**
 * Unified approval prompt — used by discovery (and any future step that needs
 * a human go/no-go decision before spending API credits).
 *
 * Behavior:
 *   - Always shows a CLI prompt on stdout/stdin.
 *   - If Telegram is configured (TOKEN + CHAT_ID env vars), ALSO sends the
 *     same prompt to the chat and listens for a text reply via long-polling.
 *   - Returns whichever channel responds first (Promise.race).
 *
 * Reply syntax (works in both CLI and Telegram):
 *   - "all"           → approve every option
 *   - "1,3,5"         → approve options by 1-based index (comma-separated)
 *   - "cancel" / "n"  → abort
 */
import * as readline from "readline";
import {
  isTelegramConfigured,
  sendMessage,
  waitForTelegramReply,
} from "./telegram.js";

export type ApprovalChoice =
  | { kind: "all" }
  | { kind: "select"; indices: number[] }
  | { kind: "cancel" };

export interface ApprovalOption {
  label: string;          // short — e.g. "funny cat dad shirt"
  detail?: string;        // optional longer line
}

function parseReply(raw: string, optionCount: number): ApprovalChoice | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (text === "all" || text === "a" || text === "todos" || text === "y" || text === "yes" || text === "si") {
    return { kind: "all" };
  }
  if (text === "cancel" || text === "n" || text === "no" || text === "ninguno" || text === "abort") {
    return { kind: "cancel" };
  }
  // Try comma-separated indices
  const tokens = text.split(/[,\s]+/).filter(Boolean);
  const indices: number[] = [];
  for (const tk of tokens) {
    const n = parseInt(tk, 10);
    if (!isFinite(n) || n < 1 || n > optionCount) return null;
    indices.push(n - 1);
  }
  if (indices.length === 0) return null;
  return { kind: "select", indices };
}

function buildPromptText(title: string, options: ApprovalOption[]): string {
  const lines = [
    title,
    "",
    ...options.map((o, i) => {
      const head = `  ${i + 1}. ${o.label}`;
      return o.detail ? `${head}\n     ${o.detail}` : head;
    }),
    "",
    "Responde:",
    `  • "1"          → seleccionar uno (recomendado — procesar de a uno)`,
    `  • "1,3"        → seleccionar varios`,
    `  • "all"        → todos`,
    `  • "cancel"     → abortar`,
  ];
  return lines.join("\n");
}

function buildTelegramText(title: string, options: ApprovalOption[]): string {
  const optsLines = options
    .map((o, i) => {
      const head = `<b>${i + 1}.</b> ${o.label}`;
      return o.detail ? `${head}\n     <i>${o.detail}</i>` : head;
    })
    .join("\n");
  return (
    `🔍 <b>${title}</b>\n\n${optsLines}\n\n` +
    `Responde con: <code>1</code> (uno), <code>1,3</code> (varios), <code>all</code>, o <code>cancel</code>`
  );
}

async function askCLI(
  title: string,
  options: ApprovalOption[],
  signal: AbortSignal,
  cliRender?: string
): Promise<ApprovalChoice | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  // A caller can supply a fully pre-rendered list (colored/aligned) to replace the
  // default plain rendering. Parsing still uses `options` so indices stay correct.
  console.log("\n" + (cliRender ?? buildPromptText(title, options)) + "\n");
  process.stdout.write("> ");

  return new Promise((resolve) => {
    const onAbort = () => {
      rl.close();
      resolve(null);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    rl.once("line", (line) => {
      signal.removeEventListener("abort", onAbort);
      rl.close();
      const parsed = parseReply(line, options.length);
      if (!parsed) {
        console.log("Respuesta inválida. Reintentando...");
        askCLI(title, options, signal, cliRender).then(resolve);
        return;
      }
      resolve(parsed);
    });
  });
}

async function askTelegram(
  title: string,
  options: ApprovalOption[],
  signal: AbortSignal
): Promise<ApprovalChoice | null> {
  if (!isTelegramConfigured()) return null;

  await sendMessage(buildTelegramText(title, options));

  while (!signal.aborted) {
    const reply = await waitForTelegramReply(signal);
    if (reply === null) return null;
    const parsed = parseReply(reply, options.length);
    if (parsed) return parsed;
    await sendMessage(
      `⚠️ Respuesta no entendida: "<code>${reply.slice(0, 80)}</code>". Usa <code>all</code>, índices separados por coma, o <code>cancel</code>.`
    );
  }
  return null;
}

export async function askApproval(
  title: string,
  options: ApprovalOption[],
  opts?: { cliRender?: string }
): Promise<ApprovalChoice> {
  if (options.length === 0) return { kind: "cancel" };
  const cliRender = opts?.cliRender;

  // If Telegram isn't configured, skip the race — just CLI.
  if (!isTelegramConfigured()) {
    const controller = new AbortController();
    const result = await askCLI(title, options, controller.signal, cliRender);
    return result ?? { kind: "cancel" };
  }

  const controller = new AbortController();
  const cliPromise = askCLI(title, options, controller.signal, cliRender).then(
    (r) => ({ via: "cli" as const, result: r })
  );
  const telegramPromise = askTelegram(title, options, controller.signal).then(
    (r) => ({ via: "telegram" as const, result: r })
  );

  const winner = await Promise.race([cliPromise, telegramPromise]);
  controller.abort(); // cancel the loser

  if (winner.result !== null) {
    console.log(`\n✓ Decisión recibida vía ${winner.via}`);
    return winner.result;
  }
  // Race winner returned null — wait on the other channel
  const other = winner.via === "cli" ? telegramPromise : cliPromise;
  const settled = await other;
  return settled.result ?? { kind: "cancel" };
}
