export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024

export const responseSchema = {
  type: 'object',
  properties: {
    level: { type: 'integer', minimum: 1, maximum: 5, description: 'Overall achievement level under the selected teacher policy.' },
    label: { type: 'string', description: 'A concise achievement label in the requested output language.' },
    summary: { type: 'string', description: 'An objective summary of similarities and the most important differences, in the requested output language.' },
    goodPoints: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2, description: 'Specific visible strengths, in the requested output language.' },
    improvements: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2, description: 'High-priority guidance including location, difference, and correction, in the requested output language.' },
    encouragement: { type: 'string', description: 'A short actionable exercise for the next drawing, in the requested output language.' }
  },
  required: ['level', 'label', 'summary', 'goodPoints', 'improvements', 'encouragement']
}

export const gradingGenerationConfig = {
  thinkingConfig: { thinkingLevel: 'low' },
  responseFormat: {
    text: { mimeType: 'APPLICATION_JSON', schema: responseSchema }
  },
  maxOutputTokens: 3000
}

export interface GradingImage {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
  byteLength: number
}

/** Validate the encoded upload and its format signature without decoding the image. */
export const parseImageDataUrl = (value: unknown): GradingImage => {
  const invalidImage = () => new ApiError(400, 'INVALID_IMAGE', 'Please provide a valid PNG, JPEG, or WEBP image.')
  if (typeof value !== 'string') throw invalidImage()
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]*)$/)
  if (!match) throw invalidImage()
  const [, mimeType, data] = match
  // Check the size before allocating the decoded buffer.
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  const byteLength = data.length * 3 / 4 - padding
  if (byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, 'INVALID_IMAGE', 'The image is too large.')
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw invalidImage()
  const bytes = Buffer.from(data, 'base64')
  // Buffer.from is permissive; round-tripping rejects malformed padding and unused bits.
  if (bytes.toString('base64') !== data) throw invalidImage()
  const validSignature = mimeType === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : mimeType === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.subarray(0, 4).equals(Buffer.from('RIFF')) && bytes.subarray(8, 12).equals(Buffer.from('WEBP'))
  if (!validSignature) throw invalidImage()
  return { mimeType: mimeType as GradingImage['mimeType'], data, byteLength: bytes.length }
}

export interface GradingEvaluation {
  level: number
  label: string
  summary: string
  goodPoints: string[]
  improvements: string[]
  encouragement: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonemptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isFeedbackList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length >= 1 && value.length <= 2 && value.every(isNonemptyText)

/** Structured output still needs validation before rendering or saving a review. */
export const parseGradingResponse = (payload: unknown): GradingEvaluation => {
  const invalidResponse = () => new ApiError(502, 'INVALID_AI_RESPONSE', 'The AI returned an invalid review result.')
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) throw invalidResponse()
  const candidate: unknown = payload.candidates[0]
  if (!isRecord(candidate) || candidate.finishReason !== 'STOP' || !isRecord(candidate.content)) throw invalidResponse()
  const parts = candidate.content.parts
  if (!Array.isArray(parts)) throw invalidResponse()
  let text = ''
  for (const part of parts) {
    if (!isRecord(part)) throw invalidResponse()
    if (part.thought === true) continue
    if (typeof part.text !== 'string') throw invalidResponse()
    text += part.text
  }
  let result: unknown
  try {
    result = JSON.parse(text)
  } catch {
    throw invalidResponse()
  }
  if (!isRecord(result)
    || typeof result.level !== 'number' || !Number.isInteger(result.level) || result.level < 1 || result.level > 5
    || !isNonemptyText(result.label) || !isNonemptyText(result.summary) || !isNonemptyText(result.encouragement)
    || !isFeedbackList(result.goodPoints) || !isFeedbackList(result.improvements)) throw invalidResponse()
  return {
    level: result.level,
    label: result.label,
    summary: result.summary,
    goodPoints: result.goodPoints,
    improvements: result.improvements,
    encouragement: result.encouragement
  }
}
