/**
 * Telegram Bot API client.
 *
 * Uso: passare token e chat_id, invia messaggio con markdown.
 * Silenzia errori per non rompere il cron se Telegram è giù.
 */

const TG_API = 'https://api.telegram.org';

export type TelegramMessage = {
  token: string;
  chatId: string;
  text: string;
  parseMode?: 'Markdown' | 'HTML' | 'MarkdownV2';
  disableNotification?: boolean;
};

export async function sendTelegramMessage(msg: TelegramMessage): Promise<boolean> {
  try {
    const res = await fetch(`${TG_API}/bot${msg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: msg.chatId,
        text: msg.text,
        // HTML e' il formato usato da tutti i messaggi: con Markdown i
        // tag venivano mostrati come testo
        parse_mode: msg.parseMode ?? 'HTML',
        disable_notification: msg.disableNotification ?? false,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Formatta un riepilogo segnali in Markdown per Telegram.
 */
export function formatSignalsDigest(
  signals: Array<{
    ticker: string;
    strength: number;
    price: number;
    changePct: number;
    details: string;
  }>
): string {
  if (signals.length === 0) {
    return '📉 <b>Market Monitor</b>\n\n<i>Nessun segnale rilevato.</i>';
  }

  const forti = signals.filter((s) => s.strength === 3);
  const medi = signals.filter((s) => s.strength === 2);
  const deboli = signals.filter((s) => s.strength === 1);

  const lines: string[] = ['📈 <b>Market Monitor — Segnali</b>\n'];

  if (forti.length > 0) {
    lines.push(`🔥 <b>FORTI</b> (${forti.length})`);
    for (const s of forti.slice(0, 15)) {
      lines.push(
        `  <code>${s.ticker}</code> $${s.price.toFixed(2)} ${fmtChg(s.changePct)} — ${escHtml(s.details)}`
      );
    }
    lines.push('');
  }
  if (medi.length > 0) {
    lines.push(`⚠️ <b>MEDI</b> (${medi.length})`);
    for (const s of medi.slice(0, 10)) {
      lines.push(
        `  <code>${s.ticker}</code> $${s.price.toFixed(2)} ${fmtChg(s.changePct)}`
      );
    }
    lines.push('');
  }
  if (deboli.length > 0) {
    lines.push(`📌 Deboli: ${deboli.length}`);
  }

  return lines.join('\n');
}

function fmtChg(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * I caratteri < > & vanno neutralizzati, altrimenti Telegram interpreta
 * come tag un frammento di testo qualsiasi e rifiuta l'intero messaggio.
 */
function escHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
