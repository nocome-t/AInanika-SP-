const DEFAULT_MESSAGES = {
  welcome: '[通常]Web版AInanikaだよ。[SEP][喜]Chromeの中でも、ちゃんとここにいるね。',
  error: '[哀]うまく言葉が出てこなかったみたい…。',
  conv_start: '[通常]おっけー、会話モードにするね。[SEP][喜]やめたい時は end って打ってね。',
  conv_end: '[喜]おっけー！また話そ♪',
  deck_add: '[通常]追加したい話題を教えて。',
  deck_done: '[喜]おっけー！これでもっと楽しくおしゃべりできるね。',
  profile_done: '[喜]ありがとう。ちゃんと覚えておくね。',
  timer_prompt: '[通常]何分後にお知らせする？',
  timer_start: '[喜]オッケー！時間になったらお知らせするよ。[SEP][通常]それまでは静かにしておくね。',
  timer_done: '[驚]時間だよ！お疲れ様。',
};

const DEFAULT_EXPRESSION_MAP = {
  '[通常]': 'ghost_normal.png',
  '[喜]': 'ghost_happy.png',
  '[哀]': 'ghost_sad.png',
  '[驚]': 'ghost_surprised.png',
  '[照]': 'ghost_shy.png',
  '[興奮]': 'ghost_excited.png',
};

const STORAGE_KEY = 'ainanika-web-state-v1';
const ASSET_VERSION = '20260609-background-image';
const IDLE_GHOST_FILE = 'ghost_nutral.png';
const CRITICAL_APNG_FILES = [IDLE_GHOST_FILE];
const DEFAULT_USER_NAME = 'キミ';
const MAX_HISTORY = 20;
const MAX_FACTS = 30;
const BACKGROUND_DB_NAME = 'ainanika-web-assets';
const BACKGROUND_STORE_NAME = 'backgrounds';
const BACKGROUND_KEY = 'custom-background';
const MIN_BACKGROUND_WIDTH = 480;
const MIN_BACKGROUND_HEIGHT = 720;

const elements = {};
const state = {
  hasApiKey: false,
  canConfigureApiKey: false,
  model: 'gpt-5-mini',
  mode: 'single',
  menuOpen: false,
  menuPage: 0,
  activeGhost: null,
  crosstalkGhost: null,
  history: [],
  crosstalkHistory: [],
  userFacts: [],
  conversationMode: false,
  messageQueue: [],
  queueIndex: 0,
  timerId: null,
  isCalling: false,
  ime: { input: false, modal: false },
  modalConfirm: null,
  nextCrosstalkSpeaker: 0,
  backgroundObjectUrl: '',
};

function $(id) {
  return document.getElementById(id);
}

function safeParseJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function splitMessage(message) {
  return String(message || '')
    .split('[SEP]')
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripTags(text) {
  return String(text || '')
    .replace(/\[MEMO:[^\]]*\]/g, '')
    .replace(/[\[【][^\]】]+[\]】]/g, '')
    .trim();
}

function pickRandom(items, fallback = '') {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items[Math.floor(Math.random() * items.length)];
}

function getMessages(ghost = state.activeGhost) {
  return { ...DEFAULT_MESSAGES, ...(ghost?.messages || {}) };
}

function setLoadingProgress(done, total, label = '') {
  if (!elements.loadingText || !elements.loadingBarFill) return;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  elements.loadingBarFill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  elements.loadingText.textContent = label || `loading... ${percent}%`;
}

function finishLoading() {
  document.querySelector('.appShell')?.removeAttribute('data-loading');
}

function showNotice(message, timeout = 3200) {
  elements.notice.textContent = message;
  elements.notice.classList.remove('hidden');
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => elements.notice.classList.add('hidden'), timeout);
}

function openBackgroundDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKGROUND_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BACKGROUND_STORE_NAME)) {
        db.createObjectStore(BACKGROUND_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('背景画像の保存領域を開けませんでした。'));
  });
}

async function useBackgroundStore(mode, operation) {
  const db = await openBackgroundDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(BACKGROUND_STORE_NAME, mode);
      const store = transaction.objectStore(BACKGROUND_STORE_NAME);
      const request = operation(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('背景画像の保存に失敗しました。'));
    });
  } finally {
    db.close();
  }
}

function saveBackgroundImage(blob) {
  return useBackgroundStore('readwrite', (store) => store.put(blob, BACKGROUND_KEY));
}

function loadBackgroundImage() {
  return useBackgroundStore('readonly', (store) => store.get(BACKGROUND_KEY));
}

function deleteBackgroundImage() {
  return useBackgroundStore('readwrite', (store) => store.delete(BACKGROUND_KEY));
}

function readImageDimensions(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした。'));
    };
    image.src = url;
  });
}

function applyBackgroundImage(blob) {
  if (state.backgroundObjectUrl) URL.revokeObjectURL(state.backgroundObjectUrl);
  state.backgroundObjectUrl = blob ? URL.createObjectURL(blob) : '';
  elements.stage.style.backgroundImage = state.backgroundObjectUrl
    ? `url("${state.backgroundObjectUrl}")`
    : '';
}

async function restoreBackgroundImage() {
  try {
    const blob = await loadBackgroundImage();
    if (blob instanceof Blob) applyBackgroundImage(blob);
  } catch (error) {
    console.warn('Background image could not be restored:', error);
  }
}

function chooseBackgroundImage() {
  setMenuOpen(false);
  elements.backgroundImageInput.value = '';
  elements.backgroundImageInput.click();
}

async function handleBackgroundImageSelection() {
  const file = elements.backgroundImageInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showNotice('画像ファイルを選んでください。', 5200);
    return;
  }

  try {
    const { width, height } = await readImageDimensions(file);
    if (width < MIN_BACKGROUND_WIDTH || height < MIN_BACKGROUND_HEIGHT) {
      showNotice(`背景画像は横${MIN_BACKGROUND_WIDTH}px以上・縦${MIN_BACKGROUND_HEIGHT}px以上が必要です。`, 6200);
      return;
    }

    await saveBackgroundImage(file);
    applyBackgroundImage(file);
    showNotice('背景画像を変更しました。');
  } catch (error) {
    showNotice(error.message || '背景画像を設定できませんでした。', 6200);
  }
}

async function resetBackgroundImage() {
  setMenuOpen(false);
  try {
    await deleteBackgroundImage();
    applyBackgroundImage(null);
    showNotice('背景画像を標準に戻しました。');
  } catch (error) {
    showNotice(error.message || '背景画像を戻せませんでした。', 6200);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.reason || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function readStoredState() {
  return safeParseJson(localStorage.getItem(STORAGE_KEY), {});
}

function containsLegacyUserName(text) {
  return /らいむ|ライム|lime/i.test(String(text || ''));
}

function isUserNameFact(text) {
  return /(呼び名|呼んで|名前|name)/i.test(String(text || ''));
}

function sanitizeUserFacts(facts) {
  return (Array.isArray(facts) ? facts : [])
    .map((fact) => String(fact || '').trim())
    .filter(Boolean)
    .filter((fact) => !containsLegacyUserName(fact))
    .filter((fact) => !isUserNameFact(fact));
}

function sanitizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .filter((item) => item && typeof item.content === 'string')
    .filter((item) => !containsLegacyUserName(item.content));
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    history: state.history.slice(-MAX_HISTORY),
    crosstalkHistory: state.crosstalkHistory.slice(-MAX_HISTORY),
    userFacts: state.userFacts.slice(-MAX_FACTS),
    topics: state.activeGhost?.topics || [],
  }));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const source = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function expressionTags(label) {
  const normalized = String(label || '').trim();
  if (!normalized) return [];
  const tags = new Set([`[${normalized.replace(/^\[|\]$/g, '')}]`]);
  const japanese = normalized.replace(/\s*[（(].*?[）)]\s*/g, '').trim();
  if (japanese) tags.add(`[${japanese.replace(/^\[|\]$/g, '')}]`);
  for (const match of normalized.matchAll(/[（(]\s*([^）)]+?)\s*[）)]/g)) {
    if (match[1]) tags.add(`[${match[1].trim()}]`);
  }
  return [...tags];
}

function buildExpressionData(emoteCsv, assets) {
  const assetSet = new Set(assets || []);
  const map = {};
  for (const [tag, fileName] of Object.entries(DEFAULT_EXPRESSION_MAP)) {
    if (tag === '[通常]' || assetSet.has(fileName)) map[tag] = fileName;
  }

  const rows = parseCsvRows(emoteCsv).slice(1).filter((row) => row.length >= 3);
  const promptRows = [];
  for (const row of rows.slice(0, 24)) {
    const label = row[0];
    const description = row[1] || '';
    const fileName = row[2];
    if (!label || !fileName || !assetSet.has(fileName)) continue;
    for (const tag of expressionTags(label)) map[tag] = fileName;
    promptRows.push({ label, description, fileName });
  }

  const prompt = [
    '【表情タグ】',
    '・返答の各パートの先頭に、表情タグを1つだけ付けてください。',
    '・使える表情タグから発話のニュアンスに最も近いものを選んでください。',
    promptRows.length
      ? promptRows.map((row, index) => `${index + 1}. [${row.label}] ${row.description} -> ${row.fileName}`).join('\n')
      : `・利用可能な基本表情: ${Object.keys(map).join(' ')}`,
  ].join('\n');

  return { expressionMap: map, expressionPrompt: prompt };
}

function assetUrl(ghost, fileName) {
  if (!ghost) return '';
  const url = ghost.assetUrls[fileName] || ghost.assetUrls['ghost_normal.png'] || '';
  if (!url || url.startsWith('blob:') || url.includes('?')) return url;
  return `${url}?v=${ASSET_VERSION}`;
}

function isApngAsset(fileName) {
  return /^ghost_.*\.png$/i.test(String(fileName || ''));
}

function preloadImage(url, priority = 'auto', timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    image.decoding = 'async';
    image.fetchPriority = priority;
    image.onload = () => finish({ ok: true, url });
    image.onerror = () => reject(new Error(`failed to load: ${url}`));
    if (timeoutMs > 0) {
      timer = setTimeout(() => finish({ ok: false, url, timeout: true }), timeoutMs);
    }
    image.src = url;
  });
}

function ghostAnimationFiles(ghost) {
  return [...new Set(Object.values(ghost.expressionMap || {}))]
    .filter((fileName) => isApngAsset(fileName) && ghost.assetUrls?.[fileName]);
}

async function preloadGhostAnimations(ghost, options = {}) {
  const {
    files = ghostAnimationFiles(ghost),
    label = 'アニメーションを読み込んでいます',
    priority = 'auto',
    updateLoading = true,
  } = options;

  if (!files.length) {
    if (updateLoading) setLoadingProgress(1, 1, 'loading... 100%');
    return;
  }

  if (updateLoading) setLoadingProgress(0, files.length, `${label}... 0%`);
  const failures = [];
  const timeouts = [];
  for (let index = 0; index < files.length; index += 1) {
    const fileName = files[index];
    try {
      const result = await preloadImage(assetUrl(ghost, fileName), priority, options.timeoutMs || 0);
      if (!result.ok && result.timeout) timeouts.push(fileName);
      if (!result.ok && !result.timeout) failures.push(fileName);
    } catch (error) {
      failures.push(fileName);
    }
    if (updateLoading) {
      setLoadingProgress(index + 1, files.length, `${label}... ${index + 1}/${files.length}`);
    }
  }

  if (failures.length) {
    console.warn('Some APNG assets failed to preload:', failures);
  }
  if (timeouts.length) {
    console.info('Some APNG assets are still loading in the background:', timeouts);
  }
}

function preloadRemainingGhostAnimations(ghost) {
  const critical = new Set(CRITICAL_APNG_FILES);
  const remaining = ghostAnimationFiles(ghost).filter((fileName) => !critical.has(fileName));
  const run = () => preloadGhostAnimations(ghost, {
    files: remaining,
    label: '追加アニメーションを読み込んでいます',
    priority: 'low',
    updateLoading: false,
  });

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    setTimeout(run, 1400);
  }
}

function restartApng(slot, image, url, fileName) {
  const freshImage = image.cloneNode(false);
  freshImage.removeAttribute('src');
  freshImage.dataset.expressionFile = fileName;
  freshImage.dataset.apngRestart = String(Number(image.dataset.apngRestart || '0') + 1);
  image.replaceWith(freshImage);
  if (slot === 'right') {
    elements.rightGhost = freshImage;
  } else {
    elements.leftGhost = freshImage;
  }
  requestAnimationFrame(() => {
    freshImage.src = url;
  });
}

function resolveExpressionFile(ghost, message) {
  const text = String(message || '');
  if (text.includes('考え中')) return IDLE_GHOST_FILE;
  for (const [tag, fileName] of Object.entries(ghost.expressionMap || {})) {
    if (text.includes(tag)) return fileName;
  }
  return 'ghost_normal.png';
}

function setGhostImage(slot, ghost, fileName = 'ghost_normal.png') {
  const image = slot === 'right' ? elements.rightGhost : elements.leftGhost;
  const url = assetUrl(ghost, fileName) || assetUrl(ghost, 'ghost_normal.png');
  if (!url) return;

  image.dataset.expressionFile = fileName;
  if (isApngAsset(fileName)) {
    restartApng(slot, image, url, fileName);
    return;
  }

  image.src = url;
}

function showBalloon(slot, message) {
  const balloon = slot === 'right' ? elements.rightBalloon : elements.leftBalloon;
  const ghost = slot === 'right' ? state.crosstalkGhost : state.activeGhost;
  setGhostImage(slot, ghost, resolveExpressionFile(ghost, message));
  balloon.textContent = stripTags(message);
  balloon.classList.remove('hidden');
}

function hideBalloons() {
  elements.leftBalloon.classList.add('hidden');
  elements.rightBalloon.classList.add('hidden');
}

function setIdleGhostImage() {
  if (state.activeGhost) setGhostImage('left', state.activeGhost, IDLE_GHOST_FILE);
  if (state.mode === 'crosstalk' && state.crosstalkGhost) {
    setGhostImage('right', state.crosstalkGhost, IDLE_GHOST_FILE);
  }
}

function enqueueMessage(message, slot = 'left', onComplete = null) {
  state.messageQueue = splitMessage(message);
  state.queueIndex = 0;
  state.queueSlot = slot;
  state.queueComplete = typeof onComplete === 'function' ? onComplete : null;
  showNextMessage();
}

function showNextMessage() {
  if (state.messageQueue.length === 0) return;
  if (state.queueIndex >= state.messageQueue.length) {
    state.messageQueue = [];
    hideBalloons();
    setIdleGhostImage();
    const done = state.queueComplete;
    state.queueComplete = null;
    if (done) done();
    if (state.mode === 'crosstalk' && !state.isCalling) runCrosstalkTurn();
    return;
  }
  hideBalloons();
  showBalloon(state.queueSlot || 'left', state.messageQueue[state.queueIndex]);
  state.queueIndex += 1;
}

function normalizeBundleGhost(bundle) {
  const assetUrls = {};
  for (const file of bundle.assets || []) assetUrls[file] = `${bundle.assetBase}${encodeURIComponent(file)}`;
  const expression = buildExpressionData(bundle.emoteCsv, bundle.assets);
  return {
    id: bundle.id || 'bundled-default-ghost',
    displayName: bundle.displayName || 'AIなにか',
    persona: bundle.persona || '',
    topics: Array.isArray(bundle.topics) ? bundle.topics : [],
    messages: bundle.messages || {},
    styleExamples: bundle.styleExamples || [],
    qaText: bundle.qaText || '',
    assetUrls,
    shells: bundle.shells || [],
    ...expression,
  };
}

async function readFileFromHandle(handle, fileName, mode = 'text') {
  try {
    const fileHandle = await handle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return mode === 'json' ? safeParseJson(await file.text(), null) : await file.text();
  } catch {
    return mode === 'json' ? null : '';
  }
}

async function readGhostFromDirectory(handle, idPrefix = 'local', options = {}) {
  const required = ['persona.txt', 'topics.json', 'ghost_normal.png'];
  const missing = [];
  for (const fileName of required) {
    try {
      await handle.getFileHandle(fileName);
    } catch {
      missing.push(fileName);
    }
  }
  if (missing.length) {
    throw new Error(`Ghostフォルダとして必要なファイルが足りません。\n${missing.join('\n')}`);
  }

  const assetUrls = {};
  const assets = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind !== 'file' || !/\.(png|jpe?g|webp|gif|avif)$/i.test(name)) continue;
    const file = await entry.getFile();
    assets.push(name);
    assetUrls[name] = URL.createObjectURL(file);
  }

  const persona = await readFileFromHandle(handle, 'persona.txt');
  const topics = await readFileFromHandle(handle, 'topics.json', 'json');
  const messages = await readFileFromHandle(handle, 'messages.json', 'json');
  const styleExamples = await readFileFromHandle(handle, 'style_examples.json', 'json');
  const ghostJson = await readFileFromHandle(handle, 'ghost.json', 'json');
  const emoteCsv = await readFileFromHandle(handle, 'emote.csv');
  const expression = buildExpressionData(emoteCsv, assets);

  const ghost = {
    id: `${idPrefix}:${handle.name}:${Date.now()}`,
    displayName: ghostJson?.characterName || ghostJson?.displayName || ghostJson?.name || handle.name,
    persona,
    topics: Array.isArray(topics) ? topics : [],
    messages: messages || {},
    styleExamples: styleExamples || [],
    qaText: state.activeGhost?.qaText || '',
    assetUrls,
    shells: [],
    ...expression,
  };

  if (options.includeShells !== false) {
    try {
      const shellsHandle = await handle.getDirectoryHandle('shells');
      for await (const [, entry] of shellsHandle.entries()) {
        if (entry.kind !== 'directory') continue;
        try {
          const shell = await readGhostFromDirectory(entry, `shell:${handle.name}`, { includeShells: false });
          ghost.shells.push(shell);
        } catch {
          // Invalid shell folders are ignored, matching the Electron app behavior.
        }
      }
    } catch {
      ghost.shells = [];
    }
  }

  return ghost;
}

function buildSystemPrompt(ghost, options = {}) {
  const facts = state.userFacts.length
    ? state.userFacts.map((fact) => `・${fact}`).join('\n')
    : `・ユーザーの呼び名: ${DEFAULT_USER_NAME}`;
  const topic = options.topic || pickRandom(ghost.topics, '今日のこと');
  const conversationRule = state.conversationMode ? [
    '',
    '【会話モード中の追加ルール】',
    '・最後のパートは必ずユーザーに向けた疑問形で終えてください。',
    '・最後の文末は「？」「かな？」「どう思う？」など、相手が返事しやすい形にしてください。',
  ].join('\n') : '';

  const autoTalk = options.isAutoTalk ? [
    '',
    '【ランダムトーク】',
    `・今回の主題は topics.json から選ばれた話題候補「${topic}」です。`,
    '・短く自然に話しかけてください。',
  ].join('\n') : '';

  return [
    '【最重要】',
    '・あなたの人格、口調、価値観、話し方は、下の persona.txt の内容だけを正として使ってください。',
    '・以前のghostの人格や口調を引き継いではいけません。',
    '',
    '【persona.txt】',
    ghost.persona,
    '',
    '【覚えているユーザー情報】',
    facts,
    '',
    '【ブラウザ版の呼び名ルール】',
    `・ユーザーの呼び名が明示的に保存されていない場合、必ず「${DEFAULT_USER_NAME}」と呼んでください。`,
    '・「らいむ」は例文由来の古い呼び名です。現在のユーザー名として使ってはいけません。',
    '',
    ghost.expressionPrompt,
    autoTalk,
    conversationRule,
  ].join('\n');
}

async function callAI(userText = '', options = {}) {
  if (state.isCalling) return;
  if (!state.hasApiKey) {
    showApiKeyDialog();
    return;
  }

  state.isCalling = true;
  showBalloon('left', '[通常]考え中…。');

  try {
    const ghost = state.activeGhost;
    const history = options.isAutoTalk ? [] : state.history.slice(-12);
    const input = [
      { role: 'system', content: buildSystemPrompt(ghost, options) },
      ...history,
    ];

    if (userText) {
      const suffix = state.conversationMode ? '\n\n会話モード中なので、返答の最後は必ずユーザーへの質問で終えてください。' : '';
      input.push({ role: 'user', content: `${userText}${suffix}` });
      state.history.push({ role: 'user', content: userText });
    } else {
      input.push({ role: 'user', content: 'topics.json の話題を主題にしたランダムトークとして、短く話しかけてください。' });
    }

    const result = await api('/api/respond', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });

    const reply = result.text || getMessages().error;
    state.history.push({ role: 'assistant', content: reply });
    state.history = state.history.slice(-MAX_HISTORY);
    persistState();
    enqueueMessage(reply, 'left');
  } catch (error) {
    if (error.status === 401 || error.status === 403) state.hasApiKey = false;
    enqueueMessage(getMessages().error, 'left');
  } finally {
    state.isCalling = false;
  }
}

function buildCrosstalkPrompt(speaker, listener) {
  return [
    '【CrossTalk】',
    'あなたは別のGhostと短く会話しています。',
    '返答は1〜3パート、各パートは短めにし、必要なら [SEP] で区切ってください。',
    '相手への自然な反応を優先してください。',
    '',
    '【あなたのpersona.txt】',
    speaker.persona,
    '',
    '【相手】',
    listener.displayName,
    '',
    speaker.expressionPrompt,
  ].join('\n');
}

async function runCrosstalkTurn() {
  if (state.mode !== 'crosstalk' || state.isCalling || state.messageQueue.length) return;
  if (!state.hasApiKey) {
    showApiKeyDialog();
    return;
  }

  state.isCalling = true;
  const ghosts = [state.activeGhost, state.crosstalkGhost];
  const speakerIndex = state.nextCrosstalkSpeaker;
  const speaker = ghosts[speakerIndex];
  const listener = ghosts[1 - speakerIndex];
  const slot = speakerIndex === 0 ? 'left' : 'right';
  showBalloon(slot, '[通常]考え中…。');

  try {
    const input = [
      { role: 'system', content: buildCrosstalkPrompt(speaker, listener) },
      ...state.crosstalkHistory.slice(-10),
      { role: 'user', content: state.crosstalkHistory.length ? '相手の発言を受けて、次の一言を返してください。' : 'CrossTalkを自然に始めてください。' },
    ];
    const result = await api('/api/respond', {
      method: 'POST',
      body: JSON.stringify({ input }),
    });
    const reply = result.text || '[通常]うん、少し考えてた。';
    state.crosstalkHistory.push({ role: 'assistant', content: `${speaker.displayName}: ${stripTags(reply)}` });
    state.crosstalkHistory = state.crosstalkHistory.slice(-MAX_HISTORY);
    state.nextCrosstalkSpeaker = 1 - speakerIndex;
    persistState();
    enqueueMessage(reply, slot);
  } catch {
    enqueueMessage(getMessages(speaker).error, slot);
  } finally {
    state.isCalling = false;
  }
}

function setMenuOpen(open) {
  state.menuOpen = open;
  elements.menuButton.setAttribute('aria-expanded', String(open));
  elements.messageForm.classList.toggle('hidden', open);
  elements.menuBar.classList.toggle('hidden', !open);
  renderMenu();
}

const menuPages = [
  [
    ['何か話して', () => { setMenuOpen(false); callAI('', { isAutoTalk: true }); }],
    ['会話モード', () => triggerConversationMode()],
    ['会話デッキ追加', () => showTopicInput()],
  ],
  [
    ['あなたのことを教える', () => startSelfIntro()],
    ['お着替え', () => chooseShell()],
    ['集中タイマー', () => triggerTimer()],
  ],
  [
    ['ゴースト切替\n（PCのみ）', () => switchGhost()],
    ['CrossTalk\n（PCのみ）', () => triggerCrosstalkMode()],
    ['接続状態', () => showApiKeyDialog()],
  ],
  [
    ['背景画像変更', () => chooseBackgroundImage()],
    ['背景を戻す', () => resetBackgroundImage()],
  ],
];

function renderMenu() {
  elements.menuItems.innerHTML = '';
  elements.prevMenu.disabled = state.menuPage === 0;
  elements.nextMenu.disabled = state.menuPage === menuPages.length - 1;
  const currentPage = menuPages[state.menuPage];
  elements.menuItems.style.gridTemplateColumns = `repeat(${currentPage.length}, minmax(0, 1fr))`;
  for (const [label, action] of currentPage) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menuItem';
    button.textContent = label;
    button.addEventListener('click', action);
    elements.menuItems.appendChild(button);
  }
}

function showModal(message, options = {}) {
  elements.modalText.textContent = stripTags(message);
  elements.modalInput.value = '';
  elements.choiceList.innerHTML = '';
  elements.choiceList.classList.add('hidden');
  elements.modalInput.placeholder = options.placeholder || '';
  elements.modalInput.type = options.inputType || 'text';
  elements.modalInput.classList.toggle('hidden', Boolean(options.hideInput));
  elements.modalSubmit.textContent = options.submitLabel || '教える';
  elements.modalCancel.textContent = options.cancelLabel || 'やめる';
  state.modalConfirm = options.onConfirm || null;
  elements.modal.classList.remove('hidden');
  if (!options.hideInput) elements.modalInput.focus();
}

function showChoiceModal(message, choices) {
  showModal(message, {
    hideInput: true,
    submitLabel: '閉じる',
    cancelLabel: 'やめる',
    onConfirm: hideModal,
  });

  elements.choiceList.innerHTML = '';
  elements.choiceList.classList.remove('hidden');
  for (const choice of choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = choice.label;
    button.addEventListener('click', choice.action);
    elements.choiceList.appendChild(button);
  }
}

function hideModal() {
  elements.modal.classList.add('hidden');
  state.modalConfirm = null;
}

function showApiKeyDialog() {
  setMenuOpen(false);

  if (!state.canConfigureApiKey) {
    const message = state.hasApiKey
      ? `[喜]AI接続は有効です。\n使用モデル: ${state.model}`
      : '[哀]サーバにOpenAI APIキーが設定されていません。\n管理者がサーバ環境変数 OPENAI_API_KEY を設定すると使えるようになります。';
    showModal(message, {
      hideInput: true,
      submitLabel: '閉じる',
      cancelLabel: '閉じる',
      onConfirm: hideModal,
    });
    return;
  }

  showModal('[通常]OpenAI APIキーを設定してね。\nAPIキーはこのPCのWeb版AInanikaフォルダ内に保存されるよ。', {
    placeholder: 'sk-...',
    inputType: 'password',
    submitLabel: '保存',
    onConfirm: async (value) => {
      try {
        await api('/api/config/api-key', {
          method: 'POST',
          body: JSON.stringify({ apiKey: value }),
        });
        state.hasApiKey = true;
        hideModal();
        enqueueMessage('[喜]設定できたよ。これでおしゃべりできるね。', 'left');
      } catch (error) {
        elements.modalText.textContent = error.message;
      }
    },
  });
}

function showTopicInput() {
  setMenuOpen(false);
  showModal(getMessages().deck_add, {
    placeholder: '話題を入力',
    onConfirm: (value) => {
      if (!value) return;
      state.activeGhost.topics.push(value);
      persistState();
      hideModal();
      enqueueMessage(getMessages().deck_done, 'left');
    },
  });
}

function startSelfIntro() {
  setMenuOpen(false);
  const questions = String(state.activeGhost.qaText || '').split(/\r?\n/).map((q) => q.trim()).filter(Boolean);
  const fallback = ['あなたの呼び名を教えて。', '好きなことを教えて。'];
  const queue = questions.length ? questions : fallback;
  const answers = [];

  const ask = (index) => {
    if (index >= queue.length) {
      for (const answer of answers) {
        if (!state.userFacts.includes(answer)) state.userFacts.push(answer);
      }
      state.userFacts = state.userFacts.slice(-MAX_FACTS);
      persistState();
      hideModal();
      enqueueMessage(getMessages().profile_done, 'left');
      return;
    }

    showModal(`[通常]${queue[index]}`, {
      placeholder: `${index + 1}/${queue.length} 回答を入力`,
      onConfirm: (value) => {
        if (!value) return;
        answers.push(`${queue[index]} ${value}`);
        ask(index + 1);
      },
    });
  };

  ask(0);
}

function triggerConversationMode() {
  setMenuOpen(false);
  state.mode = 'single';
  document.querySelector('.appShell').dataset.mode = 'single';
  elements.rightGhostWrap.classList.add('hidden');
  elements.rightBalloon.classList.add('hidden');
  state.conversationMode = true;
  enqueueMessage(getMessages().conv_start, 'left', () => callAI('', { isAutoTalk: true }));
}

function triggerTimer() {
  setMenuOpen(false);
  showModal(getMessages().timer_prompt, {
    placeholder: '1〜100',
    onConfirm: (value) => {
      const minutes = Number.parseInt(value, 10);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 100) return;
      hideModal();
      if (state.timerId) clearTimeout(state.timerId);
      enqueueMessage(getMessages().timer_start, 'left');
      state.timerId = setTimeout(() => {
        state.timerId = null;
        enqueueMessage(getMessages().timer_done, 'left');
      }, minutes * 60 * 1000);
    },
  });
}

async function switchGhost() {
  setMenuOpen(false);
  try {
    if (!window.showDirectoryPicker) {
      showNotice('このChromeではフォルダ選択APIが使えません。最新版Chromeで開いてください。', 5200);
      return;
    }
    const handle = await window.showDirectoryPicker();
    const ghost = await readGhostFromDirectory(handle, 'ghost');
    state.activeGhost = ghost;
    state.mode = 'single';
    state.conversationMode = false;
    elements.rightGhostWrap.classList.add('hidden');
    hideBalloons();
    setGhostImage('left', ghost);
    enqueueMessage('[喜]ゴーストを切り替えたよ。', 'left');
  } catch (error) {
    showNotice(error.message || 'ゴーストを切り替えられませんでした。', 5200);
  }
}

async function chooseShell() {
  setMenuOpen(false);
  const shells = state.activeGhost.shells || [];
  if (!shells.length) {
    showNotice('このWeb版では、同梱Shellが見つからない場合は「ゴースト切替」からフォルダを選んでください。');
    return;
  }

  showChoiceModal('[通常]どのShellにお着替えする？', shells.map((shell) => ({
    label: shell.displayName,
    action: () => {
      const availableShells = state.activeGhost.shells || [];
      state.activeGhost = {
        ...shell,
        messages: { ...state.activeGhost.messages, ...shell.messages },
        qaText: state.activeGhost.qaText,
        shells: availableShells,
      };
      hideModal();
      setGhostImage('left', state.activeGhost);
      enqueueMessage('[喜]着替えたよ。どうかな？', 'left');
    },
  })));
}

async function triggerCrosstalkMode() {
  setMenuOpen(false);
  try {
    if (!window.showDirectoryPicker) {
      showNotice('このChromeではフォルダ選択APIが使えません。最新版Chromeで開いてください。', 5200);
      return;
    }
    showModal('CrossTalk Modeに切り替えます\n\n対話するゴーストを選択してください', {
      hideInput: true,
      submitLabel: '選択',
      cancelLabel: 'キャンセル',
      onConfirm: async () => {
        const handle = await window.showDirectoryPicker();
        const ghost = await readGhostFromDirectory(handle, 'crosstalk');
        state.crosstalkGhost = ghost;
        state.mode = 'crosstalk';
        state.conversationMode = false;
        state.nextCrosstalkSpeaker = 0;
        state.crosstalkHistory = [];
        elements.rightGhostWrap.classList.remove('hidden');
        setGhostImage('right', ghost);
        hideModal();
        enqueueMessage('[喜]CrossTalk状態に切り替えたよ。', 'left', () => runCrosstalkTurn());
      },
    });
  } catch (error) {
    showNotice(error.message || 'CrossTalkに切り替えられませんでした。', 5200);
  }
}

function setupEvents() {
  elements.menuButton.addEventListener('click', () => setMenuOpen(!state.menuOpen));
  elements.quickTalk.addEventListener('click', () => {
    setMenuOpen(false);
    callAI('', { isAutoTalk: true });
  });
  elements.quickConversation.addEventListener('click', triggerConversationMode);
  elements.quickShell.addEventListener('click', chooseShell);
  elements.prevMenu.addEventListener('click', () => {
    state.menuPage = Math.max(0, state.menuPage - 1);
    renderMenu();
  });
  elements.nextMenu.addEventListener('click', () => {
    state.menuPage = Math.min(menuPages.length - 1, state.menuPage + 1);
    renderMenu();
  });
  elements.leftBalloon.addEventListener('click', showNextMessage);
  elements.rightBalloon.addEventListener('click', showNextMessage);
  elements.backgroundImageInput.addEventListener('change', handleBackgroundImageSelection);

  elements.messageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = elements.messageInput.value.trim();
    if (!value) return;
    elements.messageInput.value = '';

    if (state.conversationMode && value.toLowerCase() === 'end') {
      state.conversationMode = false;
      enqueueMessage(getMessages().conv_end, 'left');
      return;
    }

    if (state.mode === 'crosstalk') {
      state.crosstalkHistory.push({ role: 'user', content: value });
      runCrosstalkTurn();
      return;
    }

    callAI(value);
  });

  elements.modalCancel.addEventListener('click', hideModal);
  elements.modalSubmit.addEventListener('click', async () => {
    if (!state.modalConfirm) return;
    await state.modalConfirm(elements.modalInput.value.trim());
  });
  elements.modalInput.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || event.isComposing || state.ime.modal) return;
    event.preventDefault();
    if (state.modalConfirm) await state.modalConfirm(elements.modalInput.value.trim());
  });
  elements.modalInput.addEventListener('compositionstart', () => { state.ime.modal = true; });
  elements.modalInput.addEventListener('compositionend', () => { setTimeout(() => { state.ime.modal = false; }, 0); });
}

async function boot() {
  for (const id of [
    'leftBalloon', 'rightBalloon', 'leftGhost', 'rightGhost', 'rightGhostWrap',
    'menuButton', 'quickTalk', 'quickConversation', 'quickShell',
    'messageForm', 'messageInput', 'sendButton', 'menuBar', 'menuItems',
    'prevMenu', 'nextMenu', 'modal', 'modalText', 'modalInput',
    'choiceList', 'modalCancel', 'modalSubmit', 'notice',
    'loadingScreen', 'loadingText', 'loadingBarFill', 'stage', 'backgroundImageInput',
  ]) {
    elements[id] = $(id);
  }

  setupEvents();
  renderMenu();
  await restoreBackgroundImage();

  const bootData = await api('/api/bootstrap');
  state.hasApiKey = bootData.hasApiKey;
  state.canConfigureApiKey = bootData.canConfigureApiKey;
  state.model = bootData.model;
  state.activeGhost = normalizeBundleGhost(bootData.ghost);

  const stored = readStoredState();
  state.history = sanitizeHistory(stored.history);
  state.crosstalkHistory = sanitizeHistory(stored.crosstalkHistory);
  state.userFacts = sanitizeUserFacts(stored.userFacts);
  if (Array.isArray(stored.topics) && stored.topics.length) {
    state.activeGhost.topics = stored.topics;
  }
  persistState();

  const criticalFiles = CRITICAL_APNG_FILES.filter((fileName) => state.activeGhost.assetUrls?.[fileName]);
  await preloadGhostAnimations(state.activeGhost, {
    files: criticalFiles,
    label: '初期アニメーションを読み込んでいます',
    priority: 'high',
    timeoutMs: 12000,
  });
  finishLoading();
  setIdleGhostImage();
  enqueueMessage(getMessages().welcome, 'left');
  preloadRemainingGhostAnimations(state.activeGhost);
  if (!state.hasApiKey) showApiKeyDialog();
}

boot().catch((error) => {
  console.error(error);
  finishLoading();
  showNotice(error.message || '起動に失敗しました。', 6000);
});
