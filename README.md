# AInanika SP Web

スマートフォンのWebブラウザで動かす、サーバー付きWebアプリ版のAInanikaです。
OpenAI APIキーはサーバ側だけで使用し、ブラウザには送信しません。

## ローカル起動

初回だけ依存関係を準備します。

```bash
npm install
```

Web版を起動します。

```bash
OPENAI_API_KEY="sk-..." npm run web
```

起動後、Chromeで `http://127.0.0.1:4173` を開きます。

## 第三者が使えるように公開する場合

サーバー上でこのフォルダを配置し、Node.js 18以降で起動します。

```bash
npm install
HOST=0.0.0.0 PORT=4173 OPENAI_API_KEY="sk-..." npm run web
```

そのサーバーのファイアウォール、リバースプロキシ、またはホスティング環境で `PORT` に指定したポートを公開してください。
HTTPSで公開する場合は、nginx/Caddy/Cloudflare TunnelなどでこのNodeサーバーへ転送します。

例: Caddyで `https://example.com` から転送する場合

```caddyfile
example.com {
  reverse_proxy 127.0.0.1:4173
}
```

## APIキー

第三者に使ってもらう場合は、必ずサーバーの環境変数 `OPENAI_API_KEY` に設定してください。
ブラウザ上からAPIキーを保存する機能は、公開利用では無効です。

ローカル検証でブラウザから一時設定したい場合だけ、次のように起動できます。

```bash
ALLOW_BROWSER_API_KEY_CONFIG=1 npm run web
```

保存先はこのフォルダ内の `.webapp-data/config.json` です。`.webapp-data` は配布物に含めないでください。

## 環境変数

- `OPENAI_API_KEY`: OpenAI APIキー
- `OPENAI_MODEL`: 使用モデル。未指定時は `gpt-5-mini`
- `HOST`: 待ち受けホスト。公開時は `0.0.0.0`
- `PORT`: 待ち受けポート。未指定時は `4173`
- `RATE_LIMIT_MAX`: 1分あたりのAI応答回数上限。未指定時は `24`

## 主なファイル

- `server.js`: Web版のNodeサーバー
- `web/index.html`: Web版の画面
- `web/app.js`: Web版の動作
- `web/styles.css`: Web版の見た目
- `persona.txt`, `topics.json`, `ghost_*.png`: Web版に同梱する標準Ghost素材

## ainanika.com 常時公開設定

このMacでは、Cloudflare Tunnelの named tunnel `ainanika-sp` を使って次のURLを公開しています。

- https://ainanika.com
- https://www.ainanika.com

関連ファイル:

- `/Users/t_murai/.cloudflared/config.yml`: Tunnelの接続先設定
- `/Users/t_murai/.cloudflared/07f936d7-7db4-499d-a1e3-9ea88b9a893a.json`: Tunnel認証情報。外部共有しないでください
- `/Users/t_murai/Library/LaunchAgents/com.ainanika.web.plist`: AInanika Nodeサーバの自動起動設定
- `/Users/t_murai/Library/LaunchAgents/com.ainanika.cloudflared.plist`: Cloudflare Tunnelの自動起動設定
- `/Users/t_murai/Library/Logs/ainanika/`: 起動ログ

起動状態の確認:

```bash
launchctl print gui/$(id -u)/com.ainanika.web
launchctl print gui/$(id -u)/com.ainanika.cloudflared
curl -s https://ainanika.com/api/health
```

停止:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ainanika.cloudflared.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ainanika.web.plist
```

再開:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ainanika.web.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ainanika.cloudflared.plist
```

この公開は、このMacが起動していてユーザー `t_murai` がログインしている間に動作します。Macをスリープ、シャットダウン、ネットワーク切断すると公開URLも応答できなくなります。

## PCを閉じても動く公開に切り替える場合

このアプリはNode.jsだけで動作するため、RenderなどのクラウドWeb Serviceへ移すとMacを閉じても応答できます。

このフォルダにはRender向けの `render.yaml` を含めています。`OPENAI_API_KEY` はソースに保存せず、Renderの環境変数画面で設定してください。

Renderで作成する場合:

1. GitHubにこの `AInanika(SP)` フォルダを含むリポジトリを作成してpushします。
2. Render Dashboardで `New` -> `Web Service` を選び、GitHubリポジトリを接続します。
3. Root Directoryを使う場合は、このフォルダへのパスを指定します。
4. Blueprintを使う場合は `render.yaml` を検出させます。手動設定の場合は次を指定します。

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /api/health
```

環境変数:

```text
HOST=0.0.0.0
NODE_VERSION=22
OPENAI_MODEL=gpt-5-mini
RATE_LIMIT_MAX=24
OPENAI_API_KEY=sk-...
```

Renderで初回デプロイ後、Renderが発行する `https://...onrender.com/api/health` にアクセスし、`ok: true` と `hasApiKey: true` が返ることを確認します。

独自ドメイン `ainanika.com` へ切り替える場合:

1. Renderのサービス画面で `Settings` -> `Custom Domains` を開き、`ainanika.com` と `www.ainanika.com` を追加します。
2. Renderが表示するDNSレコードを、CloudflareのDNS画面に追加または置き換えます。
3. Render側でVerifyします。
4. `https://ainanika.com/api/health` がRender側に向いたことを確認します。

切り替え後は、このMacのCloudflare Tunnel公開を停止できます。

## Cloudflare Pages無料枠で公開する場合

Cloudflare Pages + Pages Functionsを使うと、Macを閉じていても `ainanika.com` から利用できます。
静的ファイルはPagesで配信し、OpenAI APIを呼ぶ `/api/respond` だけをPages Functionsで実行します。

この方式で追加した主なファイル:

- `functions/api/health.js`: Cloudflare版ヘルスチェック
- `functions/api/bootstrap.js`: Ghost設定と素材一覧を返すAPI
- `functions/api/respond.js`: OpenAI Responses APIを呼ぶAPI
- `scripts/build-cloudflare.cjs`: Cloudflare Pages用の `public/` 生成

ローカルビルド:

```bash
npm install
npm run build:cloudflare
```

ローカル確認:

```bash
npx wrangler pages dev public --compatibility-date=2026-06-08 --port=8788
```

別ターミナルで確認:

```bash
curl http://127.0.0.1:8788/api/health
curl http://127.0.0.1:8788/api/bootstrap
```

Cloudflare Dashboardで作成する場合:

1. GitHubにこのフォルダを含むリポジトリをpushします。
2. Cloudflare Dashboardで `Workers & Pages` -> `Create` -> `Pages` を選びます。
3. GitHubリポジトリを接続します。
4. ビルド設定を次のようにします。

```text
Framework preset: None
Build command: npm install && npm run build:cloudflare
Build output directory: public
Root directory: AInanika(SP) の場所
Deploy command: 空欄
```

`Workers` ではなく `Pages` として作成してください。`Deploy command` に `wrangler deploy` や `npm run deploy:cloudflare` は入れません。

環境変数とSecret:

```text
OPENAI_MODEL=gpt-5-mini
RATE_LIMIT_MAX=24
OPENAI_API_KEY=sk-...
```

`OPENAI_API_KEY` は必ずSecret/Encryptedとして保存してください。

初回デプロイ後、Cloudflareが発行する `https://<project>.pages.dev/api/health` で次を確認します。

```json
{"ok":true,"hasApiKey":true,"model":"gpt-5-mini","runtime":"cloudflare-pages"}
```

`ainanika.com` に切り替える場合:

1. Pagesプロジェクトの `Custom domains` で `ainanika.com` を追加します。
2. 必要に応じて `www.ainanika.com` も追加します。
3. Cloudflare DNSで、現在のTunnel向けレコードをPages向けに置き換えます。
4. `https://ainanika.com/api/health` が `runtime: "cloudflare-pages"` を返すことを確認します。

注意:

- Pagesの単一ファイル上限は25MiBです。現在の最大素材 `ghost_happy.png` は約20MiBなので範囲内です。
- Functions無料枠にはリクエスト上限があります。静的素材は `_routes.json` によりFunctionsを通さず配信し、APIだけFunctionsを使います。
