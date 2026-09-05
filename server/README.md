# CopiCopi API

CopiCopiのAB左右キャプチャーをGemini 3.8 Flashで評価する専用APIです。

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
- `POST /api/create-checkout-session`
- `POST /api/create-portal-session`
- `POST /api/webhooks/stripe`

`POST /api/grade-work` は `croppedImageData` に、左=A面（見本）、右=B面（模写）を含む1枚のPNG/JPEG/WEBP Data URLを受け取ります。

## Cloud Run

`server` ディレクトリをビルドコンテキストとして `Dockerfile` をデプロイします。Cloud Runには次の環境変数を設定してください。

- `GEMINI_API_KEY`（可能ならSecret Managerから参照）
- `ALLOWED_ORIGINS=https://thousandsofties.github.io`
- `STRIPE_SECRET_KEY`（Secret Manager推奨）
- `STRIPE_PRICE_ID`（CopiCopi Premiumの商品価格ID）
- `STRIPE_WEBHOOK_SECRET`（Secret Manager推奨）

決済APIではFirebase AuthenticationのIDトークンを検証し、Webhookで専用FirebaseプロジェクトのFirestore `users/{uid}` にある `isPremium`、`stripeCustomerId`、`stripeSubscriptionId` などを更新します。現行コードは旧構成の `entitlements.copicopi` を使用しません。Cloud RunのサービスアカウントにはFirebase AuthenticationとFirestoreへの権限が必要です。ローカルでは`FIREBASE_SERVICE_ACCOUNT`にサービスアカウントJSONのパスを設定してください。

フロントエンド側には、アプリリポジトリ直下の`.env.example`に記載した`VITE_FIREBASE_*`を設定します。フロントとAPIは同じCopiCopi専用Firebaseプロジェクトを指定してください。TutoTuto/DoriDoriと同じFirebaseプロジェクトを指定すると、ユーザー直下のPremium状態を共有してしまうため、現在の独立構成では流用しません。Pagesのビルドはメタリポジトリの `COPICOPI_FIREBASE_*` Repository variablesを使用します。

デプロイ後、GitHub ActionsのRepository variable `COPICOPI_API_URL` にCloud Run URLを設定し、フロントのビルド時に `VITE_API_URL` として渡します。

`COPICOPI_API_URL` / `VITE_API_URL` は末尾に `/api` を付けないベースURLです。課金APIは実装されていますが、テスト決済の確認状況と本番モードへの切り替えは運用環境で別途確認してください。
