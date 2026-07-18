import 'dotenv/config'
import cors from 'cors'
import express from 'express'

const PORT = Number(process.env.PORT || 3003)
const MODEL_ID = 'gemini-3.5-flash'
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

const app = express()
app.disable('x-powered-by')
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error('Origin is not allowed'))
  }
}))
app.use(express.json({ limit: '20mb' }))

const responseSchema = {
  type: 'object',
  properties: {
    level: { type: 'integer', minimum: 1, maximum: 5, description: '選択された先生の方針による総合到達度。' },
    label: { type: 'string', description: '到達度を端的に表す日本語。' },
    summary: { type: 'string', description: '見本との共通点と主要な差を含む、客観的な総評。' },
    goodPoints: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2, description: '画像から確認できる具体的な良い点。' },
    improvements: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2, description: '場所・差・直し方を含む、優先度の高い改善指導。' },
    encouragement: { type: 'string', description: '次の一枚で実行できる短い練習課題。抽象的な称賛だけにしない。' }
  },
  required: ['level', 'label', 'summary', 'goodPoints', 'improvements', 'encouragement']
}

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

const parseImageDataUrl = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('画像データがありません')
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('PNG、JPEG、WEBPの画像を指定してください')
  const byteLength = Buffer.byteLength(match[2], 'base64')
  if (byteLength > MAX_IMAGE_BYTES) throw new Error('画像が大きすぎます')
  return { mimeType: match[1], data: match[2], byteLength }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'copicopi-api', model: MODEL_ID })
})

app.get('/api/models', (_req, res) => {
  res.json({
    default: MODEL_ID,
    models: [{ id: MODEL_ID, name: 'Gemini 3.5 Flash', description: '模写の雰囲気を総合評価' }]
  })
})

app.post('/api/grade-work', async (req, res) => {
  const startedAt = Date.now()
  const requestId = crypto.randomUUID().slice(0, 8)
  try {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return res.status(503).json({ success: false, error: 'サーバーにGemini APIキーが設定されていません' })

    const image = parseImageDataUrl(req.body?.croppedImageData)
    const teacherMode = parseTeacherMode(req.body?.teacherMode)
    const panesReversed = req.body?.panesReversed === true
    const paneOrder = panesReversed
      ? '左側がユーザーの模写（B面）、右側が見本（A面）です。'
      : '左側が見本（A面）、右側がユーザーの模写（B面）です。'
    const prompt = `${targetScopeInstruction}\n\n${basePrompt}\n${paneOrder}\n\n${teacherInstructions[teacherMode]}`
    console.info('[grade-work:start]', {
      requestId,
      teacherMode,
      panesReversed,
      mimeType: image.mimeType,
      imageBytes: image.byteLength
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60_000)
    let response: Response
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: image.mimeType, data: image.data } },
            { text: prompt }
          ] }],
          generationConfig: {
            thinkingConfig: { thinkingLevel: 'low' },
            responseFormat: {
              text: { mimeType: 'APPLICATION_JSON', schema: responseSchema }
            },
            maxOutputTokens: 3000
          }
        }),
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeout)
    }

    const payload = await response.json() as any
    console.info('[grade-work:gemini]', {
      requestId,
      httpStatus: response.status,
      finishReason: payload?.candidates?.[0]?.finishReason,
      promptTokens: payload?.usageMetadata?.promptTokenCount,
      thoughtTokens: payload?.usageMetadata?.thoughtsTokenCount,
      outputTokens: payload?.usageMetadata?.candidatesTokenCount,
      totalTokens: payload?.usageMetadata?.totalTokenCount
    })
    if (!response.ok) {
      const message = payload?.error?.message || `Gemini API error (${response.status})`
      return res.status(response.status).json({ success: false, error: message })
    }

    const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('')
    if (!text) throw new Error('Geminiから評価結果が返りませんでした')
    let evaluation: any
    try {
      evaluation = JSON.parse(text)
    } catch (error) {
      const details = {
        finishReason: payload?.candidates?.[0]?.finishReason,
        textLength: text.length,
        usageMetadata: payload?.usageMetadata
      }
      console.error('[Gemini JSON]', details)
      throw new Error(`Gemini JSON parse failed: ${JSON.stringify(details)}`)
    }
    const feedback = evaluation.goodPoints.join('／')
    const improvementText = evaluation.improvements.length
      ? `次のポイント：${evaluation.improvements.join('／')}`
      : 'この調子で、見本の特徴を楽しみながら描いてみましょう。'

    res.json({
      success: true,
      modelName: MODEL_ID,
      responseTime: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      result: {
        problems: [{
          problemNumber: `模写評価 ${evaluation.level}/5`,
          studentAnswer: '',
          isCorrect: true,
          feedback,
          explanation: `${improvementText}\n${evaluation.encouragement}`,
          gradingSource: 'ai',
          confidence: evaluation.level
        }],
        overallComment: `${evaluation.label}。${evaluation.summary}`
      }
    })
    console.info('[grade-work:complete]', {
      requestId,
      teacherMode,
      level: evaluation.level,
      durationMs: Date.now() - startedAt
    })
  } catch (error) {
    const message = error instanceof Error
      ? (error.name === 'AbortError' ? 'Gemini APIがタイムアウトしました' : error.message)
      : '採点処理に失敗しました'
    console.error('[grade-work:error]', { requestId, message, durationMs: Date.now() - startedAt })
    res.status(500).json({ success: false, error: message })
  }
})

app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CopiCopi API listening on port ${PORT}`)
})
