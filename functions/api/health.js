function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet({ env }) {
  return json({
    ok: true,
    hasApiKey: Boolean(env.OPENAI_API_KEY),
    model: env.OPENAI_MODEL || 'gpt-5-mini',
    runtime: 'cloudflare-pages',
  });
}
