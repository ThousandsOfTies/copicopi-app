import type { TFunction } from 'i18next'
import ja from '../../i18n/locales/ja.json'
import en from '../../i18n/locales/en.json'
import { DrawingPath } from '@thousands-of-ties/drawing-common'

// Keep automatic names stable in stored drawings; localize only their display.
export const getDefaultLayerName = (number: number): string =>
  ja.layers.numbered.replace('{{number}}', String(number))

export function getLayerDisplayName(name: string, t: TFunction): string {
  for (const messages of [ja, en]) {
    const [prefix, suffix] = messages.layers.numbered.split('{{number}}')
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue
    const number = name.slice(prefix.length, suffix ? -suffix.length : undefined)
    if (/^\d+$/.test(number)) return t('layers.numbered', { number })
  }
  return name
}

export function resolveLayerNameInput(name: string, input: string, number: number, t: TFunction): string {
  if (input === getLayerDisplayName(name, t)) return name
  return input.trim() || getDefaultLayerName(number)
}

export const DEFAULT_LAYER_ID = 'layer-1'
export const MAX_DRAWING_LAYERS = 10

export interface DrawingLayer {
  id: string
  name: string
  visible: boolean
  opacity: number
}

interface StoredLayeredDrawingPage {
  version: 2
  layers: DrawingLayer[]
  paths: DrawingPath[]
}

export const createDefaultLayer = (): DrawingLayer => ({
  id: DEFAULT_LAYER_ID,
  name: getDefaultLayerName(1),
  visible: true,
  opacity: 1,
})

export const normalizeLayeredDrawing = (drawingData: string): { layers: DrawingLayer[]; paths: DrawingPath[] } => {
  const parsed: unknown = JSON.parse(drawingData)

  if (Array.isArray(parsed)) {
    return {
      layers: [createDefaultLayer()],
      paths: (parsed as DrawingPath[]).map(path => ({ ...path, layerId: path.layerId || DEFAULT_LAYER_ID })),
    }
  }

  const stored = parsed as Partial<StoredLayeredDrawingPage> | null
  const layers = Array.isArray(stored?.layers)
    ? stored.layers
      .filter((layer): layer is DrawingLayer => Boolean(layer?.id))
      .slice(0, MAX_DRAWING_LAYERS)
      .map((layer, index) => ({
        id: layer.id,
        name: layer.name?.trim() || getDefaultLayerName(index + 1),
        visible: layer.visible !== false,
        opacity: typeof layer.opacity === 'number' && Number.isFinite(layer.opacity)
          ? Math.max(0, Math.min(1, layer.opacity))
          : 1,
      }))
    : []
  const safeLayers = layers.length > 0 ? layers : [createDefaultLayer()]
  const layerIds = new Set(safeLayers.map(layer => layer.id))
  const fallbackLayerId = safeLayers[0].id
  const paths = Array.isArray(stored?.paths)
    ? stored.paths.map(path => ({
      ...path,
      layerId: path.layerId && layerIds.has(path.layerId) ? path.layerId : fallbackLayerId,
    }))
    : []

  return { layers: safeLayers, paths }
}

export const sortPathsByLayer = (paths: DrawingPath[], layers: DrawingLayer[]): DrawingPath[] => {
  const order = new Map(layers.map((layer, index) => [layer.id, index]))
  return paths
    .map((path, index) => ({ path, index }))
    .sort((a, b) => {
      const layerDifference = (order.get(a.path.layerId || DEFAULT_LAYER_ID) ?? 0)
        - (order.get(b.path.layerId || DEFAULT_LAYER_ID) ?? 0)
      return layerDifference || a.index - b.index
    })
    .map(({ path }) => path)
}

export const serializeLayeredDrawing = (layers: DrawingLayer[], paths: DrawingPath[]): string => JSON.stringify({
  version: 2,
  layers,
  paths: sortPathsByLayer(paths, layers),
} satisfies StoredLayeredDrawingPage)
