const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, '.webapp-data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const PORT = Number(process.env.PORT || process.argv[2] || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const ALLOW_BROWSER_API_KEY_CONFIG = process.env.ALLOW_BROWSER_API_KEY_CONFIG === '1';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 24);
const rateLimitBuckets = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getConfig() {
  return readJson(CONFIG_PATH, {});
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || getConfig().openAiApiKey || '';
}

function isLocalRequest(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function canConfigureApiKey(req) {
  return ALLOW_BROWSER_API_KEY_CONFIG && isLocalRequest(req);
}

function rateLimit(req) {
  const now = Date.now();
  const key = req.socket.remoteAddress || 'unknown';
  const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  return bucket.count <= RATE_LIMIT_MAX;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body)
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_500_000) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body ? JSON.parse(body) : {}));
    req.on('error', reject);
  });
}

function safeReadText(filePath, fallback = '') {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : fallback;
  } catch {
    return fallback;
  }
}

function safeReadJson(filePath, fallback) {
  return readJson(filePath, fallback);
}

function isImageFile(fileName) {
  return /\.(png|jpe?g|webp|gif|avif)$/i.test(fileName);
}

function listAssetFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isImageFile(entry.name))
    .map((entry) => entry.name);
}

function hasRequiredGhostFiles(dir) {
  return ['persona.txt', 'topics.json', 'ghost_normal.png'].every((file) => {
    return fs.existsSync(path.join(dir, file));
  });
}

function readShellDisplayName(dir, fallbackName) {
  const meta = safeReadJson(path.join(dir, 'shell.json'), {});
  return meta.displayName || meta.characterName || meta.name || fallbackName;
}

function listShells(baseDir) {
  const shellsDir = path.join(baseDir, 'shells');
  if (!fs.existsSync(shellsDir)) return [];
  return fs.readdirSync(shellsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const shellDir = path.join(shellsDir, entry.name);
      if (!hasRequiredGhostFiles(shellDir)) return null;
      return {
        key: entry.name,
        displayName: readShellDisplayName(shellDir, entry.name),
        assetBase: `/asset/shells/${encodeURIComponent(entry.name)}/`,
      };
    })
    .filter(Boolean);
}

function readGhostBundle(dir = ROOT) {
  const assetBase = dir === ROOT ? '/asset/bundled/' : '';
  return {
    id: 'bundled-default-ghost',
    displayName: readShellDisplayName(dir, 'AIなにか'),
    persona: safeReadText(path.join(dir, 'persona.txt'), 'あなたはAInanikaのGhostです。短く自然に話します。'),
    topics: safeReadJson(path.join(dir, 'topics.json'), []),
    messages: safeReadJson(path.join(dir, 'messages.json'), {}),
    styleExamples: safeReadJson(path.join(dir, 'style_examples.json'), []),
    ghostDesign: safeReadJson(path.join(dir, 'ghost_design.json'), {}),
    emoteCsv: safeReadText(path.join(dir, 'emote.csv'), ''),
    qaText: safeReadText(path.join(ROOT, 'qa.txt'), ''),
    assetBase,
    assets: listAssetFiles(dir),
    shells: dir === ROOT ? listShells(ROOT) : [],
  };
}

function resolveAsset(parts) {
  if (parts[0] === 'bundled') {
    const fileName = decodeURIComponent(parts.slice(1).join('/'));
    const resolved = path.resolve(ROOT, fileName);
    if (path.dirname(resolved) !== ROOT || !isImageFile(resolved)) return '';
    return resolved;
  }

  if (parts[0] === 'shells' && parts.length >= 3) {
    const shellName = decodeURIComponent(parts[1]);
    const fileName = decodeURIComponent(parts.slice(2).join('/'));
    const shellDir = path.resolve(ROOT, 'shells', shellName);
    const resolved = path.resolve(shellDir, fileName);
    if (!resolved.startsWith(shellDir + path.sep) || !isImageFile(resolved)) return '';
    return resolved;
  }

  return '';
}

async function callOpenAI(input) {
  const apiKey = getApiKey();
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
      model: MODEL,
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

function fileFromWebDir(urlPath) {
  const cleanPath = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.resolve(WEB_DIR, `.${decodeURIComponent(cleanPath)}`);
  if (!resolved.startsWith(WEB_DIR + path.sep)) return '';
  return resolved;
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, hasApiKey: Boolean(getApiKey()), model: MODEL });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    sendJson(res, 200, {
      ok: true,
      ghost: readGhostBundle(),
      hasApiKey: Boolean(getApiKey()),
      canConfigureApiKey: canConfigureApiKey(req),
      model: MODEL,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/api-key') {
    if (!canConfigureApiKey(req)) {
      sendJson(res, 403, { ok: false, reason: '公開モードではブラウザからAPIキーを設定できません。' });
      return;
    }
    const body = await readBody(req);
    const apiKey = String(body.apiKey || '').trim();
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey)) {
      sendJson(res, 400, { ok: false, reason: 'APIキーの形式が正しくありません。' });
      return;
    }
    writeJson(CONFIG_PATH, { ...getConfig(), openAiApiKey: apiKey });
    sendJson(res, 200, { ok: true, hasApiKey: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config/clear-api-key') {
    if (!canConfigureApiKey(req)) {
      sendJson(res, 403, { ok: false, reason: '公開モードではブラウザからAPIキーを変更できません。' });
      return;
    }
    const config = getConfig();
    delete config.openAiApiKey;
    writeJson(CONFIG_PATH, config);
    sendJson(res, 200, { ok: true, hasApiKey: Boolean(process.env.OPENAI_API_KEY) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/respond') {
    if (!rateLimit(req)) {
      sendJson(res, 429, { ok: false, reason: '少しアクセスが集中しています。少し待ってからもう一度試してください。' });
      return;
    }
    const body = await readBody(req);
    const input = Array.isArray(body.input) ? body.input : [];
    if (input.length === 0) {
      sendJson(res, 400, { ok: false, reason: 'input が空です。' });
      return;
    }
    const data = await callOpenAI(input);
    sendJson(res, 200, { ok: true, text: extractResponseText(data), raw: data });
    return;
  }

  sendJson(res, 404, { ok: false, reason: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }

    if (pathname === '/favicon.ico') {
      const faviconPath = path.join(ROOT, 'ainanika_icon.png');
      if (fs.existsSync(faviconPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(faviconPath).pipe(res);
        return;
      }
    }

    if (pathname.startsWith('/asset/')) {
      const assetPath = resolveAsset(pathname.replace('/asset/', '').split('/'));
      if (!assetPath || !fs.existsSync(assetPath)) {
        sendJson(res, 404, { ok: false, reason: 'asset not found' });
        return;
      }
      const ext = path.extname(assetPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.png'
          ? 'public, max-age=31536000, immutable, no-transform'
          : 'public, max-age=31536000, immutable',
      });
      fs.createReadStream(assetPath).pipe(res);
      return;
    }

    const filePath = fileFromWebDir(pathname);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      sendJson(res, 404, { ok: false, reason: 'not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { ok: false, reason: error.message || 'server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AInanika web app: http://${HOST}:${PORT}`);
});
