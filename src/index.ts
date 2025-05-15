import { register } from './register';
import { addTicket, getBalance } from './tickets';
import { scheduled as processPayments } from './runner';
import { Env } from './env';
import { notify } from './telegram';
import {
  authorizeTerminal,
  resetBalance,
  recordInkass
} from './terminals';

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }));
    }

    // — авторизация терминала
    if (url.pathname === '/api/terminals/auth' && request.method === 'POST') {
      return withCors(await authorizeTerminal(request, env));
    }

    // — список терминалов с балансом
    if (url.pathname === '/api/terminals' && request.method === 'GET') {
      const { results } = await env.DB
        .prepare('SELECT id, enabled, balance FROM terminals')
        .all();
      return withCors(Response.json(results));
    }

    // — добавить терминал
    if (url.pathname === '/api/terminals/add' && request.method === 'POST') {
      const { id } = await request.json();
      await env.DB
        .prepare('INSERT INTO terminals (id, enabled, balance) VALUES (?, 1, 0)')
        .bind(id)
        .run();
      return withCors(Response.json({ ok: true }));
    }

    // — включить/выключить терминал
    if (url.pathname === '/api/terminals/toggle' && request.method === 'POST') {
      const { id } = await request.json();
      await env.DB
        .prepare('UPDATE terminals SET enabled = NOT enabled WHERE id = ?')
        .bind(id)
        .run();
      return withCors(Response.json({ ok: true }));
    }

    // — удалить терминал
    if (url.pathname === '/api/terminals/delete' && request.method === 'POST') {
      const { id } = await request.json();
      await env.DB
        .prepare('DELETE FROM terminals WHERE id = ?')
        .bind(id)
        .run();
      return withCors(Response.json({ ok: true }));
    }

    // — инкассация: сброс баланса + запись
    if (url.pathname === '/api/inkass' && request.method === 'POST') {
      const { terminal_id } = await request.json();
      await recordInkass(env, terminal_id);
      await resetBalance(env, terminal_id);
      return withCors(Response.json({ ok: true }));
    }

    // — баланс (если нужен)
    if (url.pathname === '/api/balance' && request.method === 'GET') {
      return getBalance({ req: request, env });
    }

    // — платежные тикеты
    if (url.pathname === '/api/tickets' && request.method === 'POST') {
      return withCors(await addTicket({ req: request, env }));
    }
    if (url.pathname === '/api/tickets/new' && request.method === 'GET') {
      const { results } = await env.DB
        .prepare('SELECT id, terminal_id, amount FROM tickets WHERE status = ?')
        .bind('NEW')
        .all();
      return withCors(Response.json(results));
    }

    return withCors(new Response('Not Found', { status: 404 }));
  },

  // — объединённый cron-хэндлер: сначала платежи, потом инкассация
  async scheduled(_event: unknown, env: Env, _ctx: any) {
    console.log('>>> inkass scheduled start');

    // 1) сначала платежи
    await processPayments(_event as any, env);

    // 2) обрабатываем инкассацию
    const { results: events } = await env.DB
      .prepare(
        `SELECT terminal_id, created_at
           FROM inkass_events
          WHERE status = 'new'`
      )
      .all();

    console.log('Inkass events to send:', events);

    for (const ev of events) {

     // 1) достаём баланс из terminals
     const row: { balance: number } | undefined = await env.DB
      .prepare(`SELECT balance FROM terminals WHERE id = ?`)
      .bind(ev.terminal_id)
      .first();
     const before = row?.balance ?? 0;
      // 2) формируем текст с суммой до обнуления
     const text = `#${ev.terminal_id}\nПрошла инкассация\nСумма: ${before} ₽`;
      // 3) шлём в чат inkass
     await notify(env, text, env.CHAT_INKASS);
      // 4) помечаем событие как обработанное
     await env.DB
      .prepare(
      `UPDATE inkass_events SET status = 'done' WHERE terminal_id = ? AND created_at = ?`
      )
      .bind(ev.terminal_id, ev.created_at)
      .run();
     console.log('Marked as done:', ev);
    }

    return new Response('ok', { status: 200 });
  },
};



