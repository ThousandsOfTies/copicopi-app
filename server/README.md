# CopiCopi API

お手本と模写のA/BキャプチャーをGeminiで評価する、CopiCopi専用のExpress APIです。Firebase・StripeもCopiCopi専用の設定を使用します。

## ローカル開発

Node.js 20以降を使用し、この `server` ディレクトリで実行します。

```bash
npm ci
# .env.example を .env にコピーし、GEMINI_API_KEY などを設定する
npm run dev
```

既定の接続先は `http://localhost:3003`、設定は [.env.example](.env.example) を参照してください。
認証・課金を試す場合はFirebase・Stripeの設定も必要です。ローカルのFirebase認証ファイルは `FIREBASE_SERVICE_ACCOUNT` で指定します。

`npm run build` でビルドし、`npm start` でビルド済みAPIを起動します。

## 主なAPI

- `GET /health`：稼働確認。
- `POST /api/grade-work`：左にお手本、右に模写を含む画像の評価。
- Stripe Checkout・Portal・Webhookによる課金連携。

## 公開・接続

このディレクトリをビルドコンテキストとしてCloud Runへ公開します。手順は [CopiCopiのデプロイガイド](https://github.com/ThousandsOfTies/CopiCopi/blob/main/.agent/workflows/deployment.md) を参照してください。
APIキー・決済キーはサーバー側に設定し、フロントとAPIには同じCopiCopi専用Firebaseプロジェクトを指定します。

PagesのAPI接続先はRepository variable `COPICOPI_API_URL`、Firebase設定は `COPICOPI_FIREBASE_*` です。`VITE_API_URL` には末尾に `/api` のないベースURLを渡します。
課金・独立化の作業履歴は [HANDOVER.md](https://github.com/ThousandsOfTies/CopiCopi/blob/main/HANDOVER.md) にあります。
