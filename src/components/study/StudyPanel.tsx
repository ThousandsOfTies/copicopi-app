
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GradingResponseResult, getAvailableModels, ModelInfo } from '@home-teacher/common/services/api'
import GradingResult from './GradingResult'
import GradingSpread from './GradingSpread'
import AnswerPanel, { AnswerPanelHandle } from './AnswerPanel'
import { savePDFRecord, getPDFRecord, updatePDFRecord, getAllSNSLinks, SNSLinkRecord, PDFFileRecord, saveGradingHistory, generateGradingHistoryId, saveDrawing, saveTextAnnotation, getAppSettings } from '@home-teacher/common/utils/indexedDB'
import { ICON_SVG } from '../../constants/icons'
import { DrawingPath } from '@thousands-of-ties/drawing-common'
import { PDFPane, PDFPaneHandle } from '@home-teacher/common/components/study/PDFPane'
import { StudyToolbar, BreadcrumbItem, BrushType, StrokeStyle, TeacherMode } from './StudyToolbar'
import { usePDFRenderer } from '@home-teacher/common/hooks/pdf/usePDFRenderer'
import './StudyPanel.css'
import { useGrading } from '../../hooks/study/useGrading'
import { compressImage } from '@home-teacher/common/utils/image'
import { useAuth } from '@home-teacher/common/contexts/AuthContext'
import { FiChevronDown, FiChevronUp, FiDroplet, FiEye, FiEyeOff, FiPlus, FiTrash2, FiX } from 'react-icons/fi'
import { createDefaultLayer, DrawingLayer, MAX_DRAWING_LAYERS, normalizeLayeredDrawing, serializeLayeredDrawing, sortPathsByLayer } from './layers'
import { LayerThumbnail } from './LayerThumbnail'

// テキストアノテーションの型定義
export type TextDirection = 'horizontal' | 'vertical-rl' | 'vertical-lr'
export interface TextAnnotation {
  id: string
  x: number // 正規化座標 (0-1)
  y: number // 正規化座標 (0-1)
  text: string
  fontSize: number // ピクセル
  color: string
  direction: TextDirection
}

interface StudyPanelProps {
  pdfRecord: PDFFileRecord
  pdfId: string
  onBack?: () => void
}

type PDFRenderMode = 'legacy' | 'adaptive'
const PDF_RENDER_MODE_STORAGE_KEY = 'copicopi.pdfRenderMode'

const resolvePDFRenderMode = (): PDFRenderMode => {
  const requestedMode = new URLSearchParams(window.location.search).get('pdfRenderMode')
  if (requestedMode === 'legacy' || requestedMode === 'adaptive') {
    localStorage.setItem(PDF_RENDER_MODE_STORAGE_KEY, requestedMode)
    return requestedMode
  }
  return localStorage.getItem(PDF_RENDER_MODE_STORAGE_KEY) === 'legacy' ? 'legacy' : 'adaptive'
}

type PanelData =
  | { type: 'pdf' }
  | { type: 'answer'; questionImage: string; source?: 'grading' }
  | {
    type: 'grading'
    id: string
    capturedImage: string
    teacherMode: TeacherMode
    status: 'loading' | 'complete' | 'error'
    result?: GradingResponseResult
    error?: string
    modelName: string | null
    responseTime: number | null
  }

const StudyPanel = ({ pdfRecord, pdfId, onBack }: StudyPanelProps) => {
  const { t, i18n } = useTranslation()
  const { userData } = useAuth()
  // Refs
  const paneARef = useRef<PDFPaneHandle>(null)
  const paneBRef = useRef<PDFPaneHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const answerPanelRef = useRef<AnswerPanelHandle>(null)
  const gradingPanelRef = useRef<HTMLDivElement>(null)
  const isGradingCapturingRef = useRef(false)
  const gradingCaptureStartRef = useRef<{ x: number; y: number } | null>(null)
  const [gradingCaptureRect, setGradingCaptureRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [isGradingCaptureMode, setIsGradingCaptureMode] = useState(false)

  // --- Consolidated State & Logic ---

  // Status Handling
  const [statusMessage, setStatusMessage] = useState('')

  // Helper Methods (Hoisted)
  const addStatusMessage = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('ja-JP')
    const fullMessage = `[${timestamp}] ${message}`
    // console.log(fullMessage)
    setStatusMessage(message)
  }

  // Layout State
  // CopiCopi は見本（A面）と描画面（B面）を並べて使うため、左右開きを初期表示にする。
  const [isSplitView, setIsSplitView] = useState(true)
  // Emergency rollback: open once with ?pdfRenderMode=legacy. The selection is
  // persisted on the device; ?pdfRenderMode=adaptive switches it back.
  const [pdfRenderMode] = useState<PDFRenderMode>(resolvePDFRenderMode)
  const [isPanesReversed, setIsPanesReversed] = useState(false)
  const [activeTab, setActiveTab] = useState<'A' | 'B'>('A')

  // Split Ratio
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = localStorage.getItem('splitRatio')
    return saved ? parseFloat(saved) : 0.5
  })
  const [isResizing, setIsResizing] = useState(false)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const gradingSplitContainerRef = useRef<HTMLDivElement>(null)

  // Page State
  const [pageA, setPageA] = useState(pdfRecord.lastPageNumberA || 1)
  const [pageB, setPageB] = useState(pdfRecord.lastPageNumberB || 1)

  // PDF Retry
  const [retryCount, setRetryCount] = useState(0)

  // PDF Document Loading
  const { pdfDoc, numPages, isLoading, error: pdfError } = usePDFRenderer(pdfRecord, {
    retryTrigger: retryCount,
    onLoadSuccess: (pages) => {
      // PDF Loaded
      // ページ番号の整合性チェック（総ページ数を超えていたら1に戻す）
      if (pageA > pages) {
        console.warn(`⚠️ ページ番号補正: A面 ${pageA} -> 1 (総ページ数: ${pages})`)
        setPageA(1)
        updatePDFRecord(pdfRecord.id, { lastPageNumberA: 1 }).catch(() => { })
      }
      if (pageB > pages) {
        console.warn(`⚠️ ページ番号補正: B面 ${pageB} -> 1 (総ページ数: ${pages})`)
        setPageB(1)
        updatePDFRecord(pdfRecord.id, { lastPageNumberB: 1 }).catch(() => { })
      }
    },
    onLoadError: (err) => {
      console.error(err)
    }
  })

  // Grading State (Additional)
  const [gradingError, setGradingError] = useState<string | null>(null)

  // AI Model State
  const [selectedModel, setSelectedModel] = useState<string>('default')
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [defaultModelName, setDefaultModelName] = useState<string>('Gemini 2.0 Flash')
  const [teacherMode, setTeacherModeState] = useState<TeacherMode>('kind')
  const [enabledTeacherModes, setEnabledTeacherModes] = useState<TeacherMode[]>(['kind'])

  const setTeacherMode = (mode: TeacherMode) => {
    if (!enabledTeacherModes.includes(mode)) return
    setTeacherModeState(mode)
  }

  useEffect(() => {
    getAppSettings()
      .then(settings => {
        const configuredModes = userData?.isPremium ? settings.enabledTeacherModes || ['kind'] : ['kind']
        const modes = (['kind', 'balanced', 'strict'] as TeacherMode[])
          .filter(mode => mode === 'kind' || configuredModes.includes(mode))
        const defaultMode = settings.defaultTeacherMode && modes.includes(settings.defaultTeacherMode)
          ? settings.defaultTeacherMode
          : 'kind'
        setEnabledTeacherModes(modes)
        setTeacherModeState(defaultMode)
      })
      .catch(error => console.error('Failed to load teacher settings:', error))
  }, [userData?.isPremium])

  useEffect(() => {
    getAvailableModels()
      .then(response => {
        if (response.models) {
          setAvailableModels(response.models.filter(m => m.id !== 'default' && m.id !== response.default))
        }
        if (response.default) {
          setDefaultModelName(response.default)
        }
      })
      .catch(err => console.error('Failed to load models:', err))
  }, [])

  // Selection State
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null)
  const isSelectingRef = useRef(false)
  const selectionStartRef = useRef<{ x: number, y: number } | null>(null)
  // selectionPreview via hook

  // Tool State
  const [isDrawingMode, setIsDrawingMode] = useState(true)
  const [isEraserMode, setIsEraserMode] = useState(false)
  const [isTextMode, setIsTextMode] = useState(false)
  const [penColor, setPenColor] = useState('#000000')
  const [penSize, setPenSize] = useState(3)
  const [brushType, setBrushType] = useState<BrushType>('solid')
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>('pencil')
  const [watercolorOpacity, setWatercolorOpacity] = useState(0.25)
  const [eraserSize, setEraserSize] = useState(50)
  // Popups
  const [showPenPopup, setShowPenPopup] = useState(false)
  const [showEraserPopup, setShowEraserPopup] = useState(false)

  // Text State
  const [textFontSize, setTextFontSize] = useState(16)
  const [textDirection, setTextDirection] = useState<TextDirection>('horizontal')
  const [showTextPopup, setShowTextPopup] = useState(false)
  const [editingText, setEditingText] = useState<{
    pageNum: number
    x: number
    y: number
    screenX: number
    screenY: number
    existingId?: string
    initialText?: string
  } | null>(null)
  const [textAnnotations, setTextAnnotations] = useState<Map<number, TextAnnotation[]>>(new Map())

  // SNS State
  const [snsLinks, setSnsLinks] = useState<SNSLinkRecord[]>([])
  const snsTimeLimit = userData?.snsRewardMinutes || 60

  useEffect(() => {
    const loadSNSData = async () => {
      try {
        const links = await getAllSNSLinks()
        setSnsLinks(links)
      } catch (error) {
        console.error('Failed to load SNS data:', error)
      }
    }
    loadSNSData()
  }, [])

  // Drawing State
  // CopiCopi stores the user's strokes on the B-side only. A-side remains a
  // read-only reference, even when the PDF page is the same on both sides.
  const [drawingPathsB, setDrawingPathsB] = useState<Map<number, DrawingPath[]>>(new Map())
  const [drawingLayersB, setDrawingLayersB] = useState<Map<number, DrawingLayer[]>>(new Map())
  const [activeLayerIdsB, setActiveLayerIdsB] = useState<Map<number, string>>(new Map())
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)
  const EMPTY_PATHS: DrawingPath[] = useMemo(() => [], [])
  const DEFAULT_LAYERS = useMemo(() => [createDefaultLayer()], [])
  const drawingPathsA = EMPTY_PATHS
  const currentLayersB = drawingLayersB.get(pageB) ?? DEFAULT_LAYERS
  const activeLayerIdB = activeLayerIdsB.get(pageB) ?? currentLayersB[currentLayersB.length - 1].id
  const currentAllDrawingPathsB = drawingPathsB.get(pageB) ?? EMPTY_PATHS
  const currentDrawingPathsB = useMemo(() => {
    const visibleLayerIds = new Set(currentLayersB.filter(layer => layer.visible).map(layer => layer.id))
    return sortPathsByLayer(
      currentAllDrawingPathsB.filter(path => visibleLayerIds.has(path.layerId || currentLayersB[0].id)),
      currentLayersB,
    )
  }, [currentAllDrawingPathsB, currentLayersB])

  // Load Drawings Effect
  useEffect(() => {
    const loadDrawings = async () => {
      try {
        const record = await getPDFRecord(pdfId)
        if (!record?.drawings) return

        const newMap = new Map<number, DrawingPath[]>()
        const newLayersMap = new Map<number, DrawingLayer[]>()
        const newActiveLayerMap = new Map<number, string>()
        for (const [pageStr, pathsJson] of Object.entries(record.drawings)) {
          const page = parseInt(pageStr, 10)
          const { layers, paths } = normalizeLayeredDrawing(pathsJson)
          newLayersMap.set(page, layers)
          newActiveLayerMap.set(page, layers[layers.length - 1].id)
          if (paths.length > 0) {
            newMap.set(page, paths)
          }
        }

        setDrawingPathsB(newMap)
        setDrawingLayersB(newLayersMap)
        setActiveLayerIdsB(newActiveLayerMap)
      } catch (e) {
        console.error('Failed to load drawings:', e)
      }
    }
    loadDrawings()
  }, [pdfId])

  // Load Text Annotations Effect
  useEffect(() => {
    const loadTextAnnotations = async () => {
      try {
        const record = await getPDFRecord(pdfId)
        if (!record?.textAnnotations) return
        const newMap = new Map<number, TextAnnotation[]>()
        for (const [pageStr, annotationsJson] of Object.entries(record.textAnnotations)) {
          const page = parseInt(pageStr, 10)
          const annotations = JSON.parse(annotationsJson as string) as TextAnnotation[]
          if (annotations.length > 0) {
            newMap.set(page, annotations)
          }
        }
        if (newMap.size === 0) return
        setTextAnnotations(newMap)
      } catch (e) {
      }
    }
    loadTextAnnotations()
  }, [pdfId])


  // Grading Hook
  const {
    isGrading,
    setIsGrading,
    selectionPreview,
    setSelectionPreview,
  } = useGrading(
    pdfId,
    (msg) => addStatusMessage(msg),
    activeTab === 'A' ? pageA : pageB,
    pdfRecord?.fileName || 'Unknown',
    pdfRecord?.subjectId  // Pass subject ID for subject-specific grading
  )

  // Panel stack state
  const [panelStack, setPanelStack] = useState<PanelData[]>([{ type: 'pdf' }])
  const [activePanelIndex, setActivePanelIndex] = useState(0)

  // canUndo state for answer panel (managed reactively via callback)
  const [canUndoAnswer, setCanUndoAnswer] = useState(false)

  const getPanelLabel = (panel: PanelData): string => {
    switch (panel.type) {
      case 'pdf': return '練習'
      case 'answer': return panel.source === 'grading' ? '質問記入' : '解答記入'
      case 'grading': return panel.status === 'loading' ? '採点中' : '採点結果'
    }
  }

  const pushPanel = (panel: PanelData) => {
    setPanelStack(prev => [...prev.slice(0, activePanelIndex + 1), panel])
    setActivePanelIndex(prev => prev + 1)
  }

  const updateGradingPanel = (id: string, update: Partial<Extract<PanelData, { type: 'grading' }>>) => {
    setPanelStack(prev => prev.map(panel =>
      panel.type === 'grading' && panel.id === id ? { ...panel, ...update } : panel
    ))
  }

  const handleSelectionStart = (e: React.MouseEvent) => {
    // Only left click
    if (e.button !== 0) return

    // Get relative position within the container
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    isSelectingRef.current = true
    selectionStartRef.current = { x, y }
    setSelectionRect({ x, y, width: 0, height: 0 })
  }

  const handleSelectionMove = (e: React.MouseEvent) => {
    if (!isSelectingRef.current || !selectionStartRef.current || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const startX = selectionStartRef.current.x
    const startY = selectionStartRef.current.y

    setSelectionRect({
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      width: Math.abs(x - startX),
      height: Math.abs(y - startY)
    })
  }

  /* 共通: オーバーレイでピンチズームを直接処理 */
  const overlayGestureRef = useRef<{
    type: 'selection' | 'pinch'
    targetPane: 'A' | 'B'
    startZoom: number
    startPan: { x: number, y: number }
    startDist: number
    startCenter: { x: number, y: number }
  } | null>(null)

  // タッチ位置からターゲットペインを判定
  const getTargetPane = (touchX: number): 'A' | 'B' => {
    // 非スプリットビューでは現在表示中のタブが対象
    if (!isSplitView) return activeTab

    // スプリットコンテナ内でのX位置を確認
    const splitContainer = splitContainerRef.current
    if (!splitContainer) return activeTab

    const containerRect = splitContainer.getBoundingClientRect()
    const relativeX = touchX - containerRect.left
    const leftPane: 'A' | 'B' = isPanesReversed ? 'B' : 'A'
    const leftPaneRatio = isPanesReversed ? 1 - splitRatio : splitRatio
    const splitPoint = containerRect.width * leftPaneRatio

    return relativeX < splitPoint ? leftPane : (leftPane === 'A' ? 'B' : 'A')
  }

  const getTargetPaneRef = (pane: 'A' | 'B') => {
    return pane === 'A' ? paneARef : paneBRef
  }

  const handleOverlayTouchStart = (e: React.TouchEvent, onSingleTouch?: (x: number, y: number) => void) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    if (e.touches.length >= 2) {
      // 2本指: ピンチズーム開始
      e.preventDefault()
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      const center = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      }

      // タッチ中心からターゲットペインを判定
      const targetPane = getTargetPane(center.x)
      const paneRef = getTargetPaneRef(targetPane)

      // 現在のズーム/パン状態を取得
      const currentZoom = paneRef.current?.getZoom() ?? 1
      const currentPan = paneRef.current?.getPanOffset() ?? { x: 0, y: 0 }

      overlayGestureRef.current = {
        type: 'pinch',
        targetPane,
        startZoom: currentZoom,
        startPan: { ...currentPan },
        startDist: dist,
        startCenter: center
      }

      // 選択をキャンセル
      isSelectingRef.current = false
      selectionStartRef.current = null
      return
    }

    if (e.touches.length !== 1) return

    // 1本指: 選択開始 or カスタム処理
    overlayGestureRef.current = null
    if (onSingleTouch) {
      const x = e.touches[0].clientX - rect.left
      const y = e.touches[0].clientY - rect.top
      onSingleTouch(x, y)
    }
  }

  const handleOverlayTouchMove = (e: React.TouchEvent, onSingleTouchMove?: (x: number, y: number) => void) => {
    if (e.touches.length >= 2 && overlayGestureRef.current?.type === 'pinch') {
      // ピンチズーム処理
      e.preventDefault()
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)
      const center = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
      }

      const { targetPane, startZoom, startPan, startDist, startCenter } = overlayGestureRef.current
      const paneRef = getTargetPaneRef(targetPane)
      const paneRect = paneRef.current?.getContainerRect()
      if (!paneRect) return

      // 新しいズームレベルを計算
      const scale = dist / startDist
      const newZoom = Math.min(Math.max(startZoom * scale, 0.1), 5.0)

      // ピンチ中心を基準にパン調整
      const startCenterRelX = startCenter.x - paneRect.left
      const startCenterRelY = startCenter.y - paneRect.top
      const contentX = (startCenterRelX - startPan.x) / startZoom
      const contentY = (startCenterRelY - startPan.y) / startZoom
      const centerRelX = center.x - paneRect.left
      const centerRelY = center.y - paneRect.top
      const newPanX = centerRelX - (contentX * newZoom)
      const newPanY = centerRelY - (contentY * newZoom)

      // 対象のPDFPaneに適用
      paneRef.current?.setZoomValue(newZoom)
      paneRef.current?.setPanOffsetValue({ x: newPanX, y: newPanY })
      return
    }

    if (e.touches.length === 1 && onSingleTouchMove) {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.touches[0].clientX - rect.left
      const y = e.touches[0].clientY - rect.top
      onSingleTouchMove(x, y)
    }
  }

  const handleOverlayTouchEnd = (e: React.TouchEvent, onTouchEnd?: () => void) => {
    if (e.touches.length === 0) {
      overlayGestureRef.current = null
      if (onTouchEnd) onTouchEnd()
    }
  }

  /* Selection Mode Touch Handlers */
  const handleTouchSelectionStart = (e: React.TouchEvent) => {
    handleOverlayTouchStart(e, (x, y) => {
      isSelectingRef.current = true
      selectionStartRef.current = { x, y }
      setSelectionRect({ x, y, width: 0, height: 0 })
    })
  }

  const handleTouchSelectionMove = (e: React.TouchEvent) => {
    handleOverlayTouchMove(e, (x, y) => {
      if (!isSelectingRef.current || !selectionStartRef.current) return
      const startX = selectionStartRef.current.x
      const startY = selectionStartRef.current.y
      setSelectionRect({
        x: Math.min(startX, x),
        y: Math.min(startY, y),
        width: Math.abs(x - startX),
        height: Math.abs(y - startY)
      })
    })
  }

  const handleTouchSelectionEnd = async (e: React.TouchEvent) => {
    handleOverlayTouchEnd(e, async () => {
      if (!isSelectingRef.current) return
      await handleSelectionEnd()
    })
  }

  const handleSelectionEnd = async () => {
    if (!isSelectingRef.current || !selectionRect) return

    isSelectingRef.current = false

    // Check if selection is large enough
    if (selectionRect.width < 10 || selectionRect.height < 10) {
      setSelectionRect(null)
      return
    }

    // Capture Image Logic (Stitching)
    try {
      const capturedImage = await captureSelectionArea(selectionRect)
      if (capturedImage) {
        setIsSelectionMode(false)
        setSelectionRect(null)
        // A面とB面を含む範囲キャプチャー1枚を、そのまま模写評価へ送る。
        await confirmAndGrade(capturedImage)
      } else {
        addStatusMessage("❌ 画像のキャプチャに失敗しました")
        setSelectionRect(null)
      }
    } catch (error) {
      console.error("Capture error:", error)
      addStatusMessage("❌ エラーが発生しました")
      setSelectionRect(null)
    }
  }

  // 採点結果パネル用の範囲選択ハンドラ
  const handleGradingCaptureStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const rect = gradingPanelRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    isGradingCapturingRef.current = true
    gradingCaptureStartRef.current = { x, y }
    setGradingCaptureRect({ x, y, width: 0, height: 0 })
  }

  const handleGradingCaptureMove = (e: React.MouseEvent) => {
    if (!isGradingCapturingRef.current || !gradingCaptureStartRef.current || !gradingPanelRef.current) return
    const rect = gradingPanelRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const sx = gradingCaptureStartRef.current.x
    const sy = gradingCaptureStartRef.current.y
    setGradingCaptureRect({
      x: Math.min(sx, x),
      y: Math.min(sy, y),
      width: Math.abs(x - sx),
      height: Math.abs(y - sy)
    })
  }

  const handleGradingCaptureEnd = async () => {
    if (!isGradingCapturingRef.current || !gradingCaptureRect || !gradingPanelRef.current) return
    isGradingCapturingRef.current = false

    if (gradingCaptureRect.width < 10 || gradingCaptureRect.height < 10) {
      setGradingCaptureRect(null)
      return
    }

    try {
      const html2canvas = (await import('html2canvas')).default
      const panel = gradingPanelRef.current
      // スクロールオフセットを取得
      const scrollEl = panel.querySelector('.grading-result-content') as HTMLElement | null
      const scrollTop = scrollEl?.scrollTop ?? 0

      // オーバーレイ（枠線）を非表示にしてからキャプチャ
      const overlay = panel.querySelector('.grading-capture-overlay') as HTMLElement | null
      if (overlay) overlay.style.display = 'none'

      const fullCanvas = await html2canvas(panel, {
        scale: window.devicePixelRatio || 2,
        useCORS: true,
        allowTaint: true,
        scrollY: -scrollTop,
        y: scrollTop,
        height: panel.clientHeight,
      })

      if (overlay) overlay.style.display = ''

      const dpr = window.devicePixelRatio || 2
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = gradingCaptureRect.width * dpr
      cropCanvas.height = gradingCaptureRect.height * dpr
      const ctx = cropCanvas.getContext('2d')!
      ctx.drawImage(
        fullCanvas,
        gradingCaptureRect.x * dpr,
        gradingCaptureRect.y * dpr,
        cropCanvas.width,
        cropCanvas.height,
        0, 0,
        cropCanvas.width,
        cropCanvas.height
      )

      const capturedImage = cropCanvas.toDataURL('image/png')
      pushPanel({ type: 'answer', questionImage: capturedImage, source: 'grading' })
      setIsGradingCaptureMode(false)
      setGradingCaptureRect(null)
    } catch (error) {
      console.error('Grading capture error:', error)
      addStatusMessage('❌ キャプチャに失敗しました')
      setGradingCaptureRect(null)
    }
  }

  const cancelGradingCapture = () => {
    setIsGradingCaptureMode(false)
    setGradingCaptureRect(null)
    isGradingCapturingRef.current = false
  }

  const captureSelectionArea = async (rect: { x: number, y: number, width: number, height: number }) => {
    if (!containerRef.current) return null

    // Create a temporary canvas to draw the result
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = rect.width
    tempCanvas.height = rect.height
    const ctx = tempCanvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height)

    // ペインからキャプチャするヘルパー
    const captureFromPane = (paneRef: React.RefObject<PDFPaneHandle>, paneClassName: string) => {
      const paneEl = containerRef.current?.querySelector(`.${paneClassName}`)
      const compositeCanvas = paneRef.current?.getCanvas()
      const visibleCanvas = paneEl?.querySelector('.pdf-canvas') as HTMLCanvasElement | null

      if (!paneEl || !compositeCanvas || !visibleCanvas) return

      const paneRect = paneEl.getBoundingClientRect()
      const containerRect = containerRef.current!.getBoundingClientRect()
      const canvasRect = visibleCanvas.getBoundingClientRect()

      const selectionScreenX = containerRect.left + rect.x
      const selectionScreenY = containerRect.top + rect.y
      const selectionScreenW = rect.width
      const selectionScreenH = rect.height

      // PDFキャンバスはペイン外にも実寸で存在し、CSSのoverflowで見切れている。
      // 選択範囲とキャンバスだけで交差を取ると、その非表示部分が隣の面へ混入するため、
      // 必ずペインの表示境界でもクリップする。
      const intersectX = Math.max(selectionScreenX, canvasRect.left, paneRect.left)
      const intersectY = Math.max(selectionScreenY, canvasRect.top, paneRect.top)
      const intersectRight = Math.min(selectionScreenX + selectionScreenW, canvasRect.right, paneRect.right)
      const intersectBottom = Math.min(selectionScreenY + selectionScreenH, canvasRect.bottom, paneRect.bottom)
      const intersectW = intersectRight - intersectX
      const intersectH = intersectBottom - intersectY

      if (intersectW <= 0 || intersectH <= 0) return

      const scaleX = compositeCanvas.width / canvasRect.width
      const scaleY = compositeCanvas.height / canvasRect.height

      const sx = (intersectX - canvasRect.left) * scaleX
      const sy = (intersectY - canvasRect.top) * scaleY
      const sw = intersectW * scaleX
      const sh = intersectH * scaleY

      const dx = intersectX - selectionScreenX
      const dy = intersectY - selectionScreenY

      ctx.drawImage(compositeCanvas, sx, sy, sw, sh, dx, dy, intersectW, intersectH)
    }

    if (activeTab === 'A' || isSplitView) {
      captureFromPane(paneARef, 'pane-a')
    }

    if (activeTab === 'B' || isSplitView) {
      captureFromPane(paneBRef, 'pane-b')
    }

    return tempCanvas.toDataURL('image/png')
  }



  // パス追加ハンドラ
  const handlePathAddB = (page: number, newPath: DrawingPath) => {
    const storedLayers = drawingLayersB.get(page) ?? DEFAULT_LAYERS
    const activeLayerId = activeLayerIdsB.get(page) ?? storedLayers[storedLayers.length - 1].id
    const layers = storedLayers.map(layer => layer.id === activeLayerId ? { ...layer, visible: true } : layer)
    if (layers.some((layer, index) => layer.visible !== storedLayers[index].visible)) {
      setDrawingLayersB(previous => new Map(previous).set(page, layers))
    }
    setDrawingPathsB(prev => {
      const newMap = new Map(prev)
      const currentPaths = newMap.get(page) || []
      const newPaths = sortPathsByLayer([...currentPaths, { ...newPath, layerId: activeLayerId }], layers)
      newMap.set(page, newPaths)

      // Save to DB
      saveDrawing(pdfId, page, serializeLayeredDrawing(layers, newPaths))

      return newMap
    })
  }

  // Ctrl Key Tracking
  const [isCtrlPressed, setIsCtrlPressed] = useState(false)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setIsCtrlPressed(true)
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setIsCtrlPressed(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // パス変更ハンドラ（Undo/Redo/Eraserなど）
  const handlePathsChangeB = (page: number, newPaths: DrawingPath[]) => {
    const layers = drawingLayersB.get(page) ?? DEFAULT_LAYERS
    const visibleLayerIds = new Set(layers.filter(layer => layer.visible).map(layer => layer.id))
    setDrawingPathsB(prev => {
      const newMap = new Map(prev)
      const currentPaths = newMap.get(page) || []
      const hiddenPaths = currentPaths.filter(path => !visibleLayerIds.has(path.layerId || layers[0].id))
      const mergedPaths = sortPathsByLayer([...hiddenPaths, ...newPaths], layers)
      if (mergedPaths.length === 0) {
        newMap.delete(page)
      } else {
        newMap.set(page, mergedPaths)
      }
      saveDrawing(pdfId, page, serializeLayeredDrawing(layers, mergedPaths))
      return newMap
    })
  }

  const updateCurrentLayerState = (layers: DrawingLayer[], paths: DrawingPath[] = currentAllDrawingPathsB) => {
    const sortedPaths = sortPathsByLayer(paths, layers)
    setDrawingLayersB(previous => new Map(previous).set(pageB, layers))
    setDrawingPathsB(previous => {
      const next = new Map(previous)
      if (sortedPaths.length > 0) next.set(pageB, sortedPaths)
      else next.delete(pageB)
      return next
    })
    saveDrawing(pdfId, pageB, serializeLayeredDrawing(layers, sortedPaths))
  }

  const addDrawingLayer = () => {
    if (currentLayersB.length >= MAX_DRAWING_LAYERS) {
      addStatusMessage(`レイヤーは${MAX_DRAWING_LAYERS}枚までです`)
      return
    }
    const layer: DrawingLayer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `レイヤー${currentLayersB.length + 1}`,
      visible: true,
    }
    const nextLayers = [...currentLayersB, layer]
    updateCurrentLayerState(nextLayers)
    setActiveLayerIdsB(previous => new Map(previous).set(pageB, layer.id))
    addStatusMessage(`${layer.name}を追加しました`)
  }

  const selectDrawingLayer = (layerId: string) => {
    setActiveLayerIdsB(previous => new Map(previous).set(pageB, layerId))
  }

  const renameDrawingLayer = (layerId: string, name: string, persist = false) => {
    const nextLayers = currentLayersB.map(layer => layer.id === layerId ? { ...layer, name } : layer)
    if (persist) updateCurrentLayerState(nextLayers)
    else setDrawingLayersB(previous => new Map(previous).set(pageB, nextLayers))
  }

  const toggleDrawingLayerVisibility = (layerId: string) => {
    updateCurrentLayerState(currentLayersB.map(layer => (
      layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
    )))
  }

  const moveDrawingLayer = (layerId: string, targetLayerId: string) => {
    const fromIndex = currentLayersB.findIndex(layer => layer.id === layerId)
    const targetIndex = currentLayersB.findIndex(layer => layer.id === targetLayerId)
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return
    const nextLayers = [...currentLayersB]
    const [movedLayer] = nextLayers.splice(fromIndex, 1)
    nextLayers.splice(targetIndex, 0, movedLayer)
    updateCurrentLayerState(nextLayers)
  }

  const nudgeDrawingLayer = (layerId: string, direction: 'up' | 'down') => {
    const index = currentLayersB.findIndex(layer => layer.id === layerId)
    const targetIndex = direction === 'up' ? index + 1 : index - 1
    if (index < 0 || targetIndex < 0 || targetIndex >= currentLayersB.length) return
    moveDrawingLayer(layerId, currentLayersB[targetIndex].id)
  }

  const deleteDrawingLayer = (layerId: string) => {
    if (currentLayersB.length <= 1) {
      addStatusMessage('最後のレイヤーは削除できません')
      return
    }
    const layer = currentLayersB.find(item => item.id === layerId)
    const hasPaths = currentAllDrawingPathsB.some(path => path.layerId === layerId)
    if (hasPaths && !window.confirm(`${layer?.name || 'レイヤー'}と、その中の線を削除しますか？`)) return

    const nextLayers = currentLayersB.filter(item => item.id !== layerId)
    const nextPaths = currentAllDrawingPathsB.filter(path => path.layerId !== layerId)
    updateCurrentLayerState(nextLayers, nextPaths)
    if (activeLayerIdB === layerId) {
      setActiveLayerIdsB(previous => new Map(previous).set(pageB, nextLayers[nextLayers.length - 1].id))
    }
  }

  // 採点確定ハンドラ
  const confirmAndGrade = async (compositeImage: string, selectedTeacherMode: TeacherMode = teacherMode) => {
    setIsGrading(true)
    setGradingError(null)
    let gradingPanelId: string | null = null

    try {
      const croppedImageData = compositeImage

      // Validate image size (minimum 50x50)
      const img = new Image()
      img.src = croppedImageData
      await new Promise((resolve, reject) => {
        img.onload = () => {
          if (img.width < 50 || img.height < 50) {
            setGradingError('選択範囲が小さすぎます。もう少し大きく選択してください。')
            setIsGrading(false)
            reject(new Error('Image too small'))
          } else {
            resolve(undefined)
          }
        }
        img.onerror = () => {
          setGradingError('画像の読み込みに失敗しました。')
          setIsGrading(false)
          reject(new Error('Image load error'))
        }
      })

      gradingPanelId = `grading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      pushPanel({
        type: 'grading',
        id: gradingPanelId,
        capturedImage: croppedImageData,
        teacherMode: selectedTeacherMode,
        status: 'loading',
        modelName: null,
        responseTime: null
      })

      // APIに送信（簡素化：切り抜き画像のみ）
      addStatusMessage('🎯 先生が作品を見ています...')
      const startTime = Date.now()
      const { gradeWork } = await import('@home-teacher/common/services/api')
      const response = await gradeWork(
        croppedImageData,
        selectedModel !== 'default' ? selectedModel : undefined,
        i18n.language,
        undefined,
        selectedTeacherMode,
        isPanesReversed
      )
      const endTime = Date.now()
      const clientResponseTimeSeconds = parseFloat(((endTime - startTime) / 1000).toFixed(1))

      if (!response.success) {
        setGradingError(response.error || "採点に失敗しました")
        throw new Error(response.error || "採点に失敗しました")
      }

      setGradingError(null)

      // Flatten problems if they have nested numeric keys (fallback for non-normalized server response)
      let problems = response.result.problems
      if (problems.length === 1 && Object.keys(problems[0]).some(k => /^\d+$/.test(k))) {
        const nested = problems[0]
        const numericKeys = Object.keys(nested).filter(k => /^\d+$/.test(k))
        problems = numericKeys.map(k => nested[k])
      }

      updateGradingPanel(gradingPanelId, {
        status: 'complete',
        result: { ...response.result, problems },
        modelName: response.modelName ?? null,
        responseTime: response.responseTime ?? clientResponseTimeSeconds
      })
      addStatusMessage('✅ 採点が終わりました')

      // 採点履歴を保存
      if (response.result.problems?.length) {
        for (const problem of response.result.problems) {
          const scoreFromConfidence = typeof problem.confidence === 'number'
            ? problem.confidence
            : Number(problem.confidence)
          const scoreFromTitle = Number(problem.problemNumber?.match(/([1-5])\s*\/\s*5/)?.[1])
          const score = Number.isFinite(scoreFromConfidence) && scoreFromConfidence >= 1
            ? scoreFromConfidence
            : (Number.isFinite(scoreFromTitle) ? scoreFromTitle : undefined)
          const explanationLines = problem.explanation?.split('\n').map(line => line.trim()).filter(Boolean) || []
          const nextPointLine = explanationLines.find(line => line.startsWith('次のポイント：'))
          const historyRecord = {
            id: generateGradingHistoryId(),
            pdfId,
            pdfFileName: pdfRecord.fileName,
            pageNumber: pageA,
            problemNumber: problem.problemNumber,
            studentAnswer: problem.studentAnswer,
            isCorrect: problem.isCorrect || false,
            correctAnswer: problem.correctAnswer || '',
            feedback: problem.feedback || '',
            explanation: problem.explanation || '',
            timestamp: Date.now(),
            imageData: croppedImageData,
            teacherMode: selectedTeacherMode,
            score,
            overallComment: response.result.overallComment || '',
            nextPoint: nextPointLine?.replace(/^次のポイント：/, '') || '',
            practiceAdvice: explanationLines.filter(line => line !== nextPointLine).join(' '),
            matchingMetadata: problem.matchingMetadata
          }
          await saveGradingHistory(historyRecord)
        }
      }

    } catch (e) {
      console.error(e)
      const message = e instanceof Error ? e.message : String(e)
      setGradingError(message)
      if (gradingPanelId) {
        updateGradingPanel(gradingPanelId, { status: 'error', error: message })
      }
    } finally {
      setIsGrading(false)
    }
  }

  // Grade handler called from toolbar
  const handleGradeFromToolbar = async () => {
    const compositeImage = await answerPanelRef.current?.getCompositeImage()
    if (compositeImage) await confirmAndGrade(compositeImage, teacherMode)
  }

  // プレビューのキャンセル
  const cancelPreview = () => {
    setSelectionPreview(null)
  }

  // 描画モードの切り替え
  const toggleDrawingMode = () => {
    if (!isDrawingMode) {
      setIsDrawingMode(true)
      setIsEraserMode(false)
      setIsTextMode(false)
      setIsSelectionMode(false)
      setSelectionRect(null)
      addStatusMessage('✏️ ペンモード')
    }
  }

  // 消しゴムモードの切り替え
  const toggleEraserMode = () => {
    if (!isEraserMode) {
      setIsEraserMode(true)
      setIsDrawingMode(false)
      setIsTextMode(false)
      setIsSelectionMode(false)
      setSelectionRect(null)
      addStatusMessage('🧹 消しゴムモード')
    }
  }

  // クリア機能（現在のレイヤーのみ）
  const clearDrawing = () => {
    const nextPaths = currentAllDrawingPathsB.filter(path => path.layerId !== activeLayerIdB)
    updateCurrentLayerState(currentLayersB, nextPaths)
    addStatusMessage('選択中のレイヤーをクリアしました')
  }

  // すべてのページの描画をクリア
  const clearAllDrawings = async () => {
    if (!confirm('すべてのページのペン跡を削除しますか？この操作は取り消せません。')) {
      return
    }

    setDrawingPathsB(new Map())
    setDrawingLayersB(new Map())
    setActiveLayerIdsB(new Map())
    // IndexedDBからも削除
    try {
      const record = await getPDFRecord(pdfId)
      if (record) {
        record.drawings = {}
        await savePDFRecord(record)
        addStatusMessage('🗑️ すべてのペン跡を削除しました')
      }
    } catch (error) {
      console.error('ペン跡の削除に失敗:', error)
      addStatusMessage('❌ ペン跡の削除に失敗しました')
    }
  }

  // 現在画面に見えているA/Bを、その位置・倍率のまま採点する。
  const startGrading = async () => {
    const currentPanel = panelStack[activePanelIndex]
    if (currentPanel?.type !== 'pdf' || !containerRef.current) return
    if (!isSplitView) {
      addStatusMessage('A/B表示で採点できます')
      return
    }

    const rect = containerRef.current.getBoundingClientRect()
    const capturedImage = await captureSelectionArea({
      x: 0,
      y: 0,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
    if (!capturedImage) {
      setGradingError('現在のA/B画面をキャプチャーできませんでした。')
      return
    }
    await confirmAndGrade(capturedImage, teacherMode)
  }

  // テキストモードのトグル
  const toggleTextMode = () => {
    if (!isTextMode) {
      setIsTextMode(true)
      setIsDrawingMode(false)
      setIsEraserMode(false)
      setIsSelectionMode(false)
    }
  }

  // テキスト追加のハンドラ（PDFPaneからのクリックイベント用）
  const handleTextClick = (pageNum: number, normalizedX: number, normalizedY: number, screenX: number, screenY: number) => {
    if (!isTextMode) return
    setEditingText({
      pageNum,
      x: normalizedX,
      y: normalizedY,
      screenX,
      screenY
    })
  }

  // テキスト確定（編集・新規追加・削除を統合）
  const confirmText = (text: string) => {
    if (!editingText) return

    const trimmedText = text.trim()
    const finish = () => setEditingText(null)

    // 1. 既存テキストの削除（空文字になった場合）
    if (editingText.existingId && trimmedText === '') {
      deleteTextAnnotation(editingText.pageNum, editingText.existingId)
      finish()
      return
    }

    // 2. 既存テキストの更新
    if (editingText.existingId) {
      setTextAnnotations(prev => {
        const newMap = new Map(prev)
        const current = newMap.get(editingText.pageNum) || []
        const updated = current.map(a =>
          a.id === editingText.existingId
            ? { ...a, text: trimmedText }
            : a
        )
        newMap.set(editingText.pageNum, updated)

        // Save to IndexedDB
        saveTextAnnotation(pdfId, editingText.pageNum, JSON.stringify(updated))

        return newMap
      })
      addStatusMessage('📝 テキストを更新しました')
      finish()
      return
    }

    // 3. 新規テキストが空の場合（キャンセル扱い）
    if (trimmedText === '') {
      finish()
      return
    }

    // 4. 新規テキストの追加
    const newAnnotation: TextAnnotation = {
      id: `text - ${Date.now()} `,
      x: editingText.x,
      y: editingText.y,
      text: trimmedText,
      fontSize: textFontSize,
      color: penColor,
      direction: textDirection
    }

    setTextAnnotations(prev => {
      const newMap = new Map(prev)
      const current = newMap.get(editingText.pageNum) || []
      const updatedAnnotations = [...current, newAnnotation]
      newMap.set(editingText.pageNum, updatedAnnotations)

      // Save to IndexedDB
      saveTextAnnotation(pdfId, editingText.pageNum, JSON.stringify(updatedAnnotations))

      return newMap
    })
    addStatusMessage('📝 テキストを追加しました')
    finish()
  }

  // テキスト削除
  const deleteTextAnnotation = (pageNum: number, annotationId: string) => {
    setTextAnnotations(prev => {
      const newMap = new Map(prev)
      const current = newMap.get(pageNum) || []
      const filtered = current.filter(a => a.id !== annotationId)
      if (filtered.length === 0) {
        newMap.delete(pageNum)
      } else {
        newMap.set(pageNum, filtered)
      }

      // Save to IndexedDB (empty array to clear or filtered list)
      saveTextAnnotation(pdfId, pageNum, JSON.stringify(filtered))

      return newMap
    })
    addStatusMessage('🗑️ テキストを削除しました')
  }

  // ステータスメッセージ


  // 分割表示の切り替え / A面B面の物理位置の入れ替え
  const toggleSplitView = () => {
    if (isSplitView) {
      // 既にスプリット表示中なら左右の位置だけを入れ替える。
      // A/Bのページ番号やB面の描画データは変更しない。
      setIsPanesReversed(previous => !previous)
    } else {
      // スプリット表示をオンにする
      setIsSplitView(true)
    }
  }

  // ページ変更ハンドラ
  const handlePageAChange = (p: number) => {
    if (p < 1 || p > numPages) return
    setPageA(p)
  }
  const handlePageBChange = (p: number) => {
    if (p < 1 || p > numPages) return
    setPageB(p)
  }

  // ページ番号の永続化（デバウンス付き）
  useEffect(() => {
    const timer = setTimeout(() => {
      const updates: Partial<{ lastPageNumberA: number; lastPageNumberB: number }> = {}

      if (pageA > 0 && pageA !== pdfRecord.lastPageNumberA) {
        updates.lastPageNumberA = pageA
      }
      if (pageB > 0 && pageB !== pdfRecord.lastPageNumberB) {
        updates.lastPageNumberB = pageB
      }

      if (Object.keys(updates).length > 0) {
        updatePDFRecord(pdfRecord.id, updates).catch(err => {
        })
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [pageA, pageB, pdfRecord.id, pdfRecord.lastPageNumberA, pdfRecord.lastPageNumberB])

  // 矩形選択モードをキャンセル
  const handleCancelSelection = () => {
    setSelectionRect(null)
    setSelectionPreview(null)
    addStatusMessage('選択をクリアしました。再度範囲を選択してください')
  }

  // リサイズハンドラ
  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent) => {
    setIsResizing(true)
  }

  useEffect(() => {
    if (!isResizing) return

    const getResizeContainer = () => {
      const panel = panelStack[activePanelIndex]
      return panel?.type === 'grading' ? gradingSplitContainerRef.current : splitContainerRef.current
    }

    const handleMove = (clientX: number) => {
      const container = getResizeContainer()
      if (!container) return
      const rect = container.getBoundingClientRect()
      const newRatio = (clientX - rect.left) / rect.width
      const clampedRatio = Math.max(0.2, Math.min(0.8, newRatio))
      setSplitRatio(clampedRatio)
    }

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault()
      handleMove(e.clientX)
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault() // Prevent scrolling
      handleMove(e.touches[0].clientX)
    }

    const handleEnd = (clientX: number) => {
      const container = getResizeContainer()
      if (!container) return
      const rect = container.getBoundingClientRect()
      const finalRatio = (clientX - rect.left) / rect.width
      const clampedRatio = Math.max(0.2, Math.min(0.8, finalRatio))
      localStorage.setItem('splitRatio', clampedRatio.toString())
      setIsResizing(false)
    }

    const handleMouseUp = (e: MouseEvent) => handleEnd(e.clientX)
    const handleTouchEnd = (e: TouchEvent) => handleEnd(e.changedTouches[0].clientX)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }
  }, [isResizing, activePanelIndex, panelStack])

  // Ctrl+Z Undo - 選択中レイヤーの最後の描画を削除
  const handleUndo = () => {
    const activePage = pageB
    const layers = drawingLayersB.get(activePage) ?? DEFAULT_LAYERS
    const activeLayerId = activeLayerIdsB.get(activePage) ?? layers[layers.length - 1].id
    setDrawingPathsB(prev => {
      const newMap = new Map(prev)
      const currentPaths = newMap.get(activePage) || []
      let lastPathIndex = -1
      for (let index = currentPaths.length - 1; index >= 0; index -= 1) {
        if (currentPaths[index].layerId === activeLayerId) {
          lastPathIndex = index
          break
        }
      }
      if (lastPathIndex >= 0) {
        const newPaths = currentPaths.filter((_, index) => index !== lastPathIndex)
        if (newPaths.length > 0) newMap.set(activePage, newPaths)
        else newMap.delete(activePage)
        // Save to DB
        saveDrawing(pdfId, activePage, serializeLayeredDrawing(layers, newPaths))
      }
      return newMap
    })
  }

  const activePanel = panelStack[activePanelIndex]
  const isOnAnswerPanel = activePanel?.type === 'answer'

  // PDF content panel JSX
  const pdfContent = (
    <div
      className="canvas-container"
      ref={containerRef}
      style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {/* Error / Loading Overlay */}
      {(isLoading || pdfError) && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          zIndex: 20000
        }}>
          {isLoading ? (
            <div style={{ textAlign: 'center' }}>
              <div className="spinner" style={{
                width: '40px',
                height: '40px',
                border: '4px solid #f3f3f3',
                borderTop: '4px solid #3498db',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: '16px',
                margin: '0 auto'
              }} />
              <p>PDFを読み込み中...</p>
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <p style={{ color: '#e74c3c', marginBottom: '16px', fontWeight: 'bold' }}>PDFの読み込みに失敗しました</p>
              <p style={{ fontSize: '12px', color: '#666', marginBottom: '20px', maxWidth: '300px', wordBreak: 'break-all' }}>{pdfError}</p>
              <button
                onClick={() => setRetryCount(c => c + 1)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#3498db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                }}
              >
                再読み込み
              </button>
            </div>
          )}
        </div>
      )}
      {/* Main Content Area: PDF Panes */}
      <div
        ref={splitContainerRef}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: '#f0f0f0',
          height: '100%'
        }}
      >
        {/* Global Selection Overlay */}
        {isSelectionMode && (
          <div
            className="selection-overlay"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 9999,
              cursor: isCtrlPressed ? 'grab' : 'crosshair',
              touchAction: 'none',
              pointerEvents: isCtrlPressed ? 'none' : 'auto'
            }}
            onMouseDown={handleSelectionStart}
            onMouseMove={handleSelectionMove}
            onMouseUp={handleSelectionEnd}
            onTouchStart={handleTouchSelectionStart}
            onTouchMove={handleTouchSelectionMove}
            onTouchEnd={handleTouchSelectionEnd}
          >
            {selectionRect && (
              <div style={{
                position: 'absolute',
                left: selectionRect.x,
                top: selectionRect.y,
                width: selectionRect.width,
                height: selectionRect.height,
                backgroundColor: 'rgba(52, 152, 219, 0.2)',
                border: '2px solid #3498db',
                pointerEvents: 'none'
              }} />
            )}
          </div>
        )}

        {/* ペインA (問題) */}
        {(isSplitView || activeTab === 'A') && (
          <PDFPane
            className="pane-a"
            ref={paneARef}
            style={{
              flex: isSplitView ? `0 0 ${Math.round(splitRatio * 100)}%` : '1 1 auto',
              order: isSplitView && isPanesReversed ? 3 : 1,
              height: '100%',
              overflow: 'hidden'
            }}
            pdfRecord={pdfRecord}
            pdfDoc={pdfDoc}
            pageNum={pageA}
            tool="none"
            color={penColor}
            size={penSize}
            opacity={brushType === 'watercolor' ? watercolorOpacity : 1}
            strokeStyle={strokeStyle}
            eraserSize={eraserSize}
            drawingPaths={drawingPathsA}
            isCtrlPressed={isCtrlPressed}
            splitMode={isSplitView}
            renderMode={pdfRenderMode}
            onPageChange={handlePageAChange}
            onPathAdd={() => {}}
            onPathsChange={() => {}}
            onUndo={() => {}}
          />
        )}

        {/* リサイズハンドル */}
        {isSplitView && (
          <div
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            style={{
              width: '6px',
              height: '100%',
              backgroundColor: isResizing ? '#3498db' : '#ccc',
              cursor: 'col-resize',
              flexShrink: 0,
              order: 2,
              transition: 'background-color 0.2s',
              zIndex: 10000,
              position: 'relative'
            }}
          />
        )}

        {/* ペインB (解答/解説) */}
        {(isSplitView || activeTab === 'B') && (
          <PDFPane
            className="pane-b"
            ref={paneBRef}
            style={{
              flex: isSplitView ? `0 0 ${Math.round((1 - splitRatio) * 100)}%` : '1 1 auto',
              order: isSplitView && isPanesReversed ? 1 : 3,
              height: '100%',
              overflow: 'hidden'
            }}
            pdfRecord={pdfRecord}
            pdfDoc={pdfDoc}
            pageNum={pageB}
            hidePdfBackground
            tool={isEraserMode ? 'eraser' : (isDrawingMode ? 'pen' : 'none')}
            color={penColor}
            size={penSize}
            opacity={brushType === 'watercolor' ? watercolorOpacity : 1}
            strokeStyle={strokeStyle}
            eraserSize={eraserSize}
            scratchEraseEnabled={false}
            editableLayerId={activeLayerIdB}
            drawingPaths={currentDrawingPathsB}
            isCtrlPressed={isCtrlPressed}
            splitMode={isSplitView}
            renderMode={pdfRenderMode}
            onPageChange={handlePageBChange}
            onPathAdd={(path) => handlePathAddB(pageB, path)}
            onPathsChange={(paths) => handlePathsChangeB(pageB, paths)}
            onUndo={handleUndo}
          />
        )}

        {/* テキストモード用オーバーレイ */}
        {isTextMode && !editingText && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              zIndex: 100,
              cursor: 'text',
              touchAction: 'none',
              pointerEvents: isCtrlPressed ? 'none' : 'auto'
            }}
            onClick={(e) => {
              const rect = containerRef.current?.getBoundingClientRect()
              if (!rect) return

              const currentPage = activeTab === 'A' ? pageA : pageB

              const screenX = e.clientX - rect.left
              const screenY = e.clientY - rect.top
              const normalizedX = screenX / rect.width
              const normalizedY = screenY / rect.height

              handleTextClick(currentPage, normalizedX, normalizedY, e.clientX, e.clientY)
            }}
            onTouchStart={(e) => {
              handleOverlayTouchStart(e)
            }}
            onTouchMove={(e) => {
              handleOverlayTouchMove(e)
            }}
            onTouchEnd={(e) => {
              handleOverlayTouchEnd(e)
            }}
          />
        )}

        {/* テキストアノテーション表示 */}
        {(textAnnotations.get(activeTab === 'A' ? pageA : pageB) || []).map((annotation) => {
          const currentPage = activeTab === 'A' ? pageA : pageB
          const isClickable = isEraserMode || isTextMode
          const isBeingEdited = editingText?.existingId === annotation.id

          if (isBeingEdited) return null

          return (
            <div
              key={annotation.id}
              style={{
                position: 'absolute',
                left: `${annotation.x * 100}%`,
                top: `${annotation.y * 100}%`,
                fontSize: `${annotation.fontSize}px`,
                color: annotation.color,
                writingMode: annotation.direction === 'horizontal' ? 'horizontal-tb' :
                  annotation.direction === 'vertical-rl' ? 'vertical-rl' : 'vertical-lr',
                whiteSpace: 'pre-wrap',
                pointerEvents: isClickable ? 'auto' : 'none',
                zIndex: isClickable ? 200 : 50,
                cursor: isClickable ? 'pointer' : 'default',
                textShadow: '1px 1px 2px rgba(255,255,255,0.8), -1px -1px 2px rgba(255,255,255,0.8)',
                padding: isClickable ? '2px 4px' : '0',
                borderRadius: '4px',
                backgroundColor: isClickable ? 'rgba(200, 220, 255, 0.3)' : 'transparent',
                border: isClickable ? '1px dashed #3498db' : 'none'
              }}
              onClick={(e) => {
                if (!isClickable) return
                e.stopPropagation()
                const rect = containerRef.current?.getBoundingClientRect()
                if (!rect) return
                setEditingText({
                  pageNum: currentPage,
                  x: annotation.x,
                  y: annotation.y,
                  screenX: rect.left + annotation.x * rect.width,
                  screenY: rect.top + annotation.y * rect.height,
                  existingId: annotation.id,
                  initialText: annotation.text
                })
              }}
              title={isClickable ? 'クリックで編集（テキストを消して確定で削除）' : ''}
            >
              {annotation.text}
            </div>
          )
        })}
      </div>

      {isDrawingMode && !isSelectionMode && (
        <aside className="brush-control-rail" aria-label="ペンの太さと濃さ">
          <label className="brush-vertical-control" title={`太さ ${penSize}px`}>
            <span className="brush-control-preview brush-size-preview" style={{ width: `${Math.min(18, 5 + penSize * 0.13)}px`, height: `${Math.min(18, 5 + penSize * 0.13)}px` }} />
            <input
              type="range"
              min="1"
              max="100"
              value={penSize}
              aria-label="ペンの太さ"
              aria-valuetext={`${penSize}px`}
              onChange={(event) => setPenSize(Number(event.target.value))}
            />
            <output>{penSize}</output>
          </label>
          <label className="brush-vertical-control" title={`濃さ ${brushType === 'solid' ? 100 : Math.round(watercolorOpacity * 100)}%`}>
            <FiDroplet className="brush-opacity-icon" aria-hidden="true" />
            <input
              type="range"
              min="10"
              max="100"
              value={brushType === 'solid' ? 100 : Math.round(watercolorOpacity * 100)}
              aria-label="ペンの濃さ"
              aria-valuetext={`${brushType === 'solid' ? 100 : Math.round(watercolorOpacity * 100)}%`}
              onChange={(event) => {
                const opacity = Number(event.target.value) / 100
                if (opacity >= 1) {
                  setBrushType('solid')
                } else {
                  setWatercolorOpacity(opacity)
                  setBrushType('watercolor')
                }
              }}
            />
            <output>{brushType === 'solid' ? 100 : Math.round(watercolorOpacity * 100)}</output>
          </label>
        </aside>
      )}

      {showLayerPanel && (isSplitView || activeTab === 'B') && (
        <aside className={`drawing-layer-panel ${isPanesReversed ? 'on-left' : 'on-right'}`} aria-label="レイヤー">
          <header className="drawing-layer-header">
            <div>
              <strong>レイヤー</strong>
              <span>{currentLayersB.length}/{MAX_DRAWING_LAYERS}</span>
            </div>
            <div className="drawing-layer-header-actions">
              <button type="button" onClick={addDrawingLayer} disabled={currentLayersB.length >= MAX_DRAWING_LAYERS} title="レイヤーを追加" aria-label="レイヤーを追加"><FiPlus /></button>
              <button type="button" onClick={() => setShowLayerPanel(false)} title="閉じる" aria-label="レイヤーを閉じる"><FiX /></button>
            </div>
          </header>

          <div className="drawing-layer-list">
            {[...currentLayersB].reverse().map(layer => {
              const originalIndex = currentLayersB.findIndex(item => item.id === layer.id)
              const layerPaths = currentAllDrawingPathsB.filter(path => path.layerId === layer.id)
              const sourceCanvas = paneBRef.current?.getPdfCanvas()
              const sourceCanvasWidth = sourceCanvas?.clientWidth || sourceCanvas?.width
              const sourceCanvasHeight = sourceCanvas?.clientHeight || sourceCanvas?.height
              return (
                <div
                  key={layer.id}
                  className={`drawing-layer-row ${activeLayerIdB === layer.id ? 'active' : ''} ${layer.visible ? '' : 'hidden'}`}
                  draggable
                  onDragStart={() => setDraggedLayerId(layer.id)}
                  onDragEnd={() => setDraggedLayerId(null)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={() => {
                    if (draggedLayerId) moveDrawingLayer(draggedLayerId, layer.id)
                    setDraggedLayerId(null)
                  }}
                  onClick={() => selectDrawingLayer(layer.id)}
                >
                  <button
                    type="button"
                    className="drawing-layer-visibility"
                    onClick={event => {
                      event.stopPropagation()
                      toggleDrawingLayerVisibility(layer.id)
                    }}
                    title={layer.visible ? '非表示にする' : '表示する'}
                    aria-label={layer.visible ? `${layer.name}を非表示にする` : `${layer.name}を表示する`}
                  >
                    {layer.visible ? <FiEye /> : <FiEyeOff />}
                  </button>
                  <LayerThumbnail
                    paths={layerPaths}
                    sourceWidth={sourceCanvasWidth}
                    sourceAspectRatio={sourceCanvasWidth && sourceCanvasHeight ? sourceCanvasWidth / sourceCanvasHeight : undefined}
                  />
                  <div className="drawing-layer-copy">
                    <input
                      value={layer.name}
                      maxLength={24}
                      aria-label="レイヤー名"
                      onClick={event => event.stopPropagation()}
                      onFocus={() => selectDrawingLayer(layer.id)}
                      onChange={event => renameDrawingLayer(layer.id, event.target.value)}
                      onBlur={event => {
                        renameDrawingLayer(layer.id, event.target.value.trim() || `レイヤー${originalIndex + 1}`, true)
                      }}
                    />
                    <small>{layerPaths.length > 0 ? `${layerPaths.length}本` : '空'}</small>
                  </div>
                  <div className="drawing-layer-order-actions">
                    <button type="button" disabled={originalIndex === currentLayersB.length - 1} onClick={event => { event.stopPropagation(); nudgeDrawingLayer(layer.id, 'up') }} title="前面へ"><FiChevronUp /></button>
                    <button type="button" disabled={originalIndex === 0} onClick={event => { event.stopPropagation(); nudgeDrawingLayer(layer.id, 'down') }} title="背面へ"><FiChevronDown /></button>
                    <button type="button" disabled={currentLayersB.length <= 1} onClick={event => { event.stopPropagation(); deleteDrawingLayer(layer.id) }} title="削除"><FiTrash2 /></button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="drawing-layer-hint">上下ボタンまたはドラッグで重なり順を変更</p>
        </aside>
      )}
    </div>
  )

  return (
    <div className="pdf-viewer-container">
      <div className="pdf-viewer">
        <StudyToolbar
          onBack={onBack}
          breadcrumbs={panelStack.map((panel, i) => ({
            label: getPanelLabel(panel),
            onClick: () => setActivePanelIndex(i),
            isCurrent: i === activePanelIndex
          }))}
          isSplitView={isSplitView}
          toggleSplitView={toggleSplitView}
          activeTab={activeTab}
          toggleActiveTab={() => {
            if (isSplitView) {
              setIsSplitView(false)
            } else {
              setActiveTab(prev => prev === 'A' ? 'B' : 'A')
            }
          }}
          isGrading={isGrading}
          startGrading={startGrading}
          showTeacherGrade={activePanel?.type === 'pdf'}
          teacherMode={teacherMode}
          setTeacherMode={setTeacherMode}
          enabledTeacherModes={enabledTeacherModes}
          isTextMode={isTextMode}
          toggleTextMode={toggleTextMode}
          textFontSize={textFontSize}
          setTextFontSize={setTextFontSize}
          textDirection={textDirection}
          setTextDirection={setTextDirection}
          isDrawingMode={isDrawingMode}
          toggleDrawingMode={toggleDrawingMode}
          penColor={penColor}
          setPenColor={setPenColor}
          penSize={penSize}
          setPenSize={setPenSize}
          brushType={brushType}
          setBrushType={setBrushType}
          watercolorOpacity={watercolorOpacity}
          setWatercolorOpacity={setWatercolorOpacity}
          strokeStyle={strokeStyle}
          setStrokeStyle={setStrokeStyle}
          isEraserMode={isEraserMode}
          toggleEraserMode={toggleEraserMode}
          eraserSize={eraserSize}
          setEraserSize={setEraserSize}
          showLayerControls={activePanel?.type === 'pdf' && (isSplitView || activeTab === 'B')}
          isLayerPanelOpen={showLayerPanel}
          toggleLayerPanel={() => setShowLayerPanel(previous => !previous)}
          activeLayerName={currentLayersB.find(layer => layer.id === activeLayerIdB)?.name || 'レイヤー'}
          layerCount={currentLayersB.length}
          onUndo={handleUndo}
          onClear={clearDrawing}
          onClearAll={clearAllDrawings}
          onGrade={isOnAnswerPanel ? handleGradeFromToolbar : undefined}
          canUndoAnswer={isOnAnswerPanel ? canUndoAnswer : undefined}
          onUndoAnswer={isOnAnswerPanel ? () => answerPanelRef.current?.undo() : undefined}
          onClearAnswer={isOnAnswerPanel ? () => answerPanelRef.current?.clear() : undefined}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          availableModels={availableModels}
          defaultModelName={defaultModelName}
        />

        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {panelStack.map((panel, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                top: 0, left: 0, width: '100%', height: '100%',
                transform: `translateX(${(i - activePanelIndex) * 100}%)`,
                transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
                overflow: 'hidden'
              }}
            >
              {panel.type === 'pdf' && pdfContent}
              {panel.type === 'answer' && (
                <AnswerPanel
                  ref={answerPanelRef}
                  questionImage={panel.questionImage}
                  penColor={penColor}
                  penSize={penSize}
                  isEraserMode={isEraserMode}
                  eraserSize={eraserSize}
                  onCanUndoChange={setCanUndoAnswer}
                />
              )}
              {panel.type === 'grading' && (
                <div
                  ref={i === activePanelIndex ? gradingPanelRef : undefined}
                  style={{ position: 'relative', width: '100%', height: '100%' }}
                >
                  <GradingSpread
                    capturedImage={panel.capturedImage}
                    resultKey={`${panel.id}-${panel.status}`}
                    isSplitView={isSplitView}
                    activeTab={activeTab}
                    isPanesReversed={isPanesReversed}
                    splitRatio={splitRatio}
                    isResizing={isResizing}
                    onResizeStart={handleResizeStart}
                    splitContainerRef={gradingSplitContainerRef}
                    resultSheet={(
                      <GradingResult
                        result={panel.result}
                        isLoading={panel.status === 'loading'}
                        error={panel.error}
                        teacherMode={panel.teacherMode}
                        modelName={panel.modelName}
                        responseTime={panel.responseTime}
                      />
                    )}
                  />
                  {isGradingCaptureMode && i === activePanelIndex && (
                    <div
                      className="grading-capture-overlay"
                      style={{
                        position: 'absolute',
                        top: 0, left: 0, width: '100%', height: '100%',
                        zIndex: 9999,
                        cursor: 'crosshair',
                      }}
                      onMouseDown={handleGradingCaptureStart}
                      onMouseMove={handleGradingCaptureMove}
                      onMouseUp={handleGradingCaptureEnd}
                      onMouseLeave={() => { if (isGradingCapturingRef.current) handleGradingCaptureEnd() }}
                    >
                      {gradingCaptureRect && (
                        <div style={{
                          position: 'absolute',
                          left: gradingCaptureRect.x,
                          top: gradingCaptureRect.y,
                          width: gradingCaptureRect.width,
                          height: gradingCaptureRect.height,
                          backgroundColor: 'rgba(52, 152, 219, 0.2)',
                          border: '2px solid #3498db',
                          pointerEvents: 'none'
                        }} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* テキスト入力ボックス */}
        {editingText && (
          <div
            style={{
              position: 'fixed',
              left: editingText.screenX,
              top: editingText.screenY,
              zIndex: 10000,
              background: 'white',
              border: '2px solid #3498db',
              borderRadius: '4px',
              padding: '4px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
            }}
          >
            <textarea
              autoFocus
              defaultValue={editingText.initialText || ''}
              placeholder={t('textMode.placeholder')}
              style={{
                fontSize: `${textFontSize}px`,
                color: penColor,
                writingMode: textDirection === 'horizontal' ? 'horizontal-tb' :
                  textDirection === 'vertical-rl' ? 'vertical-rl' : 'vertical-lr',
                border: 'none',
                outline: 'none',
                resize: 'both',
                minWidth: textDirection === 'horizontal' ? '150px' : '50px',
                minHeight: textDirection === 'horizontal' ? '50px' : '100px',
                maxWidth: '300px',
                maxHeight: '200px'
              }}
              onBlur={(e) => confirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setEditingText(null)
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  confirmText((e.target as HTMLTextAreaElement).value)
                }
              }}
            />
          </div>
        )}

        {/* Error popup - always on top */}
        {gradingError && (
          <div style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100000,
            background: '#fef5f5',
            border: '1px solid #f44336',
            borderRadius: '8px',
            padding: '12px 20px',
            color: '#c62828',
            fontSize: '14px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            maxWidth: '400px',
            textAlign: 'center'
          }}>
            ❌ {gradingError}
          </div>
        )}
      </div>
    </div>
  )
}

export default StudyPanel
