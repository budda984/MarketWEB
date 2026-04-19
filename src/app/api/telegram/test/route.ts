import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: s } = await supabase
    .from('user_settings')
    .select('telegram_bot_token, telegram_chat_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!s?.telegram_bot_token || !s?.telegram_chat_id) {
    return NextResponse.json(
      { error: 'Telegram non configurato' },
      { status: 400 }
    );
  }

  const ok = await sendTelegramMessage({
    token: s.telegram_bot_token,
    chatId: s.telegram_chat_id,
    text:
      '✅ *Market Monitor Pro*\n\nLa configurazione Telegram funziona.\nRiceverai qui i segnali dallo scanner automatico.',
  });

  if (!ok) {
    return NextResponse.json(
      { error: 'Invio fallito. Controlla token e chat_id.' },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
