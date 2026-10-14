import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import admin from 'firebase-admin'
import { createApp, type AppDependencies } from '../src/app.js'
import { MAX_IMAGE_BYTES } from '../src/grading.js'

// Do not discover local service-account files or contact Firebase in this suite.
if (!admin.apps.length) admin.initializeApp({ projectId: 'copicopi-http-integration-test' })

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const image = `data:image/png;base64,${png}`
const review = {
  level: 3,
  label: 'Good progress',
  summary: 'The main pose is recognizable.',
  goodPoints: ['The silhouette follows the reference.'],
  improvements: ['Make the head slightly smaller.'],
  encouragement: 'Compare the head and torso before drawing.',
}
const geminiResponse = (finishReason = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(review) }] } }],
})
const requestBody = { croppedImageData: image, language: 'en' }
const authorization = { Authorization: 'Bearer valid-test-token' }

async function serve(t: TestContext, dependencies: AppDependencies = {}) {
  const server = createServer(createApp({
    verifyToken: async () => ({ uid: 'test-user' }),
    consumeRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    apiKey: () => 'test-api-key',
    fetch: async () => { throw new Error('Unexpected upstream request') },
    ...dependencies,
  }))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  return {
    get: (path: string) => fetch(`${base}${path}`),
    post: (path: string, body: unknown = requestBody, headers: Record<string, string> = authorization) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
  }
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  const payload = await response.json()
  assert.equal(payload.success, false)
  assert.equal(payload.code, code)
  assert.equal(typeof payload.error, 'string')
  assert.equal('result' in payload, false)
  return payload
}

function captureLogs(t: TestContext) {
  const messages: unknown[][] = []
  for (const method of ['info', 'warn', 'error'] as const) {
    t.mock.method(console, method, (...args: unknown[]) => { messages.push(args) })
  }
  return messages
}

test('health and model discovery remain public without invoking protected dependencies', async t => {
  let protectedCalls = 0
  const unexpected = async () => { protectedCalls++; throw new Error('Protected dependency called') }
  const client = await serve(t, { verifyToken: unexpected, consumeRateLimit: unexpected, fetch: unexpected })
  const health = await client.get('/health')
  assert.equal(health.status, 200)
  assert.equal(health.headers.get('x-powered-by'), null)
  const healthBody = await health.json()
  assert.equal(healthBody.ok, true)
  assert.equal(healthBody.service, 'copicopi-api')
  const models = await client.get('/api/models')
  assert.equal(models.status, 200)
  const modelsBody = await models.json()
  assert.equal(modelsBody.default, healthBody.model)
  assert.ok(modelsBody.models.some((model: { id: string }) => model.id === modelsBody.default))
  assert.equal(protectedCalls, 0)
})

test('grading and billing reject missing authentication before parsing JSON', async t => {
  let protectedCalls = 0
  const unexpected = async () => { protectedCalls++; throw new Error('Protected dependency called') }
  const client = await serve(t, { verifyToken: unexpected, consumeRateLimit: unexpected, fetch: unexpected })
  for (const path of ['/api/grade-work', '/api/create-checkout-session', '/api/create-portal-session']) {
    await expectError(await client.post(path, '{invalid-json', {}), 401, 'AUTH_REQUIRED')
  }
  assert.equal(protectedCalls, 0)
})

test('invalid tokens fail before JSON parsing or rate-limit consumption and stay out of logs', async t => {
  const logs = captureLogs(t)
  const secret = 'credential-that-must-not-leak'
  const tokens: string[] = []
  let rateCalls = 0
  let upstreamCalls = 0
  const client = await serve(t, {
    verifyToken: async token => { tokens.push(token); throw new Error(secret) },
    consumeRateLimit: async () => { rateCalls++; return { allowed: true, retryAfterSeconds: 0 } },
    fetch: async () => { upstreamCalls++; throw new Error(secret) },
  })
  for (const path of ['/api/grade-work', '/api/create-checkout-session', '/api/create-portal-session']) {
    const body = await expectError(await client.post(path, '{invalid-json', { Authorization: `Bearer ${secret}` }), 401, 'AUTH_REQUIRED')
    assert.equal(JSON.stringify(body).includes(secret), false)
  }
  assert.deepEqual(tokens, [secret, secret, secret])
  assert.equal(rateCalls, 0)
  assert.equal(upstreamCalls, 0)
  assert.equal(JSON.stringify(logs).includes(secret), false)
})

test('rate limits use the verified user and return Retry-After before parsing the upload', async t => {
  const events: string[] = []
  const client = await serve(t, {
    verifyToken: async token => { events.push(`verify:${token}`); return { uid: 'verified-user' } },
    consumeRateLimit: async uid => { events.push(`limit:${uid}`); return { allowed: false, retryAfterSeconds: 37 } },
    fetch: async () => { events.push('upstream'); throw new Error('Must not call Gemini') },
  })
  const response = await client.post('/api/grade-work', '{invalid-json')
  await expectError(response, 429, 'RATE_LIMITED')
  assert.equal(response.headers.get('retry-after'), '37')
  assert.deepEqual(events, ['verify:valid-test-token', 'limit:verified-user'])
})

test('a rate-limit storage outage fails closed without exposing the error or calling Gemini', async t => {
  const logs = captureLogs(t)
  const secret = 'private-database-failure-details'
  let upstreamCalls = 0
  const client = await serve(t, {
    consumeRateLimit: async () => { throw new Error(secret) },
    fetch: async () => { upstreamCalls++; throw new Error('Must not call Gemini') },
  })
  const body = await expectError(await client.post('/api/grade-work'), 503, 'SERVICE_UNAVAILABLE')
  assert.equal(upstreamCalls, 0)
  assert.equal(JSON.stringify([body, logs]).includes(secret), false)
})

test('malformed JSON and invalid image data return 400 without calling Gemini', async t => {
  let upstreamCalls = 0
  const client = await serve(t, {
    fetch: async () => { upstreamCalls++; throw new Error('Must not call Gemini') },
  })
  for (const body of ['{invalid-json', {}, { croppedImageData: 'data:image/png;base64,bm90LWFuLWltYWdl' }]) {
    await expectError(await client.post('/api/grade-work', body), 400, 'INVALID_IMAGE')
  }
  assert.equal(upstreamCalls, 0)
})

test('oversized images and oversized JSON bodies return 413 without calling Gemini', async t => {
  let upstreamCalls = 0
  const client = await serve(t, {
    fetch: async () => { upstreamCalls++; throw new Error('Must not call Gemini') },
  })
  const oversizedImage = Buffer.alloc(MAX_IMAGE_BYTES + 1)
  Buffer.from(png, 'base64').subarray(0, 8).copy(oversizedImage)
  await expectError(await client.post('/api/grade-work', {
    croppedImageData: `data:image/png;base64,${oversizedImage.toString('base64')}`,
  }), 413, 'INVALID_IMAGE')
  await expectError(await client.post('/api/grade-work', { padding: 'a'.repeat(22 * 1024 * 1024) }), 413, 'INVALID_IMAGE')
  assert.equal(upstreamCalls, 0)
})

test('a validated PNG is sent with structured-output configuration and produces a complete review', async t => {
  const calls: { url: string; options: RequestInit }[] = []
  const secret = 'api-key-only-for-the-header'
  const client = await serve(t, {
    apiKey: () => secret,
    fetch: async (url, options) => {
      calls.push({ url: String(url), options: options! })
      return Response.json(geminiResponse())
    },
  })
  const response = await client.post('/api/grade-work', { ...requestBody, teacherMode: 'strict', panesReversed: true })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.success, true)
  assert.equal(body.result.overallComment, `${review.label}. ${review.summary}`)
  assert.equal(body.result.problems[0].confidence, review.level)
  assert.equal(body.result.problems[0].feedback, review.goodPoints[0])
  assert.equal(body.result.problems[0].explanation, `Next point: ${review.improvements[0]}\n${review.encouragement}`)
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0].url).hostname, 'generativelanguage.googleapis.com')
  assert.equal(calls[0].url.includes(secret), false)
  assert.equal(new Headers(calls[0].options.headers).get('x-goog-api-key'), secret)
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  const sent = JSON.parse(String(calls[0].options.body))
  assert.deepEqual(sent.contents[0].parts[0].inlineData, { mimeType: 'image/png', data: png })
  assert.equal(sent.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON')
  assert.ok(sent.generationConfig.responseFormat.text.schema.required.includes('encouragement'))
  assert.equal(JSON.stringify(body).includes(secret), false)
})

test('upstream HTTP failures and thrown errors return sanitized 502 responses', async t => {
  const logs = captureLogs(t)
  const secret = 'upstream-error-with-a-private-api-key'
  for (const fetchGemini of [
    async () => Response.json({ error: { message: secret } }, { status: 429 }),
    async () => { throw new Error(secret) },
  ]) {
    const client = await serve(t, { fetch: fetchGemini })
    const body = await expectError(await client.post('/api/grade-work'), 502, 'AI_UNAVAILABLE')
    assert.equal(JSON.stringify(body).includes(secret), false)
  }
  assert.equal(JSON.stringify(logs).includes(secret), false)
})

test('invalid upstream JSON and unfinished review output never produce a successful grading', async t => {
  const logs = captureLogs(t)
  const secret = 'private-non-json-upstream-response'
  for (const fetchGemini of [
    async () => new Response(secret, { status: 200 }),
    async () => Response.json(geminiResponse('MAX_TOKENS')),
  ]) {
    const client = await serve(t, { fetch: fetchGemini })
    const body = await expectError(await client.post('/api/grade-work'), 502, 'INVALID_AI_RESPONSE')
    assert.equal(JSON.stringify(body).includes(secret), false)
  }
  assert.equal(JSON.stringify(logs).includes(secret), false)
})

test('the review deadline aborts a stalled upstream connection', { timeout: 5000 }, async t => {
  let signal: AbortSignal | null | undefined
  const client = await serve(t, {
    reviewTimeoutMs: 25,
    fetch: async (_url, options) => {
      signal = options?.signal
      assert.ok(signal)
      return new Promise<Response>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    },
  })
  await expectError(await client.post('/api/grade-work'), 504, 'AI_TIMEOUT')
  assert.equal(signal?.aborted, true)
})

test('the review deadline remains active while reading the upstream response body', { timeout: 5000 }, async t => {
  let signal: AbortSignal | null | undefined
  let readingBody = false
  const client = await serve(t, {
    reviewTimeoutMs: 25,
    fetch: async (_url, options) => {
      signal = options?.signal
      assert.ok(signal)
      const response = Response.json(geminiResponse())
      response.json = () => {
        readingBody = true
        return new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      return response
    },
  })
  await expectError(await client.post('/api/grade-work'), 504, 'AI_TIMEOUT')
  assert.equal(readingBody, true)
  assert.equal(signal?.aborted, true)
})

test('Stripe webhooks keep raw-body signature verification and do not require Firebase login', async t => {
  captureLogs(t)
  const previousKey = process.env.STRIPE_SECRET_KEY
  const previousWebhook = process.env.STRIPE_WEBHOOK_SECRET
  process.env.STRIPE_SECRET_KEY = 'sk_test_copicopi_integration_placeholder'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_copicopi_integration_placeholder'
  t.after(() => {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = previousKey
    if (previousWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = previousWebhook
  })
  let protectedCalls = 0
  const unexpected = async () => { protectedCalls++; throw new Error('Protected dependency called') }
  const client = await serve(t, { verifyToken: unexpected, consumeRateLimit: unexpected, fetch: unexpected })
  const raw = '{ "id": "evt_integration", "type": "test.ping", "data": { "object": {} } }'
  const timestamp = Math.floor(Date.now() / 1000)
  const invalid = await client.post('/api/webhooks/stripe', raw, { 'stripe-signature': `t=${timestamp},v1=invalid` })
  assert.equal(invalid.status, 400)
  assert.equal(await invalid.text(), 'Invalid webhook signature')
  const signature = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex')
  const valid = await client.post('/api/webhooks/stripe', raw, { 'stripe-signature': `t=${timestamp},v1=${signature}` })
  assert.equal(valid.status, 200)
  assert.deepEqual(await valid.json(), { received: true })
  assert.equal(protectedCalls, 0)
})
