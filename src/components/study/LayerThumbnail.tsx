import { useEffect, useRef } from 'react'
import { DrawingPath } from '@thousands-of-ties/drawing-common'

interface LayerThumbnailProps {
  paths: DrawingPath[]
  sourceWidth?: number
  sourceAspectRatio?: number
}

const PREVIEW_WIDTH = 72
const PREVIEW_HEIGHT = 48

export const LayerThumbnail = ({
  paths,
  sourceWidth = 1000,
  sourceAspectRatio = PREVIEW_WIDTH / PREVIEW_HEIGHT,
}: LayerThumbnailProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const pixelRatio = window.devicePixelRatio || 1
    canvas.width = Math.round(PREVIEW_WIDTH * pixelRatio)
    canvas.height = Math.round(PREVIEW_HEIGHT * pixelRatio)
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)

    // Keep the page proportions inside the fixed thumbnail frame.
    const safeAspectRatio = sourceAspectRatio > 0 ? sourceAspectRatio : PREVIEW_WIDTH / PREVIEW_HEIGHT
    const pageWidth = safeAspectRatio >= PREVIEW_WIDTH / PREVIEW_HEIGHT
      ? PREVIEW_WIDTH
      : PREVIEW_HEIGHT * safeAspectRatio
    const pageHeight = safeAspectRatio >= PREVIEW_WIDTH / PREVIEW_HEIGHT
      ? PREVIEW_WIDTH / safeAspectRatio
      : PREVIEW_HEIGHT
    const offsetX = (PREVIEW_WIDTH - pageWidth) / 2
    const offsetY = (PREVIEW_HEIGHT - pageHeight) / 2
    const widthScale = pageWidth / Math.max(sourceWidth, 1)

    paths.forEach(path => {
      const points = path.points
      if (points.length === 0 || path.kind === 'fill') return

      context.save()
      context.strokeStyle = path.color
      context.fillStyle = path.color
      context.globalAlpha = path.opacity ?? 1
      context.lineCap = 'round'
      context.lineJoin = 'round'

      const toX = (x: number) => offsetX + x * pageWidth
      const toY = (y: number) => offsetY + y * pageHeight
      const scaledWidth = (width?: number) => Math.max(0.65, (width ?? path.width) * widthScale)

      if (points.length === 1) {
        context.beginPath()
        context.arc(toX(points[0].x), toY(points[0].y), scaledWidth(points[0].width) / 2, 0, Math.PI * 2)
        context.fill()
        context.restore()
        return
      }

      if (path.style === 'brush') {
        for (let index = 1; index < points.length; index += 1) {
          context.beginPath()
          context.lineWidth = (scaledWidth(points[index - 1].width) + scaledWidth(points[index].width)) / 2
          context.moveTo(toX(points[index - 1].x), toY(points[index - 1].y))
          context.lineTo(toX(points[index].x), toY(points[index].y))
          context.stroke()
        }
        context.restore()
        return
      }

      context.beginPath()
      context.lineWidth = scaledWidth()
      context.moveTo(toX(points[0].x), toY(points[0].y))
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index]
        const nextPoint = points[index + 1]
        context.quadraticCurveTo(
          toX(point.x),
          toY(point.y),
          toX((point.x + nextPoint.x) / 2),
          toY((point.y + nextPoint.y) / 2),
        )
      }
      const lastPoint = points[points.length - 1]
      context.lineTo(toX(lastPoint.x), toY(lastPoint.y))
      context.stroke()
      context.restore()
    })
  }, [paths, sourceAspectRatio, sourceWidth])

  return (
    <div className="drawing-layer-thumbnail" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  )
}
