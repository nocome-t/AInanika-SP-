const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_DEFAULT = 24;
const buckets = new Map();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 1_500_000) throw Object.assign(new Error('request body too large'), { status: 413 });
  return text ? JSON.parse(text) : {};
}

function clientKey(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')
    || 'unknown';
}

function rateLimit(request, max) {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = buckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  buckets.set(key, bucket);
  return bucket.count <= max;
}

function extractResponseText(data) {
  if (typeof data.output_text === 'string') return data.output_text.trim();
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (content.type === 'text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function callOpenAI(env, input) {
  const apiKey = env.OPENAI_API_KEY || '';
  if (!apiKey) {
    const error = new Error('OpenAI APIキーが未設定です。');
    error.status = 401;
    throw error;
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-5-mini',
      input,
      reasoning: { effort: 'minimal' },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || `OpenAI API error: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return JSON.parse(text);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const max = Number(env.RATE_LIMIT_MAX || RATE_LIMIT_MAX_DEFAULT);
    if (!rateLimit(request, max)) {
      return json({ ok: false, reason: '少しアクセスが集中しています。少し待ってからもう一度試してください。' }, 429);
    }

    const body = await readBody(request);
    const input = Array.isArray(body.input) ? body.input : [];
    if (input.length === 0) {
      return json({ ok: false, reason: 'input が空です。' }, 400);
    }

    const data = await callOpenAI(env, input);
    return json({ ok: true, text: extractResponseText(data), raw: data });
  } catch (error) {
    return json({ ok: false, reason: error.message || 'server error' }, error.status || 500);
  }
}
