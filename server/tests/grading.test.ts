import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, MAX_IMAGE_BYTES, parseImageDataUrl, parseGradingResponse } from '../src/grading.js'

const evaluation = {
  level: 3,
  label: 'Good progress',
  summary: 'The main pose is recognizable.',
  goodPoints: ['The silhouette follows the reference.'],
  improvements: ['Make the head slightly smaller.'],
  encouragement: 'Compare the head and torso before drawing.'
}

const response = (value: unknown = evaluation, finishReason: unknown = 'STOP') => ({
  candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }]
})

const apiError = (status: number, code: string) => (error: unknown) => {
  assert.ok(error instanceof ApiError)
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  return true
}

test('accepts complete reviews and both achievement-level boundaries without rewriting their text', () => {
  for (const level of [1, 3, 5]) {
    const expected = { ...evaluation, level, label: '  観察できています  ', goodPoints: ['輪郭', 'ポーズ'] }
    assert.deepEqual(parseGradingResponse(response(expected)), expected)
  }
})

test('ignores thought parts and combines multiple visible text parts', () => {
  const json = JSON.stringify(evaluation)
  assert.deepEqual(parseGradingResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [
    { thought: true, text: 'This is private reasoning, not JSON.' },
    { text: json.slice(0, 20) },
    { thought: true, text: '{"level":99}' },
    { text: json.slice(20) }
  ] } }] }), evaluation)
})

test('rejects incomplete, blocked, missing, and unknown finish reasons even with valid JSON', () => {
  for (const reason of ['MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER', '', null, undefined]) {
    const payload = response(evaluation)
    payload.candidates[0].finishReason = reason
    assert.throws(() => parseGradingResponse(payload), apiError(502, 'INVALID_AI_RESPONSE'))
  }
})

test('rejects empty and malformed Gemini responses without exposing response text', () => {
  for (const payload of [
    undefined, null, [], {}, { candidates: [] }, { candidates: [null] },
    { candidates: [{ finishReason: 'STOP' }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [null] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 42 }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: {} }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: JSON.stringify(evaluation) }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'secret invalid JSON' }] } }] },
    response(null), response([]), response('not an object')
  ]) {
    assert.throws(() => parseGradingResponse(payload), error => {
      apiError(502, 'INVALID_AI_RESPONSE')(error)
      assert.equal((error as ApiError).message, 'The AI returned an invalid review result.')
      return true
    })
  }
})

test('rejects noninteger and out-of-range achievement levels', () => {
  for (const level of [0, 6, -1, 2.5, '3', null, undefined, NaN, Infinity]) {
    assert.throws(() => parseGradingResponse(response({ ...evaluation, level })), apiError(502, 'INVALID_AI_RESPONSE'))
  }
})

test('requires nonempty strings in every user-facing field', () => {
  for (const field of ['label', 'summary', 'encouragement']) {
    for (const value of [undefined, null, '', ' \n\t', 0, {}, []]) {
      assert.throws(() => parseGradingResponse(response({ ...evaluation, [field]: value })), apiError(502, 'INVALID_AI_RESPONSE'))
    }
  }
})

test('requires one or two nonempty strings in both feedback lists', () => {
  for (const field of ['goodPoints', 'improvements']) {
    for (const value of [undefined, null, 'point', [], ['one', 'two', 'three'], [42], [''], [' '], ['good', null]]) {
      assert.throws(() => parseGradingResponse(response({ ...evaluation, [field]: value })), apiError(502, 'INVALID_AI_RESPONSE'))
    }
  }
})

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
const dataUrl = (bytes: Buffer, mimeType = 'image/png') => `data:${mimeType};base64,${bytes.toString('base64')}`

test('accepts PNG, JPEG, and WEBP signatures with matching media types', () => {
  for (const [mimeType, bytes] of [
    ['image/png', png],
    ['image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])],
    ['image/webp', Buffer.from('524946460400000057454250', 'hex')]
  ] as const) {
    assert.deepEqual(parseImageDataUrl(dataUrl(bytes, mimeType)), {
      mimeType, data: bytes.toString('base64'), byteLength: bytes.length
    })
  }
})

test('rejects missing images, unsupported types, malformed base64, and mismatched signatures', () => {
  for (const value of [
    undefined, null, 12, '', 'https://example.com/image.png',
    'data:image/png;base64,', 'data:image/gif;base64,R0lGODlh',
    'data:image/png;base64,====', 'data:image/png;base64,a===',
    'data:image/png;base64,a', 'data:image/png;base64,AAAA\n',
    'data:image/png;base64,AA_A', 'data:image/png;base64,AA-A',
    // Alternate padding bits must not be silently accepted by Buffer.from.
    'data:image/png;base64,iVBORw0KGgp=',
    dataUrl(Buffer.from('not an image')), dataUrl(png, 'image/jpeg'),
    dataUrl(Buffer.from([0xff, 0xd8]), 'image/jpeg'),
    dataUrl(Buffer.from('RIFF'), 'image/webp'),
    dataUrl(Buffer.from('d24946460400000057454250', 'hex'), 'image/webp')
  ]) {
    assert.throws(() => parseImageDataUrl(value), apiError(400, 'INVALID_IMAGE'))
  }
})

test('enforces the decoded image-size boundary before sending it upstream', () => {
  const bytes = Buffer.alloc(MAX_IMAGE_BYTES + 1)
  png.subarray(0, 8).copy(bytes)
  assert.equal(parseImageDataUrl(dataUrl(bytes.subarray(0, MAX_IMAGE_BYTES))).byteLength, MAX_IMAGE_BYTES)
  assert.throws(() => parseImageDataUrl(dataUrl(bytes)), apiError(413, 'INVALID_IMAGE'))
})
