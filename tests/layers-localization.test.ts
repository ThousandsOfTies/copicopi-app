import test from 'node:test'
import assert from 'node:assert/strict'
import { createInstance } from 'i18next'
import ja from '../src/i18n/locales/ja.json'
import en from '../src/i18n/locales/en.json'
import { getLayerDisplayName, normalizeLayeredDrawing, resolveLayerNameInput,
  serializeLayeredDrawing } from '../src/components/study/layers'

const i18n = createInstance()
await i18n.init({ resources: { ja: { copicopi: ja }, en: { copicopi: en } },
  lng: 'en', defaultNS: 'copicopi', interpolation: { escapeValue: false } })

test('language changes translate automatic names without changing stored drawings or custom names', async () => {
  const drawing = { version: 2, layers: [
    { id: 'layer-1', name: 'レイヤー1', visible: true, opacity: 1 },
    { id: 'layer-2', name: '背景・Background', visible: false, opacity: 0.5 },
  ], paths: [{ type: 'pen', layerId: 'layer-1', points: [{ x: 1, y: 2 }], color: '#000', width: 3 }] }
  const { layers, paths } = normalizeLayeredDrawing(JSON.stringify(drawing))
  const original = serializeLayeredDrawing(layers, paths)
  const english = i18n.getFixedT('en', 'copicopi')
  assert.equal(getLayerDisplayName(layers[0].name, english), 'Layer 1')
  assert.equal(getLayerDisplayName(layers[1].name, english), '背景・Background')
  assert.equal(resolveLayerNameInput(layers[0].name, 'Layer 1', 1, english), 'レイヤー1')
  assert.equal(resolveLayerNameInput(layers[0].name, 'Custom sketch', 1, english), 'Custom sketch')
  assert.equal(resolveLayerNameInput(layers[0].name, '   ', 1, english), 'レイヤー1')
  await i18n.changeLanguage('ja')
  assert.equal(getLayerDisplayName(layers[0].name, i18n.t), 'レイヤー1')
  assert.equal(getLayerDisplayName('Layer 2', i18n.t), 'レイヤー2')
  assert.equal(serializeLayeredDrawing(layers, paths), original)
})

test('older unlayered drawings still load with a translated default layer and retain their strokes', () => {
  const stroke = { type: 'pen', points: [{ x: 10, y: 20 }], color: '#123456', width: 5 }
  const drawing = normalizeLayeredDrawing(JSON.stringify([stroke]))
  assert.equal(drawing.layers[0].name, 'レイヤー1')
  assert.equal(getLayerDisplayName(drawing.layers[0].name, i18n.getFixedT('en', 'copicopi')), 'Layer 1')
  assert.deepEqual(drawing.paths[0], { ...stroke, layerId: 'layer-1' })
})
