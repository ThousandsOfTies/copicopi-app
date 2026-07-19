import { DrawingPath } from '@thousands-of-ties/drawing-common'

export const DEFAULT_LAYER_ID = 'layer-1'
export const MAX_DRAWING_LAYERS = 10

export interface DrawingLayer {
  id: string
  name: string
  visible: boolean
}

interface StoredLayeredDrawingPage {
  version: 2
  layers: DrawingLayer[]
  paths: DrawingPath[]
}

export const createDefaultLayer = (): DrawingLayer => ({
  id: DEFAULT_LAYER_ID,
  name: 'レイヤー1',
  visible: true,
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
        name: layer.name?.trim() || `レイヤー${index + 1}`,
        visible: layer.visible !== false,
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
