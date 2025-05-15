import { Env } from "./env";

const totalByTerminal: Record<number, number> = {};

export async function addTicket(
  { req, env }: { req: Request; env: Env }
): Promise<Response> {
  const ticket = await req.json();

  /* ----------- Telegram сообщение ----------- */
  const tg   = `https://api.telegram.org/bot${env.BOT_TOKEN}`;   // унифиц
  const chat = env.CHAT_MAIN;                                    // к одному имени
  const text = `💸 Терминал ${ticket.terminal}
Сумма: ${ticket.amount} ₽
PIN: ${ticket.pin}`;

  await fetch(`${tg}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
  });

  /* ----------- записываем тикет для Runner ----------- */
  await env.DB.prepare(
    `INSERT INTO tickets (terminal_id, pin, amount, status)
     VALUES (?, ?, ?, 'NEW')`
  ).bind(ticket.terminal, ticket.pin, ticket.amount).run();

  return new Response(JSON.stringify({ ok: true }),
    { headers: { "Content-Type": "application/json" } });
}
 // ошибка 500 getBalance
 export async function getBalance(
  { req, env }: { req: Request; env: Env }
): Promise<Response> {
  const url = new URL(req.url);
  const term = Number(url.searchParams.get("terminal") ?? 0);
  if (!term) {
    return new Response("query param ?terminal=... required", { status: 400 });
  }

  // сумма всех НЕоплаченных тикетов по терминалу
  const row: any =
    await env.DB.prepare(
      `SELECT SUM(amount) AS sum FROM tickets WHERE terminal_id = ? AND status = 'NEW'`
    ).bind(term).first();

  const amount = row?.sum ?? 0;
  return new Response(JSON.stringify({ amount }), {
    headers: { "Content-Type": "application/json" },
  });
}