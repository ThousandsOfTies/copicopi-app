import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { DrawingCanvas, type DrawingPath } from '@thousands-of-ties/drawing-common'

type ReferenceKind = 'image' | 'pdf'

interface ReferenceFile {
  file: File
  kind: ReferenceKind
  name: string
  objectUrl: string
}

const DRAWING_STORAGE_KEY = 'copicopi:drawing-paths:v1'

const baseUrl = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`
pdfjsLib.GlobalWorkerOptions.workerSrc = `${baseUrl}pdf.worker.min.js`

function App() {
  const [reference, setReference] = useState<ReferenceFile | null>(null)
  const [pdfDocument, setPdfDocument] = useState<any>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [referenceError, setReferenceError] = useState<string | null>(null)
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [color, setColor] = useState('#1d4ed8')
  const [size, setSize] = useState(4)
  const [eraserSize, setEraserSize] = useState(32)
  const [paths, setPaths] = useState<DrawingPath[]>(() => {
    try {
      const saved = localStorage.getItem(DRAWING_STORAGE_KEY)
      return saved ? JSON.parse(saved) as DrawingPath[] : []
    } catch {
      return []
    }
  })
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 800 })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const drawingHostRef = useRef<HTMLDivElement>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    localStorage.setItem(DRAWING_STORAGE_KEY, JSON.stringify(paths))
  }, [paths])

  useEffect(() => {
    const host = drawingHostRef.current
    if (!host) return

    const updateSize = () => {
      setCanvasSize({
        width: Math.max(320, Math.floor(host.clientWidth)),
        height: Math.max(420, Math.floor(host.clientHeight)),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!reference || reference.kind !== 'pdf') {
      setPdfDocument(null)
      setPageCount(0)
      return
    }

    let active = true
    let loadingTask: any

    const loadPdf = async () => {
      try {
        setReferenceError(null)
        const data = new Uint8Array(await reference.file.arrayBuffer())
        loadingTask = pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false })
        const document = await loadingTask.promise
        if (!active) {
          await document.destroy()
          return
        }
        setPdfDocument(document)
        setPageCount(document.numPages)
        setPageNumber(1)
      } catch (error) {
        if (active) {
          setReferenceError('PDFを読み込めませんでした。別のファイルを選んでください。')
          setPdfDocument(null)
        }
      }
    }

    void loadPdf()
    return () => {
      active = false
      loadingTask?.destroy?.()
    }
  }, [reference])

  useEffect(() => {
    if (!pdfDocument || !pdfCanvasRef.current) return

    let cancelled = false
    let renderTask: any
    const canvas = pdfCanvasRef.current

    const renderPage = async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1.5 })
        const context = canvas.getContext('2d')
        if (!context) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        renderTask = page.render({ canvasContext: context, viewport })
        await renderTask.promise
      } catch (error: any) {
        if (error?.name !== 'RenderingCancelledException') {
          setReferenceError('PDFページの表示に失敗しました。')
        }
      }
    }

    void renderPage()
    return () => {
      cancelled = true
      renderTask?.cancel?.()
    }
  }, [pdfDocument, pageNumber])

  useEffect(() => () => {
    if (reference) URL.revokeObjectURL(reference.objectUrl)
  }, [reference])

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const isImage = file.type.startsWith('image/')
    if (!isPdf && !isImage) {
      setReferenceError('画像ファイルまたはPDFを選んでください。')
      return
    }

    setReferenceError(null)
    setReference({
      file,
      kind: isPdf ? 'pdf' : 'image',
      name: file.name,
      objectUrl: URL.createObjectURL(file),
    })
  }

  const clearDrawing = () => {
    setPaths([])
    localStorage.removeItem(DRAWING_STORAGE_KEY)
  }

  return (
    <main className="copicopi-app">
      <header className="app-header">
        <div>
          <p className="eyebrow">REFERENCE &amp; DRAWING</p>
          <h1>CopiCopi</h1>
          <p className="subtitle">見本を見ながら、自由に模写する。</p>
        </div>
        <div className="local-notice">ファイルと描画はこの端末内だけで扱われます</div>
      </header>

      <section className="workspace" aria-label="模写ワークスペース">
        <section className="pane reference-pane" aria-label="A面 模写対象">
          <div className="pane-header">
            <div>
              <span className="pane-label">A面</span>
              <h2>模写対象</h2>
            </div>
            <button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}>
              ファイルを選ぶ
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/*,application/pdf,.pdf"
              onChange={handleFile}
            />
          </div>

          <div className="reference-content">
            {!reference && (
              <div className="empty-reference">
                <strong>画像またはPDFを読み込む</strong>
                <span>ドラッグ＆ドロップ対応は次の段階で追加予定です。</span>
              </div>
            )}
            {reference?.kind === 'image' && (
              <img className="reference-image" src={reference.objectUrl} alt={`模写対象: ${reference.name}`} />
            )}
            {reference?.kind === 'pdf' && pdfDocument && (
              <canvas ref={pdfCanvasRef} className="reference-pdf" aria-label={`模写対象PDF: ${reference.name}`} />
            )}
            {reference?.kind === 'pdf' && !pdfDocument && !referenceError && (
              <div className="empty-reference">PDFを読み込んでいます…</div>
            )}
            {referenceError && <p className="reference-error">{referenceError}</p>}
          </div>

          <footer className="reference-footer">
            <span>{reference ? reference.name : 'ファイル未選択'}</span>
            {reference?.kind === 'pdf' && pageCount > 0 && (
              <div className="page-controls">
                <button type="button" onClick={() => setPageNumber(page => Math.max(1, page - 1))} disabled={pageNumber === 1}>前へ</button>
                <span>{pageNumber} / {pageCount}</span>
                <button type="button" onClick={() => setPageNumber(page => Math.min(pageCount, page + 1))} disabled={pageNumber === pageCount}>次へ</button>
              </div>
            )}
          </footer>
        </section>

        <section className="pane drawing-pane" aria-label="B面 模写キャンバス">
          <div className="pane-header">
            <div>
              <span className="pane-label">B面</span>
              <h2>模写キャンバス</h2>
            </div>
            <div className="drawing-actions">
              <button type="button" onClick={() => setPaths(current => current.slice(0, -1))} disabled={paths.length === 0}>元に戻す</button>
              <button type="button" onClick={clearDrawing} disabled={paths.length === 0}>消去</button>
            </div>
          </div>

          <div className="drawing-toolbar" aria-label="描画ツール">
            <button type="button" className={tool === 'pen' ? 'selected' : ''} onClick={() => setTool('pen')}>ペン</button>
            <button type="button" className={tool === 'eraser' ? 'selected' : ''} onClick={() => setTool('eraser')}>消しゴム</button>
            <label>色 <input type="color" value={color} onChange={event => setColor(event.target.value)} disabled={tool === 'eraser'} /></label>
            <label>太さ <input type="range" min="1" max="24" value={size} onChange={event => setSize(Number(event.target.value))} disabled={tool === 'eraser'} /></label>
            <label>消し幅 <input type="range" min="8" max="96" value={eraserSize} onChange={event => setEraserSize(Number(event.target.value))} disabled={tool === 'pen'} /></label>
          </div>

          <div ref={drawingHostRef} className="drawing-host">
            <DrawingCanvas
              width={canvasSize.width}
              height={canvasSize.height}
              tool={tool}
              color={color}
              size={size}
              eraserSize={eraserSize}
              paths={paths}
              onPathAdd={path => setPaths(current => [...current, path])}
              onPathsChange={setPaths}
              onUndo={() => setPaths(current => current.slice(0, -1))}
            />
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
