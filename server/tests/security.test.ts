import test from 'node:test'
import assert from 'node:assert/strict'
import type express from 'express'
import type { firestore } from 'firebase-admin'
import { authenticate, createFirestoreRateLimiter, type AuthenticatedRequest } from '../src/security.js'

type Document = { version: number; data: Record<string, unknown> }
type Reference = { path: string }

/** Emulate atomic Firestore commits, retrying callbacks when a concurrent read changed. */
class TransactionDatabase {
  documents = new Map<string, Document>()
  retries = 0
  unavailable = false

  collection(name: string) {
    return { doc: (id: string): Reference => ({ path: `${name}/${id}` }) }
  }

  async runTransaction<T>(callback: (transaction: {
    get: (ref: Reference) => Promise<{ data: () => Record<string, unknown> | undefined }>
    set: (ref: Reference, data: Record<string, unknown>) => void
  }) => Promise<T>): Promise<T> {
    if (this.unavailable) throw new Error('Test storage unavailable')
    for (;;) {
      const reads = new Map<string, number>()
      const writes = new Map<string, Record<string, unknown>>()
      const result = await callback({
        get: async ref => {
          const document = this.documents.get(ref.path)
          reads.set(ref.path, document?.version ?? 0)
          const data = document ? structuredClone(document.data) : undefined
          return { data: () => data }
        },
        set: (ref, data) => { writes.set(ref.path, structuredClone(data)) }
      })
      if ([...reads].some(([path, version]) => (this.documents.get(path)?.version ?? 0) !== version)) {
        this.retries++
        continue
      }
      for (const [path, data] of writes) {
        this.documents.set(path, { version: (this.documents.get(path)?.version ?? 0) + 1, data })
      }
      return result
    }
  }

  asFirestore() { return this as unknown as firestore.Firestore }
}

test('two server instances share one atomic quota under concurrent requests', async () => {
  const db = new TransactionDatabase()
  const options = { limit: 5, windowMs: 60_000, now: () => 1000 }
  const instances = [createFirestoreRateLimiter(db.asFirestore(), options), createFirestoreRateLimiter(db.asFirestore(), options)]
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => instances[index % 2]('same-user')))
  assert.equal(results.filter(result => result.allowed).length, 5)
  assert.equal(results.filter(result => !result.allowed).length, 25)
  assert.ok(results.filter(result => !result.allowed).every(result => result.retryAfterSeconds === 60))
  assert.ok(db.retries > 0, 'the concurrent test must exercise transaction retries')
  assert.equal(db.documents.size, 1)
  assert.deepEqual([...db.documents.values()][0].data, { count: 5, resetAt: 61_000 })
})

test('quotas are isolated by UID and stored outside client-writable user documents', async () => {
  const db = new TransactionDatabase()
  const consume = createFirestoreRateLimiter(db.asFirestore(), { limit: 1, now: () => 1000 })
  for (const uid of ['alice', 'bob', 'uid/with/slashes']) {
    assert.equal((await consume(uid)).allowed, true)
    assert.equal((await consume(uid)).allowed, false)
  }
  assert.equal(db.documents.size, 3)
  for (const path of db.documents.keys()) assert.match(path, /^_apiRateLimits\/grade-[a-f0-9]{64}$/)
})

test('a window resets at its exact expiry and Retry-After rounds up to whole seconds', async () => {
  const db = new TransactionDatabase()
  let time = 1000
  const consume = createFirestoreRateLimiter(db.asFirestore(), { limit: 1, windowMs: 1500, now: () => time })
  assert.deepEqual(await consume('user'), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual(await consume('user'), { allowed: false, retryAfterSeconds: 2 })
  time = 2499
  assert.deepEqual(await consume('user'), { allowed: false, retryAfterSeconds: 1 })
  time = 2500
  assert.deepEqual(await consume('user'), { allowed: true, retryAfterSeconds: 0 })
  assert.deepEqual([...db.documents.values()][0].data, { count: 1, resetAt: 4000 })
})

test('a small clock difference between instances cannot reset another instance quota', async () => {
  const db = new TransactionDatabase()
  const first = createFirestoreRateLimiter(db.asFirestore(), { limit: 1, now: () => 1000 })
  const second = createFirestoreRateLimiter(db.asFirestore(), { limit: 1, now: () => 999 })
  assert.equal((await first('user')).allowed, true)
  assert.equal((await second('user')).allowed, false)
  assert.equal([...db.documents.values()][0].data.count, 1)
})

test('a future stored window remains enforced while Retry-After is capped to one window', async () => {
  const db = new TransactionDatabase()
  const consume = createFirestoreRateLimiter(db.asFirestore(), { limit: 1, windowMs: 1500, now: () => 1000 })
  await consume('user')
  const document = [...db.documents.values()][0]
  document.data.resetAt = 100_000
  assert.deepEqual(await consume('user'), { allowed: false, retryAfterSeconds: 2 })
  assert.equal([...db.documents.values()][0].data.count, 1)
})

test('refreshing an authentication token cannot create a new quota for the same verified UID', async () => {
  const db = new TransactionDatabase()
  const instances = [
    createFirestoreRateLimiter(db.asFirestore(), { limit: 1, now: () => 1000 }),
    createFirestoreRateLimiter(db.asFirestore(), { limit: 1, now: () => 1000 })
  ]
  const verifiedTokens: string[] = []
  const auth = authenticate(async token => {
    verifiedTokens.push(token)
    return { uid: 'stable-user' }
  })
  const results = []
  for (const [index, token] of ['initial-token', 'refreshed-token'].entries()) {
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthenticatedRequest
    let nextCalls = 0
    await auth(req, {} as express.Response, () => { nextCalls++ })
    assert.equal(nextCalls, 1)
    assert.equal(req.user?.uid, 'stable-user')
    results.push(await instances[index](req.user!.uid))
  }
  assert.deepEqual(verifiedTokens, ['initial-token', 'refreshed-token'])
  assert.deepEqual(results.map(result => result.allowed), [true, false])
  assert.equal(db.documents.size, 1)
})

test('invalid persisted counts restart safely instead of granting a negative-count allowance', async () => {
  for (const count of [-1, -100, 1.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const db = new TransactionDatabase()
    const consume = createFirestoreRateLimiter(db.asFirestore(), { limit: 1, now: () => 1000 })
    await consume('user')
    const document = [...db.documents.values()][0]
    document.data.count = count
    assert.equal((await consume('user')).allowed, true)
    assert.equal((await consume('user')).allowed, false)
    assert.equal([...db.documents.values()][0].data.count, 1)
  }
})

test('malformed reset timestamps restart the window with a fresh valid counter', async () => {
  for (const resetAt of [null, '61000', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 999.5]) {
    const db = new TransactionDatabase()
    const consume = createFirestoreRateLimiter(db.asFirestore(), { limit: 1, now: () => 1000 })
    await consume('user')
    const document = [...db.documents.values()][0]
    document.data.resetAt = resetAt
    assert.equal((await consume('user')).allowed, true)
    assert.deepEqual([...db.documents.values()][0].data, { count: 1, resetAt: 61_000 })
    assert.equal((await consume('user')).allowed, false)
  }
})

test('rejects nonpositive, fractional, nonfinite, and unsafe rate-limit configuration', () => {
  const db = new TransactionDatabase()
  for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createFirestoreRateLimiter(db.asFirestore(), { limit: invalid }), /Invalid grading rate limit configuration/)
    assert.throws(() => createFirestoreRateLimiter(db.asFirestore(), { windowMs: invalid }), /Invalid grading rate limit configuration/)
  }
  assert.doesNotThrow(() => createFirestoreRateLimiter(db.asFirestore()))
  assert.doesNotThrow(() => createFirestoreRateLimiter(db.asFirestore(), { limit: 1, windowMs: 1 }))
})

test('storage failure rejects instead of allowing a request without a shared quota', async () => {
  const db = new TransactionDatabase()
  db.unavailable = true
  const consume = createFirestoreRateLimiter(db.asFirestore())
  await assert.rejects(consume('user'), /Test storage unavailable/)
  assert.equal(db.documents.size, 0)
})
