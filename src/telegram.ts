// telegram.ts
import { Env } from './env';

export async function notify(
  env: Env,
  text: string,
  chatId: string = env.CHAT_MAIN  // по умолчанию шлём в основной чат
) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });
}