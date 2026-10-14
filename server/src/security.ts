import { createHash } from 'node:crypto'
import type express from 'express'
import type { auth, firestore } from 'firebase-admin'

export type VerifiedUser = Pick<auth.DecodedIdToken, 'uid' | 'email'>
export type AuthenticatedRequest = express.Request & { user?: VerifiedUser }
export type VerifyToken = (token: string) => Promise<VerifiedUser>
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number }
export type ConsumeRateLimit = (uid: string) => Promise<RateLimitResult>

export const apiError = (res: express.Response, status: number, code: string, error: string) =>
  res.status(status).json({ success: false, code, error })

export function authenticate(verifyToken: VerifyToken, isConfigured: () => boolean = () => true): express.RequestHandler {
  return async (req: AuthenticatedRequest, res, next) => {
    const match = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i)
    if (!match) return void apiError(res, 401, 'AUTH_REQUIRED', 'Authentication required')
    if (!isConfigured()) return void apiError(res, 503, 'SERVICE_UNAVAILABLE', 'Authentication unavailable')
    try {
      const user = await verifyToken(match[1])
      if (!user.uid) throw new Error('Missing user ID')
      req.user = user
      next()
    } catch {
      // Never log the token or errors that might contain request credentials.
      apiError(res, 401, 'AUTH_REQUIRED', 'Invalid authentication token')
    }
  }
}

export function limitGrading(consume: ConsumeRateLimit): express.RequestHandler {
  return async (req: AuthenticatedRequest, res, next) => {
    if (!req.user) return void apiError(res, 401, 'AUTH_REQUIRED', 'Authentication required')
    try {
      const result = await consume(req.user.uid)
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds))
        return void apiError(res, 429, 'RATE_LIMITED', 'Too many review requests')
      }
      next()
    } catch {
      console.error('[grade-work] Rate limit storage unavailable')
      apiError(res, 503, 'SERVICE_UNAVAILABLE', 'Review temporarily unavailable')
    }
  }
}

/** One private document per user; transactions share the limit across Cloud Run instances. */
export function createFirestoreRateLimiter(
  db: firestore.Firestore,
  { limit = 10, windowMs = 60_000, now = Date.now } = {},
): ConsumeRateLimit {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error('Invalid grading rate limit configuration')
  }
  return async uid => {
    const id = createHash('sha256').update(uid).digest('hex')
    // Keep counters outside the client-writable users/{uid} documents.
    const ref = db.collection('_apiRateLimits').doc(`grade-${id}`)
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref)
      const previous = snapshot.data()
      const time = now()
      const active = Number.isSafeInteger(previous?.resetAt) && previous!.resetAt > time
      const resetAt = active ? previous!.resetAt as number : time + windowMs
      const count = active && Number.isSafeInteger(previous?.count) && previous!.count >= 0 ? previous!.count as number : 0
      const retryAfterSeconds = Math.max(1, Math.ceil(Math.min(resetAt - time, windowMs) / 1000))
      if (count >= limit) return { allowed: false, retryAfterSeconds }
      transaction.set(ref, { count: count + 1, resetAt })
      return { allowed: true, retryAfterSeconds: 0 }
    })
  }
}
