# CopiCopi API

CopiCopiのAB左右キャプチャーをGemini 3.5 Flashで評価する専用APIです。

## ローカル起動

```bash
cp .env.example .env
# .env の GEMINI_API_KEY を設定（キーをGitへコミットしない）
npm install
npm run dev
```

既定では `http://localhost:3003` で起動します。

## API

- `GET /health`
- `GET /api/models`
- `POST /api/grade-work`

`POST /api/grade-work` は `croppedImageData` に、左=A面（見本）、右=B面（模写）を含む1枚のPNG/JPEG/WEBP Data URLを受け取ります。

## Cloud Run

`server` ディレクトリをビルドコンテキストとして `Dockerfile` をデプロイします。Cloud Runには次の環境変数を設定してください。

- `GEMINI_API_KEY`（可能ならSecret Managerから参照）
- `ALLOWED_ORIGINS=https://thousandsofties.github.io`

デプロイ後、GitHub ActionsのRepository variable `COPICOPI_API_URL` にCloud Run URLを設定し、フロントのビルド時に `VITE_API_URL` として渡します。
