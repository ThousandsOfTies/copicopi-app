import { useEffect, useState } from 'react'
import type { DrawingPath } from '@thousands-of-ties/drawing-common'
import { getAllDrawings } from '@home-teacher/common/utils/indexedDB'
import { useStudyDrawingSaveQueue } from '@home-teacher/common/hooks/useStudyPageAnnotations'
import { normalizeLayeredDrawing, type DrawingLayer } from './layers'

// The B-side layer format belongs to CopiCopi; the shared queue accepts serialized
// data without interpreting it as the plain path array used by the other apps.
export function useCopiDrawingState(pdfId: string) {
  const [drawingPathsB, setDrawingPathsB] = useState<Map<number, DrawingPath[]>>(new Map())
  const [drawingLayersB, setDrawingLayersB] = useState<Map<number, DrawingLayer[]>>(new Map())
  const [activeLayerIdsB, setActiveLayerIdsB] = useState<Map<number, string>>(new Map())
  const pendingDrawingWritesRef = useStudyDrawingSaveQueue(pdfId, drawingPathsB)

  useEffect(() => {
    let active = true
    getAllDrawings(pdfId).then(saved => {
      const pathsByPage = new Map<number, DrawingPath[]>()
      const layersByPage = new Map<number, DrawingLayer[]>()
      const activeLayers = new Map<number, string>()
      for (const [pageString, json] of Object.entries(saved)) {
        const page = Number(pageString)
        const { layers, paths } = normalizeLayeredDrawing(json)
        layersByPage.set(page, layers)
        activeLayers.set(page, layers[layers.length - 1].id)
        if (paths.length) pathsByPage.set(page, paths)
      }
      if (!active) return
      setDrawingPathsB(pathsByPage)
      setDrawingLayersB(layersByPage)
      setActiveLayerIdsB(activeLayers)
    }).catch(error => console.error('Failed to load drawings:', error))
    return () => { active = false }
  }, [pdfId])

  return { drawingPathsB, setDrawingPathsB, drawingLayersB, setDrawingLayersB,
    activeLayerIdsB, setActiveLayerIdsB, pendingDrawingWritesRef }
}
