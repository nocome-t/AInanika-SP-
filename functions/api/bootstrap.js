const ASSET_FILES = [
  'ainanika_icon.png',
  'ainanika_logo.png',
  'ghost_excited.png',
  'ghost_happy.png',
  'ghost_normal.png',
  'ghost_nutral.png',
  'ghost_sad.png',
  'ghost_shy.png',
  'ghost_surprised.png',
  'main_menu.png',
  'window_yoko.png',
];

const DEFAULT_PERSONA = 'あなたはAInanikaのGhostです。短く自然に話します。';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

async function readAsset(request, fileName, fallback = '') {
  try {
    const url = new URL(`/${fileName}`, request.url);
    const response = await fetch(url);
    if (!response.ok) return fallback;
    if (response.headers.get('Content-Type')?.includes('text/html') && !fileName.endsWith('.html')) {
      return fallback;
    }
    return await response.text();
  } catch {
    return fallback;
  }
}

function parseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const [
    persona,
    topicsText,
    styleExamplesText,
    ghostDesignText,
    messagesText,
    qaText,
    emoteCsv,
    ghostText,
  ] = await Promise.all([
    readAsset(request, 'persona.txt', DEFAULT_PERSONA),
    readAsset(request, 'topics.json', '[]'),
    readAsset(request, 'style_examples.json', '[]'),
    readAsset(request, 'ghost_design.json', '{}'),
    readAsset(request, 'messages.json', '{}'),
    readAsset(request, 'qa.txt', ''),
    readAsset(request, 'emote.csv', ''),
    readAsset(request, 'ghost.json', '{}'),
  ]);

  const ghostMeta = parseJson(ghostText, {});

  return json({
    ok: true,
    ghost: {
      id: 'bundled-default-ghost',
      displayName: ghostMeta.displayName || ghostMeta.characterName || ghostMeta.name || 'AIなにか',
      persona,
      topics: parseJson(topicsText, []),
      messages: parseJson(messagesText, {}),
      styleExamples: parseJson(styleExamplesText, []),
      ghostDesign: parseJson(ghostDesignText, {}),
      emoteCsv,
      qaText,
      assetBase: '/asset/bundled/',
      assets: ASSET_FILES,
      shells: [],
    },
    hasApiKey: Boolean(env.OPENAI_API_KEY),
    canConfigureApiKey: false,
    model: env.OPENAI_MODEL || 'gpt-5-mini',
  });
}
