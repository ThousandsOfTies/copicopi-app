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
AI評価にはFirebaseへのログインとFirestoreも必要です。課金を試す場合はStripeも設定します。ローカルのFirebase認証ファイルは `FIREBASE_SERVICE_ACCOUNT` で指定します。

`npm test` で認証・回数制限・入力とAI応答の検証を確認します。テストは外部APIを呼びません。`npm run build` でビルドし、`npm start` でビルド済みAPIを起動します。

## 主なAPI

- `GET /health`：稼働確認。
- `POST /api/grade-work`：左にお手本、右に模写を含む画像の評価。CopiCopi専用FirebaseのIDトークンを `Authorization: Bearer <token>` で送ります。
- Stripe Checkout・Portal・Webhookによる課金連携。

## AI評価の保護

- 認証と回数制限を画像本文の読み込みより先に実行します。未ログイン・無効または失効したトークンは401で拒否します。
- Firebase UIDごとに60秒間で10リクエストまで許可します。超過時は429と `Retry-After`（秒）を返します。画像不正や上流エラーを含む評価の試行も回数に含みます。
- カウンターは専用Firestoreの `_apiRateLimits` コレクションに利用者ごと1ドキュメントを保持し、トランザクションで更新します。Cloud Runの複数インスタンスや再起動でも制限を共有します。保存先に接続できない場合は503で拒否し、Geminiを呼びません。
- `_apiRateLimits` はAdmin SDK専用です。Firestoreルールでクライアントからの読み書きを許可しないでください。既存の `users/{uid}` だけを許可するルールでは、対象外のこのコレクションは拒否されます。利用者の課金情報や作品には保存しません。
- PNG/JPEG/WEBPの署名、base64形式、15MiB以内の入力を確認します。Geminiは既存の `responseFormat.text.schema` を使用し、完了した応答の必須フィールド・型・評価範囲を再検証します。本文の受信も含め60秒でタイムアウトします。
- エラーは安定した `code` を返し、共通クライアントが日本語・英語の辞書で表示します。上流APIの生のエラーや認証情報を返しません。

これらの制限は不正消費を抑えるための利用者単位の制御です。利用者数全体の予算上限やPremiumの利用資格判定は別の仕組みです。

## 公開・接続

このディレクトリをビルドコンテキストとしてCloud Runへ公開します。手順は [CopiCopiのデプロイガイド](https://github.com/ThousandsOfTies/CopiCopi/blob/main/.agent/workflows/deployment.md) を参照してください。

Google Cloud CLI 587.0.0以降で、変更をcommit・pushした後に `npm run deploy` を実行します。
`cloudbuild.yaml` で `regular` のワーカーを使用してビルドし、成功したイメージのSHA256ダイジェストをCloud Runへ公開します。
Docker BuildKitが対応しない `--network cloudbuild` を生成するソースデプロイは使用しません。
既存サービスの環境変数・シークレット・認証・サービスアカウントを保持します。ビルドやリビジョン作成が失敗した場合はトラフィックを変更しません。
成功したデプロイ応答から今回作成したリビジョン名を取得し、そのリビジョンへトラフィックを100%切り替えます。旧リビジョンに固定されていた場合も切り替えます。
既存のトラフィックタグは名前を保持したまま同じ新リビジョンへ移します。通常のトラフィックが0%でもタグURLから旧APIへ接続できるためです。切り替えに失敗した場合はデプロイコマンドも失敗として終了します。
認証必須化を公開する際は、先にトークンを送信するフロントをPagesへ公開し、その後APIを更新します。開いたままの旧フロントではPWAの更新適用・再読み込みが必要です。
Cloud Runを変更せずに互換性を確認する場合は `npm run deploy -- --build-only` を使います。
`.gcloudignore` の許可リストで `.env`、認証ファイル、フロント資産をアップロード対象から除外します。
APIキー・決済キーはサーバー側に設定し、フロントとAPIには同じCopiCopi専用Firebaseプロジェクトを指定します。

PagesのAPI接続先はRepository variable `COPICOPI_API_URL`、Firebase設定は `COPICOPI_FIREBASE_*` です。`VITE_API_URL` には末尾に `/api` のないベースURLを渡します。
課金・独立化の作業履歴は [HANDOVER.md](https://github.com/ThousandsOfTies/CopiCopi/blob/main/HANDOVER.md) にあります。
