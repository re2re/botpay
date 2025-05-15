import { Env } from './env';

/** Обеспечить существование нужных таблиц */
async function ensureTables(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS terminals (
      id       INTEGER PRIMARY KEY,
      enabled  INTEGER NOT NULL DEFAULT 1,
      balance  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS inkass_events (
      terminal_id  INTEGER    NOT NULL,
      created_at   INTEGER    NOT NULL,
      status       TEXT       NOT NULL DEFAULT 'new',
      PRIMARY KEY (terminal_id, created_at)
    );
  `).run();
}

/** Оригинальная логика авторизации */
export async function authorizeTerminal(req: Request, env: Env): Promise<Response> {
  try {
    const { terminal_id } = await req.json();
    if (typeof terminal_id !== 'number') {
      return new Response(JSON.stringify({ ok: false, error: 'INVALID_ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const result = await env.DB
      .prepare('SELECT id FROM terminals WHERE id = ?')
      .bind(terminal_id)
      .first();
    if (!result) {
      return new Response(JSON.stringify({ ok: false, error: 'NOT_FOUND' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'SERVER_ERROR' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/** Сбросить баланс терминала на 0 */
export async function resetBalance(env: Env, terminalId: number) {
  await ensureTables(env);
  await env.DB
    .prepare('UPDATE terminals SET balance = 0 WHERE id = ?')
    .bind(terminalId)
    .run();
}

/** Записать факт инкассации (status='new') */
export async function recordInkass(env: Env, terminalId: number) {
  await ensureTables(env);
  const now = Date.now();
  await env.DB
    .prepare(`
      INSERT INTO inkass_events (terminal_id, created_at)
      VALUES (?, ?)
      ON CONFLICT(terminal_id, created_at) DO NOTHING
    `)
    .bind(terminalId, now)
    .run();
}

/** Опционально: методы для смены статуса */
export async function markInkassPending(env: Env, terminalId: number, createdAt: number) {
  await env.DB
    .prepare(`
      UPDATE inkass_events
         SET status = 'pending'
       WHERE terminal_id = ? AND created_at = ?
    `)
    .bind(terminalId, createdAt)
    .run();
}

export async function markInkassDone(env: Env, terminalId: number, createdAt: number) {
  await env.DB
    .prepare(`
      UPDATE inkass_events
         SET status = 'done'
       WHERE terminal_id = ? AND created_at = ?
    `)
    .bind(terminalId, createdAt)
    .run();
}

  