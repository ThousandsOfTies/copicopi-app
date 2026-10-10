import { useAnswerViewport } from '@home-teacher/common/hooks/useAnswerViewport'
import { viewportCursorPosition, touchPair, useStrokeInput, drawStationaryStroke, resizeCanvasForDisplay, getCanvasLogicalSize } from '@thousands-of-ties/drawing-common'
import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { ICON_SVG } from '../../constants/icons'
import { CanvasUndoHistory, drawAdditionalStrokeStyle, type StrokeStyle } from '@thousands-of-ties/drawing-common'
import './AnswerPanel.css'

export interface AnswerPanelHandle {
  getCompositeImage: () => Promise<string | null>
  undo: () => void
  clear: () => void
  canUndo: boolean
}

interface AnswerPanelProps {
  questionImage: string | null
  penColor: string
  penSize: number
  strokeStyle: StrokeStyle
  isEraserMode: boolean
  eraserSize: number
  onCanUndoChange?: (canUndo: boolean) => void
}

// Canvas layout constants
const SIDE_MARGIN = 48
const TOP_MARGIN = 36
const BOTTOM_MARGIN = 48
const MIN_IMAGE_WIDTH = 600  // scale up captured image to at least this width

const AnswerPanel = forwardRef<AnswerPanelHandle, AnswerPanelProps>(({
  questionImage,
  penColor,
  penSize,
  strokeStyle,
  isEraserMode,
  eraserSize,
  onCanUndoChange,
}, ref) => {
  // bgCanvas: question image + writing area background (never modified by user)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  // drawCanvas: transparent overlay for pen strokes only
  const drawCanvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawingRef = useRef(false)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef(new CanvasUndoHistory())
  const [canUndo, setCanUndo] = useState(false)
  const [eraserCursorPos, setEraserCursorPos] = useState<{ x: number; y: number; diameter: number } | null>(null)

  // Zoom & Pan state
  const containerRef = useRef<HTMLDivElement>(null)
  const { zoom, panOffset, restoreViewport, isPanning, isCtrlPressed, getViewport, applyPinch,
    startPanning, doPanning, stopPanning } = useAnswerViewport(containerRef)
  const [isPinching, setIsPinching] = useState(false)
  const gestureRef = useRef<{ startZoom: number; startPan: { x: number; y: number }; startDist: number; startCenter: { x: number; y: number } } | null>(null)

  // Build background canvas: question image + writing space
  // Portrait → image top, writing space below (×2 height ≈ A4→A3)
  // Landscape → image left, writing space right (same width, ≈ A4→A3)
  const initCanvas = (img: HTMLImageElement) => {
    const bgCanvas = bgCanvasRef.current
    const drawCanvas = drawCanvasRef.current
    if (!bgCanvas || !drawCanvas) return

    // Scale up small images so the writing area is comfortable to use
    const displayScale = Math.max(1, MIN_IMAGE_WIDTH / img.naturalWidth)
    const imgW = Math.round(img.naturalWidth * displayScale)
    const imgH = Math.round(img.naturalHeight * displayScale)
    console.log('[AnswerPanel] initCanvas:', { naturalW: img.naturalWidth, naturalH: img.naturalHeight, displayScale, imgW, imgH })

    const isLandscape = imgW > imgH

    // 横長・縦長ともに画像は上部中央に配置、書き込みスペースは下
    // 横長はキャンバス幅を広くとって横長比率を維持
    const w = isLandscape
      ? SIDE_MARGIN * 2 + imgW * 2 + 32  // 画像幅×2＋余白（横長比率維持）
      : Math.max(imgW + SIDE_MARGIN * 2, 800)
    const writingH = isLandscape
      ? Math.max(Math.round(imgH * 1.5), 400)
      : Math.max(imgH * 2, 360)
    const h = TOP_MARGIN + imgH + writingH + BOTTOM_MARGIN
    const imageLeft = Math.round((w - imgW) / 2)  // 常に水平中央

    resizeCanvasForDisplay(bgCanvas, w, h)
    resizeCanvasForDisplay(drawCanvas, w, h)
    console.log('[AnswerPanel] canvas size:', { w, h, isLandscape })

    const ctx = bgCanvas.getContext('2d')!

    // White background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    // Question image
    ctx.drawImage(img, imageLeft, TOP_MARGIN, imgW, imgH)

    // Clear draw canvas (fully transparent)
    const dCtx = drawCanvas.getContext('2d')!
    dCtx.clearRect(0, 0, w, h)

    historyRef.current.clear()
    setCanUndo(false)
    onCanUndoChange?.(false)
  }

  // Load image and init canvas when questionImage changes
  useEffect(() => {
    if (!questionImage) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      initCanvas(img)
      // Reset zoom/pan on new image
      restoreViewport({ zoom: 1, panOffset: { x: 0, y: 0 } })
    }
    img.src = questionImage
    return () => { cancelled = true; img.onload = null }
  }, [questionImage])


  const saveSnapshot = () => {
    const drawCanvas = drawCanvasRef.current
    if (!drawCanvas) return
    if (!historyRef.current.push(drawCanvas, undefined)) return
    setCanUndo(true)
    onCanUndoChange?.(true)
  }

  const handleUndo = () => {
    const drawCanvas = drawCanvasRef.current
    if (!drawCanvas) return
    if (!historyRef.current.undo(drawCanvas)) return
    const hasHistory = historyRef.current.length > 0
    setCanUndo(hasHistory)
    onCanUndoChange?.(hasHistory)
  }

  const handleClear = () => {
    const drawCanvas = drawCanvasRef.current
    if (!drawCanvas) return
    saveSnapshot()
    const ctx = drawCanvas.getContext('2d')!
    const logicalSize = getCanvasLogicalSize(drawCanvas)
    ctx.clearRect(0, 0, logicalSize.width, logicalSize.height)
  }

  // Composite bg + draw canvases into a single PNG
  const getCompositeImage = async (): Promise<string | null> => {
    const bgCanvas = bgCanvasRef.current
    const drawCanvas = drawCanvasRef.current
    if (!bgCanvas || !drawCanvas) return null

    const out = document.createElement('canvas')
    const logicalSize = getCanvasLogicalSize(bgCanvas)
    out.width = logicalSize.width
    out.height = logicalSize.height
    const ctx = out.getContext('2d')!
    ctx.drawImage(bgCanvas, 0, 0, out.width, out.height)
    ctx.drawImage(drawCanvas, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  }

  useImperativeHandle(ref, () => ({
    getCompositeImage,
    undo: handleUndo,
    clear: handleClear,
    canUndo,
  }), [canUndo, questionImage])

  const getPos = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = drawCanvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const logicalSize = getCanvasLogicalSize(canvas)
    const scaleX = logicalSize.width / rect.width
    const scaleY = logicalSize.height / rect.height
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const startDraw = (clientX: number, clientY: number) => {
    saveSnapshot()
    isDrawingRef.current = true
    lastPosRef.current = getPos(clientX, clientY)
  }

  const drawTo = (clientX: number, clientY: number) => {
    if (!isDrawingRef.current || !lastPosRef.current || !drawCanvasRef.current) return
    const canvas = drawCanvasRef.current
    const ctx = canvas.getContext('2d')!
    const pos = getPos(clientX, clientY)
    const rect = canvas.getBoundingClientRect()
    const scale = getCanvasLogicalSize(canvas).width / rect.width

    if (isEraserMode) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = eraserSize * scale
    } else if (strokeStyle === 'calligraphy' || strokeStyle === 'crayon') {
      ctx.globalCompositeOperation = 'source-over'
      drawAdditionalStrokeStyle(ctx, {
        points: [lastPosRef.current, pos].map(point => ({
          x: point.x / canvas.width,
          y: point.y / canvas.height,
        })),
        color: penColor,
        width: penSize * scale,
        style: strokeStyle,
      }, {
        scaleX: canvas.width,
        scaleY: canvas.height,
        widthScale: 1,
      })
      lastPosRef.current = pos
      return
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = penColor
      ctx.lineWidth = penSize * scale
    }
    ctx.beginPath()
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (!drawStationaryStroke(ctx, [lastPosRef.current, pos], ctx.lineWidth)) ctx.stroke()
    lastPosRef.current = pos
  }

  const stopDraw = () => {
    if (drawCanvasRef.current) {
      drawCanvasRef.current.getContext('2d')!.globalCompositeOperation = 'source-over'
    }
    isDrawingRef.current = false
    lastPosRef.current = null
  }

  const getEraserCursorPos = (clientX: number, clientY: number) =>
    viewportCursorPosition(containerRef.current, clientX, clientY, eraserSize)

  const cursor = isPanning ? 'grabbing' : (isCtrlPressed ? 'grab' : (isEraserMode ? 'none' : ICON_SVG.penCursor(penColor)))



  const strokeInput = useStrokeInput({
    eventTargetRef: drawCanvasRef,
    enabled: !isCtrlPressed,
    onStart: point => startDraw(point.clientX, point.clientY),
    onMove: points => {
      for (const point of points) drawTo(point.clientX, point.clientY)
      const last = points[points.length - 1]
      if (isEraserMode && last) setEraserCursorPos(getEraserCursorPos(last.clientX, last.clientY))
    },
    onEnd: () => { stopDraw(); setEraserCursorPos(null) },
  })

  return (
    <div
      className="answer-panel-content"
      ref={containerRef}
      style={{ position: 'relative', overflow: 'hidden', touchAction: 'none' }}
    >
      <div
        className="answer-canvas-stack"
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isPanning || isPinching ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        {/* Background layer: question image + writing area */}
        <canvas ref={bgCanvasRef} className="answer-bg-canvas" />
        {/* Drawing layer: transparent overlay for strokes */}
        <canvas
          ref={drawCanvasRef}
          className="answer-draw-canvas"
          style={{ cursor }}
          onPointerDown={(e) => {
            if (e.pointerType === 'touch') return
            if (isCtrlPressed || e.button === 1) {
              startPanning(e.clientX, e.clientY)
            } else if (e.button === 0) {
              strokeInput.onPointerDown(e)
            }
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'touch') return
            if (isPanning) {
              doPanning(e.clientX, e.clientY)
            } else {
              if (isEraserMode) setEraserCursorPos(getEraserCursorPos(e.clientX, e.clientY))
              strokeInput.onPointerMove(e)
            }
          }}
          onPointerUp={(e) => { strokeInput.onPointerUp(e); stopPanning() }}
          onPointerCancel={(e) => { strokeInput.onPointerCancel(e); stopPanning() }}
          onLostPointerCapture={strokeInput.onLostPointerCapture}
          onPointerLeave={() => { setEraserCursorPos(null) }}
          onTouchStart={(e) => {
            if (strokeInput.onTouchStart(e)) return
            if (e.touches.length === 2) {
              setIsPinching(true)
              strokeInput.cancel()
              const pair = touchPair(e.touches)
              const current = getViewport()
              gestureRef.current = { startZoom: current.zoom, startPan: current.panOffset, startDist: pair.distance, startCenter: pair.center }
            }
          }}
          onTouchMove={(e) => {
            if (strokeInput.onTouchMove(e)) return
            if (e.touches.length === 2 && gestureRef.current) {
              applyPinch(gestureRef.current, touchPair(e.touches))
            }
          }}
          onTouchEnd={(e) => { if (strokeInput.onTouchEnd(e)) return; setIsPinching(false); stopPanning(); setEraserCursorPos(null); gestureRef.current = null }}
          onTouchCancel={(e) => { if (strokeInput.onTouchCancel(e)) return; setIsPinching(false); stopPanning(); setEraserCursorPos(null); gestureRef.current = null }}
        />
      </div>
      {/* Eraser circle cursor */}
      {isEraserMode && eraserCursorPos && (
        <div
          style={{
            position: 'absolute',
            left: `${eraserCursorPos.x}px`,
            top: `${eraserCursorPos.y}px`,
            width: `${eraserSize}px`,
            height: `${eraserSize}px`,
            borderRadius: '50%',
            backgroundColor: 'rgba(255, 100, 100, 0.2)',
            border: '2px solid rgba(255, 100, 100, 0.6)',
            pointerEvents: 'none',
            transform: 'translate(-50%, -50%)',
            zIndex: 9999,
          }}
        />
      )}
    </div>
  )
})

AnswerPanel.displayName = 'AnswerPanel'

export default AnswerPanel
