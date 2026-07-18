import { GradingResponseResult } from '@home-teacher/common/services/api'
import './GradingResult.css'

interface GradingResultProps {
  result?: GradingResponseResult | null
  isLoading?: boolean
  error?: string | null
  teacherMode?: 'kind' | 'balanced' | 'strict'
  modelName?: string | null
  responseTime?: number | null
}

const splitAdvice = (value?: string) => value
  ? value.split('／').map(item => item.trim()).filter(Boolean)
  : []

const teacherDisplay = {
  kind: { icon: '♡', label: 'KIND' },
  balanced: { icon: '⚖', label: 'BALANCED' },
  strict: { icon: '◎', label: 'STRICT' }
} as const

const GradingResult = ({ result, isLoading = false, error, teacherMode = 'kind', modelName, responseTime }: GradingResultProps) => {
  const teacher = teacherDisplay[teacherMode]
  if (isLoading) {
    return (
      <article className="grading-result-sheet grading-result-loading" aria-live="polite">
        <div className={`grading-teacher-mark teacher-${teacherMode}`}>{teacher.icon}</div>
        <div className="grading-loading-spinner" />
        <h1>作品を見ています…</h1>
        <p>見本と模写の構図・形・雰囲気を見比べています。</p>
        <p className="grading-loading-time">通常10〜30秒ほどです</p>
        <div className="grading-observation-points">
          <span>シルエット</span>
          <span>バランス</span>
          <span>雰囲気</span>
        </div>
      </article>
    )
  }

  if (error) {
    return (
      <article className="grading-result-sheet grading-result-error" role="alert">
        <div className={`grading-teacher-mark teacher-${teacherMode}`}>{teacher.icon}</div>
        <h1>採点できませんでした</h1>
        <p>{error}</p>
        <p className="grading-result-error-hint">PDF画面に戻り、範囲を選び直してもう一度お試しください。</p>
      </article>
    )
  }

  const problem = result?.problems?.[0]
  const levelFromConfidence = typeof problem?.confidence === 'number'
    ? problem.confidence
    : Number(problem?.confidence)
  const levelFromTitle = Number(problem?.problemNumber?.match(/([1-5])\s*\/\s*5/)?.[1])
  const level = Number.isFinite(levelFromConfidence) && levelFromConfidence >= 1
    ? levelFromConfidence
    : (Number.isFinite(levelFromTitle) ? levelFromTitle : null)
  const goodPoints = splitAdvice(problem?.feedback)
  const explanationLines = problem?.explanation?.split('\n').map(line => line.trim()).filter(Boolean) || []
  const improvementLine = explanationLines.find(line => line.startsWith('次のポイント：'))
  const improvements = splitAdvice(improvementLine?.replace(/^次のポイント：/, ''))
  const practice = explanationLines.filter(line => line !== improvementLine).join(' ')

  return (
    <article className="grading-result-sheet">
      <header className="grading-sheet-header">
        <div>
          <div className={`grading-sheet-kicker teacher-${teacherMode}`}>{teacher.icon} {teacher.label}</div>
          <h1>模写の振り返り</h1>
        </div>
        {level && (
          <div className="grading-score" aria-label={`模写評価 ${level}点、5点満点`}>
            <strong>{level}</strong><span>/ 5</span>
          </div>
        )}
      </header>

      {result?.overallComment && (
        <section className="grading-summary">
          <h2>全体の印象</h2>
          <p>{result.overallComment}</p>
        </section>
      )}

      {goodPoints.length > 0 && (
        <section className="grading-advice-section grading-good-points">
          <h2><span>◎</span> よかったところ</h2>
          <ul>{goodPoints.map((point, index) => <li key={index}>{point}</li>)}</ul>
        </section>
      )}

      {improvements.length > 0 && (
        <section className="grading-advice-section grading-improvements">
          <h2><span>→</span> 次に直すポイント</h2>
          <ol>{improvements.map((point, index) => <li key={index}>{point}</li>)}</ol>
        </section>
      )}

      {practice && (
        <section className="grading-practice">
          <h2>次の一枚でやってみよう</h2>
          <p>{practice}</p>
        </section>
      )}

      {!result && <p className="grading-empty-result">採点結果がありません。</p>}

      {(modelName || responseTime != null) && (
        <footer className="grading-sheet-footer">
          {modelName}{modelName && responseTime != null ? ' ・ ' : ''}{responseTime != null ? `${responseTime}秒` : ''}
        </footer>
      )}
    </article>
  )
}

export default GradingResult
