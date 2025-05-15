import { Env } from './env.ts';

export async function register(req: Request, env: Env): Promise<Response> {
  const { id } = await req.json();
  
  if (!id) {
    return new Response(JSON.stringify({ ok: false, error: 'BAD_REQUEST' }), { status: 400 });
  }

  const exists = await env.DB
    .prepare('SELECT 1 FROM terminals WHERE id = ?')
    .bind(id)
    .first();

  if (exists) {
    return new Response(JSON.stringify({ ok: false, error: 'ID_EXISTS' }), { status: 409 });
  }

  await env.DB
    .prepare('INSERT INTO terminals (id, enabled) VALUES (?, 1)')
    .bind(id)
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 201 });
}
