import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import './GradingSpread.css'

interface PanZoomPaneProps {
  children: ReactNode
  className?: string
  fitMode: 'contain' | 'width'
  contentKey: string
}

const PanZoomPane = ({ children, className = '', fitMode, contentKey }: PanZoomPaneProps) => {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const pinchRef = useRef<{ distance: number; scale: number; panX: number; panY: number; centerX: number; centerY: number } | null>(null)
  const fitScaleRef = useRef(1)
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })

  const clampTransform = useCallback((scale: number, x: number, y: number) => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return { scale, x, y }

    const contentWidth = content.offsetWidth * scale
    const contentHeight = content.offsetHeight * scale
    const margin = Math.min(viewport.clientWidth, viewport.clientHeight) * 0.025

    const nextX = contentWidth <= viewport.clientWidth - margin * 2
      ? (viewport.clientWidth - contentWidth) / 2
      : Math.min(margin, Math.max(viewport.clientWidth - contentWidth - margin, x))
    const nextY = contentHeight <= viewport.clientHeight - margin * 2
      ? (viewport.clientHeight - contentHeight) / 2
      : Math.min(margin, Math.max(viewport.clientHeight - contentHeight - margin, y))

    return { scale, x: nextX, y: nextY }
  }, [])

  const fit = useCallback(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content || !content.offsetWidth || !content.offsetHeight) return

    const widthScale = viewport.clientWidth * 0.95 / content.offsetWidth
    const heightScale = viewport.clientHeight * 0.95 / content.offsetHeight
    const scale = fitMode === 'contain' ? Math.min(widthScale, heightScale) : widthScale
    fitScaleRef.current = scale

    const x = (viewport.clientWidth - content.offsetWidth * scale) / 2
    const y = fitMode === 'contain'
      ? (viewport.clientHeight - content.offsetHeight * scale) / 2
      : viewport.clientHeight * 0.025
    setTransform({ scale, x, y })
  }, [fitMode])

  useEffect(() => {
    const frame = requestAnimationFrame(fit)
    const observer = new ResizeObserver(() => fit())
    if (viewportRef.current) observer.observe(viewportRef.current)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [contentKey, fit])

  const zoomAt = (nextScale: number, clientX: number, clientY: number) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    setTransform(current => {
      const scale = Math.min(Math.max(nextScale, fitScaleRef.current), fitScaleRef.current * 5)
      const localX = clientX - rect.left
      const localY = clientY - rect.top
      const contentX = (localX - current.x) / current.scale
      const contentY = (localY - current.y) / current.scale
      return clampTransform(scale, localX - contentX * scale, localY - contentY * scale)
    })
  }

  return (
    <div
      ref={viewportRef}
      className={`grading-pan-zoom-pane ${className}`}
      onWheel={(event) => {
        event.preventDefault()
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1
        zoomAt(transform.scale * factor, event.clientX, event.clientY)
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') return
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { x: event.clientX, y: event.clientY, panX: transform.x, panY: transform.y }
      }}
      onPointerMove={(event) => {
        if (!dragRef.current || event.pointerType === 'touch') return
        const drag = dragRef.current
        setTransform(current => clampTransform(
          current.scale,
          drag.panX + event.clientX - drag.x,
          drag.panY + event.clientY - drag.y
        ))
      }}
      onPointerUp={(event) => {
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onDoubleClick={fit}
      onTouchStart={(event) => {
        if (event.touches.length === 1) {
          const touch = event.touches[0]
          dragRef.current = { x: touch.clientX, y: touch.clientY, panX: transform.x, panY: transform.y }
          pinchRef.current = null
        } else if (event.touches.length === 2) {
          const [a, b] = [event.touches[0], event.touches[1]]
          pinchRef.current = {
            distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
            scale: transform.scale,
            panX: transform.x,
            panY: transform.y,
            centerX: (a.clientX + b.clientX) / 2,
            centerY: (a.clientY + b.clientY) / 2
          }
          dragRef.current = null
        }
      }}
      onTouchMove={(event) => {
        event.preventDefault()
        if (event.touches.length === 2 && pinchRef.current) {
          const [a, b] = [event.touches[0], event.touches[1]]
          const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
          const centerX = (a.clientX + b.clientX) / 2
          const centerY = (a.clientY + b.clientY) / 2
          const start = pinchRef.current
          const nextScale = start.scale * distance / start.distance
          const viewport = viewportRef.current
          if (!viewport) return
          const rect = viewport.getBoundingClientRect()
          const startLocalX = start.centerX - rect.left
          const startLocalY = start.centerY - rect.top
          const contentX = (startLocalX - start.panX) / start.scale
          const contentY = (startLocalY - start.panY) / start.scale
          const localX = centerX - rect.left
          const localY = centerY - rect.top
          const scale = Math.min(Math.max(nextScale, fitScaleRef.current), fitScaleRef.current * 5)
          setTransform(clampTransform(scale, localX - contentX * scale, localY - contentY * scale))
        } else if (event.touches.length === 1 && dragRef.current) {
          const touch = event.touches[0]
          const drag = dragRef.current
          setTransform(current => clampTransform(
            current.scale,
            drag.panX + touch.clientX - drag.x,
            drag.panY + touch.clientY - drag.y
          ))
        }
      }}
      onTouchEnd={() => {
        dragRef.current = null
        pinchRef.current = null
      }}
    >
      <div
        ref={contentRef}
        className="grading-pan-zoom-content"
        style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
      >
        {children}
      </div>
    </div>
  )
}

interface GradingSpreadProps {
  capturedImage: string
  resultSheet: ReactNode
  resultKey: string
  isSplitView: boolean
  activeTab: 'A' | 'B'
  isPanesReversed: boolean
  splitRatio: number
  isResizing: boolean
  onResizeStart: (event: React.MouseEvent | React.TouchEvent) => void
  splitContainerRef: React.RefObject<HTMLDivElement>
}

const GradingSpread = ({
  capturedImage,
  resultSheet,
  resultKey,
  isSplitView,
  activeTab,
  isPanesReversed,
  splitRatio,
  isResizing,
  onResizeStart,
  splitContainerRef
}: GradingSpreadProps) => (
  <div ref={splitContainerRef} className="grading-spread">
    {(isSplitView || activeTab === 'A') && (
      <PanZoomPane
        className="grading-spread-pane grading-spread-pane-a"
        fitMode="contain"
        contentKey={capturedImage}
      >
        <img className="grading-captured-image" src={capturedImage} alt="採点に使用した見本と模写" draggable={false} />
      </PanZoomPane>
    )}

    {isSplitView && (
      <div
        className={`grading-spread-divider ${isResizing ? 'is-resizing' : ''}`}
        onMouseDown={onResizeStart}
        onTouchStart={onResizeStart}
      />
    )}

    {(isSplitView || activeTab === 'B') && (
      <PanZoomPane
        className="grading-spread-pane grading-spread-pane-b"
        fitMode="width"
        contentKey={resultKey}
      >
        {resultSheet}
      </PanZoomPane>
    )}

    <style>{`
      .grading-spread-pane-a {
        flex: ${isSplitView ? `0 0 ${Math.round(splitRatio * 100)}%` : '1 1 auto'};
        order: ${isSplitView && isPanesReversed ? 3 : 1};
      }
      .grading-spread-pane-b {
        flex: ${isSplitView ? `0 0 ${Math.round((1 - splitRatio) * 100)}%` : '1 1 auto'};
        order: ${isSplitView && isPanesReversed ? 1 : 3};
      }
    `}</style>
  </div>
)

export default GradingSpread
