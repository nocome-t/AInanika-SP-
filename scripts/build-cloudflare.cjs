const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public');
const WEB_DIR = path.join(ROOT, 'web');
const ASSET_DIR = path.join(OUT_DIR, 'asset', 'bundled');

const ROOT_FILES = [
  'ainanika_icon.png',
  'ainanika_logo.png',
  'button_dress.png',
  'button_hanasu.png',
  'button_session.png',
  'ghost.json',
  'ghost_design.json',
  'ghost_excited.png',
  'ghost_happy.png',
  'ghost_normal.png',
  'ghost_nutral.png',
  'ghost_sad.png',
  'ghost_shy.png',
  'ghost_surprised.png',
  'main_menu.png',
  'persona.txt',
  'qa.txt',
  'style_examples.json',
  'topics.json',
  'window_yoko.png',
];

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

resetDir(OUT_DIR);
fs.mkdirSync(ASSET_DIR, { recursive: true });

for (const fileName of fs.readdirSync(WEB_DIR)) {
  copyFile(path.join(WEB_DIR, fileName), path.join(OUT_DIR, fileName));
}

for (const fileName of ROOT_FILES) {
  const src = path.join(ROOT, fileName);
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(fileName)) {
    copyFile(src, path.join(ASSET_DIR, fileName));
  } else {
    copyFile(src, path.join(OUT_DIR, fileName));
  }
}

copyFile(path.join(ROOT, 'ainanika_icon.png'), path.join(OUT_DIR, 'favicon.ico'));

fs.writeFileSync(path.join(OUT_DIR, '_routes.json'), JSON.stringify({
  version: 1,
  include: ['/api/*'],
  exclude: [],
}, null, 2));

console.log(`Built Cloudflare Pages output: ${OUT_DIR}`);
