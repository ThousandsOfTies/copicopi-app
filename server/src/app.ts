import cors from 'cors'
import express from 'express'
import admin from 'firebase-admin'
import fs from 'node:fs'
import path from 'node:path'
import Stripe from 'stripe'
import { ApiError, gradingGenerationConfig, parseGradingResponse, parseImageDataUrl } from './grading.js'
import { authenticate, apiError, createFirestoreRateLimiter, limitGrading } from './security.js'
import type { AuthenticatedRequest, ConsumeRateLimit, VerifyToken } from './security.js'

const MODEL_ID = 'gemini-3.8-flash'

export interface AppDependencies {
  verifyToken?: VerifyToken
  consumeRateLimit?: ConsumeRateLimit
  fetch?: typeof fetch
  apiKey?: () => string | undefined
  reviewTimeoutMs?: number
}

export function createApp(dependencies: AppDependencies = {}) {
  const fetchGemini = dependencies.fetch ?? fetch
  const getApiKey = dependencies.apiKey ?? (() => process.env.GEMINI_API_KEY)
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null

  if (!admin.apps.length) {
    try {
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT
      if (serviceAccountPath) {
        const serviceAccount = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), serviceAccountPath), 'utf8'))
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
      } else {
        admin.initializeApp()
      }
      console.info('[firebase] Admin initialized')
    } catch (error) {
      console.warn('[firebase] Admin initialization failed; authenticated endpoints are unavailable')
    }
  }

  const authenticateUser = authenticate(
    dependencies.verifyToken ?? (token => admin.auth().verifyIdToken(token, true)),
    () => Boolean(dependencies.verifyToken || admin.apps.length),
  )
  const gradingRateLimit = limitGrading(dependencies.consumeRateLimit ?? (uid =>
    createFirestoreRateLimiter(admin.firestore())(uid)))

  const getReturnUrl = (req: express.Request) => {
    const requested = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl : ''
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    const fallback = allowedOrigins[0] || 'http://localhost:3000'
    const candidate = requested || origin || fallback
    try {
      const url = new URL(candidate)
      if (!allowedOrigins.includes(url.origin)) return fallback
      return candidate.replace(/\/$/, '')
    } catch {
      return fallback
    }
  }

  const app = express()
  app.disable('x-powered-by')
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      callback(new Error('Origin is not allowed'))
    }
  }))
  type TeacherMode = 'kind' | 'balanced' | 'strict'

  const teacherInstructions: Record<TeacherMode, string> = {
    kind: `【KIND：ほめて伸ばす先生】
- 見本らしさが伝わっている部分を先に見つけ、良い点を2件まで具体的に伝えてください。
- 改善点は、次の一枚で実行できる最重要の1件だけに絞ってください。
- 細かな形の差より、モチーフと雰囲気を捉えようとした点を評価してください。
- 点数を不自然に上げる必要はありませんが、迷った場合は生徒の意図と成功している特徴を好意的に読み取ってください。
- 安心してもう一枚描きたくなる、優しく率直な言葉を使ってください。`,
    balanced: `【BALANCED：バランスよく見る先生】
- 良い点と改善点を同じ比重で、各1〜2件具体的に伝えてください。
- シルエット、比率、ポーズ、雰囲気を総合的に評価してください。
- 標準的な成功はlevel 3とし、大きな差と小さな差を区別してください。
- 励ましと正確さのどちらにも偏らない、明快で実用的な言葉を使ってください。`,
    strict: `【STRICT：細部まで確認する先生】
- シルエット、傾き、比率、重心、ポーズを見本と厳密に比較してください。
- 良い点は根拠が明確なものだけを挙げ、印象を変える差を優先度順に最大2件指摘してください。
- level 4は主要部分がよく一致する場合、level 5は細かな差しかない場合に限定してください。
- 迷った場合は高い方ではなく低い方を選び、理由をsummaryに反映してください。
- 厳しく否定せず、正確で率直な専門的指導にしてください。`
  }

  const basePrompt = `あなたは、観察力を育てることに長けた、誠実で具体的なイラストの先生です。
入力画像はCopiCopiの現在の左右表示をキャプチャーした1枚です。

ピクセル単位の一致、線の微細なずれ、描き込み量の差は評価しないでください。次の観点から、絵全体の雰囲気を総合的に評価してください。
- 一目で同じモチーフに見えるか
- 特徴的な形とシルエットを捉えているか
- ポーズ、動き、表情の印象が似ているか
- 全体の配置、比率、バランスが見本らしいか
- 見本の空気感や個性が模写に伝わっているか

左右の表示倍率、余白、背景色、中央の区切り線は評価対象外です。

【指導方針】
- 根拠のない絶賛や「完璧」「非常に素晴らしい」の多用を避けてください。
- 良い点は、画像から確認できる事実を1〜2件だけ具体的に挙げてください。
- 改善点は、全体の印象を見本へ近づける効果が大きい順に最大2件へ絞ってください。
- 改善点には「どの部分が」「見本とどう違い」「どう直すか」を含めてください。
- 細部より先に、大きなシルエット、傾き、比率、重心、ポーズを指導してください。
- 最後は「次の一枚で何を観察して描くか」という、実行可能な短い練習課題で締めてください。
- 厳しく否定するのではなく、正確で率直な先生として導いてください。

【levelの厳格な基準】
1: モチーフやポーズの対応がまだ読み取りにくく、大きな形から観察し直す段階。
2: 同じモチーフとは分かるが、シルエット・比率・ポーズに複数の大きな差がある。
3: 見本の特徴と雰囲気は伝わるが、全体印象を変える明確な差が1〜2個ある。標準的な成功はこの段階。
4: シルエット・比率・ポーズ・雰囲気の主要部分がよく一致し、残る差が小さい。
5: 一目で見本らしさが強く伝わり、主要な形・比率・動き・空気感がほぼ揃っている。細かな差しかない。`

  const parseTeacherMode = (value: unknown): TeacherMode =>
    value === 'balanced' || value === 'strict' ? value : 'kind'

  type OutputLanguage = 'ja' | 'en'
  const parseOutputLanguage = (value: unknown): OutputLanguage =>
    typeof value === 'string' && value.toLowerCase().startsWith('en') ? 'en' : 'ja'

  const outputLanguageInstructions: Record<OutputLanguage, string> = {
    ja: `【出力言語】JSON内のlabel、summary、goodPoints、improvements、encouragementは、すべて自然な日本語で書いてください。`,
    en: `【Output language — highest priority】Write every user-facing JSON string in natural English: label, summary, goodPoints, improvements, and encouragement. Do not include Japanese words, headings, or punctuation in those values.`
  }

  const targetScopeInstruction = `【最優先：評価対象の特定】
このルールはKIND、BALANCED、STRICTのすべての先生方針より優先します。

1. まずB面に描かれている模写のモチーフを確認してください。
2. 次にA面から、その模写に最も対応する見本を1つだけ特定してください。
3. 特定した見本とB面の模写だけを比較してください。

A面に表示されている次の要素は評価対象外です。
- 別の見本、別のキャラクター、別の作例
- 説明文、見出し、吹き出し、ページ番号
- 補助図、枠線、操作UI
- 対応する見本の外側にある背景やページ構成

A面にだけ存在する要素があっても、それが特定した見本の一部だと明確に判断できない限り、「描かれていない」「不足している」と指摘せず、採点にも影響させないでください。
複数の見本があり対応関係を判断しにくい場合は、B面と形、ポーズ、配置が最も近い見本を選び、曖昧な要素は減点対象にしないでください。`

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'copicopi-api', model: MODEL_ID })
  })

  app.get('/api/models', (_req, res) => {
    res.json({
      default: MODEL_ID,
      models: [{ id: MODEL_ID, name: 'Gemini 3.8 Flash', description: '模写の雰囲気を総合評価' }]
    })
  })

  app.post('/api/grade-work', authenticateUser, gradingRateLimit, express.json({ limit: '21mb' }), async (req, res) => {
    const startedAt = Date.now()
    const requestId = crypto.randomUUID().slice(0, 8)
    const outputLanguage = parseOutputLanguage(req.body?.language)
    try {
      const apiKey = getApiKey()
      if (!apiKey) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Review is not configured')
      const image = parseImageDataUrl(req.body?.croppedImageData)
      const teacherMode = parseTeacherMode(req.body?.teacherMode)
      const panesReversed = req.body?.panesReversed === true
      const paneOrder = panesReversed
        ? '左側がユーザーの模写（B面）、右側が見本（A面）です。'
        : '左側が見本（A面）、右側がユーザーの模写（B面）です。'
      const prompt = `${targetScopeInstruction}\n\n${basePrompt}\n${paneOrder}\n\n${teacherInstructions[teacherMode]}\n\n${outputLanguageInstructions[outputLanguage]}`
      console.info('[grade-work:start]', {
        requestId,
        teacherMode,
        outputLanguage,
        panesReversed,
        mimeType: image.mimeType,
        imageBytes: image.byteLength
      })
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), dependencies.reviewTimeoutMs ?? 60_000)
      let response: Response
      let payload: any
      try {
        response = await fetchGemini(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { inlineData: { mimeType: image.mimeType, data: image.data } },
              { text: prompt }
            ] }],
            generationConfig: gradingGenerationConfig
          }),
          signal: controller.signal
        })
        try {
          payload = await response.json()
        } catch (error) {
          if (controller.signal.aborted) throw error
          throw new ApiError(502, 'INVALID_AI_RESPONSE', 'Invalid AI response')
        }
      } finally {
        clearTimeout(timeout)
      }

      console.info('[grade-work:gemini]', {
        requestId,
        httpStatus: response.status,
        finishReason: payload?.candidates?.[0]?.finishReason,
        promptTokens: payload?.usageMetadata?.promptTokenCount,
        thoughtTokens: payload?.usageMetadata?.thoughtsTokenCount,
        outputTokens: payload?.usageMetadata?.candidatesTokenCount,
        totalTokens: payload?.usageMetadata?.totalTokenCount
      })
      if (!response.ok) throw new ApiError(502, 'AI_UNAVAILABLE', 'AI review temporarily unavailable')
      const evaluation = parseGradingResponse(payload)
      const feedback = evaluation.goodPoints.join('／')
      const nextPointPrefix = outputLanguage === 'en' ? 'Next point: ' : '次のポイント：'
      const improvementText = evaluation.improvements.length
        ? `${nextPointPrefix}${evaluation.improvements.join('／')}`
        : (outputLanguage === 'en'
            ? 'Keep observing the reference and enjoy capturing its defining features.'
            : 'この調子で、見本の特徴を楽しみながら描いてみましょう。')
      const problemNumber = outputLanguage === 'en'
        ? `Copying score ${evaluation.level}/5`
        : `模写評価 ${evaluation.level}/5`
      const overallComment = outputLanguage === 'en'
        ? `${evaluation.label}. ${evaluation.summary}`
        : `${evaluation.label}。${evaluation.summary}`

      res.json({
        success: true,
        modelName: MODEL_ID,
        responseTime: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        result: {
          problems: [{
            problemNumber,
            studentAnswer: '',
            isCorrect: true,
            feedback,
            explanation: `${improvementText}\n${evaluation.encouragement}`,
            gradingSource: 'ai',
            confidence: evaluation.level
          }],
          overallComment
        }
      })
      console.info('[grade-work:complete]', {
        requestId,
        teacherMode,
        level: evaluation.level,
        durationMs: Date.now() - startedAt
      })
    } catch (error) {
      const failure = error instanceof ApiError ? error
        : error instanceof Error && error.name === 'AbortError'
          ? new ApiError(504, 'AI_TIMEOUT', 'AI review timed out')
          : new ApiError(502, 'AI_UNAVAILABLE', 'AI review temporarily unavailable')
      console.error('[grade-work:error]', { requestId, code: failure.code, durationMs: Date.now() - startedAt })
      apiError(res, failure.status, failure.code, failure.message)
    }
  })

  app.post('/api/create-checkout-session', authenticateUser, express.json({ limit: '16kb' }), async (req: AuthenticatedRequest, res) => {
    try {
      const priceId = process.env.STRIPE_PRICE_ID
      if (!stripe || !priceId) return res.status(503).json({ error: 'Stripe is not configured' })
      const user = req.user!
      const userRef = admin.firestore().collection('users').doc(user.uid)
      const userSnapshot = await userRef.get()
      const customerId = userSnapshot.data()?.stripeCustomerId as string | undefined
      const returnUrl = getReturnUrl(req)
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${returnUrl}?checkout=success`,
        cancel_url: `${returnUrl}?checkout=canceled`,
        client_reference_id: user.uid,
        metadata: { app: 'CopiCopi', firebaseUid: user.uid },
        ...(customerId ? { customer: customerId } : { customer_email: user.email })
      })
      res.json({ url: session.url })
    } catch (error) {
      console.error('[stripe] Checkout session failed')
      res.status(500).json({ error: 'Checkout session failed' })
    }
  })

  app.post('/api/create-portal-session', authenticateUser, express.json({ limit: '16kb' }), async (req: AuthenticatedRequest, res) => {
    try {
      if (!stripe) return res.status(503).json({ error: 'Stripe is not configured' })
      const userSnapshot = await admin.firestore().collection('users').doc(req.user!.uid).get()
      const customerId = userSnapshot.data()?.stripeCustomerId as string | undefined
      if (!customerId) return res.status(400).json({ error: 'Stripe customer was not found' })
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: getReturnUrl(req)
      })
      res.json({ url: session.url })
    } catch (error) {
      console.error('[stripe] Portal session failed')
      res.status(500).json({ error: 'Portal session failed' })
    }
  })

  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature']
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!stripe || !webhookSecret || typeof signature !== 'string') {
      return res.status(503).send('Stripe webhook is not configured')
    }

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
    } catch (error) {
      console.warn('[stripe] Webhook signature verification failed')
      return res.status(400).send('Invalid webhook signature')
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session
        const uid = session.client_reference_id || session.metadata?.firebaseUid
        if (uid) {
          await admin.firestore().collection('users').doc(uid).set({
              isPremium: true,
              stripeCustomerId: session.customer,
              stripeSubscriptionId: session.subscription
          }, { merge: true })
        }
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
          const users = await admin.firestore().collection('users').where(`stripeCustomerId`, '==', customerId).limit(1).get()
        if (!users.empty) {
          const active = event.type !== 'customer.subscription.deleted'
            && (subscription.status === 'active' || subscription.status === 'trialing')
          await users.docs[0].ref.update({
            [`isPremium`]: active,
            [`stripeSubscriptionId`]: active ? subscription.id : admin.firestore.FieldValue.delete(),
            [`cancelAtPeriodEnd`]: active ? subscription.cancel_at_period_end : admin.firestore.FieldValue.delete(),
            [`currentPeriodEnd`]: active ? ((subscription as any).current_period_end || subscription.items?.data[0]?.current_period_end) : admin.firestore.FieldValue.delete()
          })
        }
      } else if (event.type === 'invoice.payment_succeeded') {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string
        const users = await admin.firestore().collection('users').where(`stripeCustomerId`, '==', customerId).limit(1).get()
        if (!users.empty) await users.docs[0].ref.update({ [`isPremium`]: true })
      }
      res.json({ received: true })
    } catch (error) {
      console.error('[stripe] Webhook processing failed')
      res.status(500).send('Webhook processing failed')
    }
  })

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

  app.use((error: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error.type === 'entity.too.large') return void apiError(res, 413, 'INVALID_IMAGE', 'Request body is too large')
    if (error.type === 'entity.parse.failed') return void apiError(res, 400, 'INVALID_IMAGE', 'Invalid JSON request')
    apiError(res, 500, 'SERVICE_UNAVAILABLE', 'Service unavailable')
  })

  return app
}
