import { Env } from "./env";

export async function getBalance(
    { req, env }: { req: Request; env: Env }
  ): Promise<Response> {
    const term = Number(new URL(req.url).searchParams.get('terminal') ?? 0);
    const row: any = await env.DB
      .prepare('SELECT balance FROM terminals WHERE id=?')
      .bind(term).first();
    return new Response(JSON.stringify({ balance: row?.balance ?? 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }