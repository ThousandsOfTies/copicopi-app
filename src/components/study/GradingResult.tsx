import { GradingResponseResult } from '@home-teacher/common/services/api'
import { useTranslation } from 'react-i18next'
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
  strict: { icon: '◎', label: 'HARD' }
} as const

const GradingResult = ({ result, isLoading = false, error, teacherMode = 'kind', modelName, responseTime }: GradingResultProps) => {
  const { t } = useTranslation()
  const teacher = teacherDisplay[teacherMode]
  if (isLoading) {
    return (
      <article className="grading-result-sheet grading-result-loading" aria-live="polite">
        <div className={`grading-teacher-mark teacher-${teacherMode}`}>{teacher.icon}</div>
        <div className="grading-loading-spinner" />
        <h1>{t('copiStudy.result.loadingTitle')}</h1>
        <p>{t('copiStudy.result.loadingDescription')}</p>
        <p className="grading-loading-time">{t('copiStudy.result.loadingTime')}</p>
        <div className="grading-observation-points">
          <span>{t('copiStudy.result.silhouette')}</span>
          <span>{t('copiStudy.result.balance')}</span>
          <span>{t('copiStudy.result.mood')}</span>
        </div>
      </article>
    )
  }

  if (error) {
    return (
      <article className="grading-result-sheet grading-result-error" role="alert">
        <div className={`grading-teacher-mark teacher-${teacherMode}`}>{teacher.icon}</div>
        <h1>{t('copiStudy.result.errorTitle')}</h1>
        <p>{error}</p>
        <p className="grading-result-error-hint">{t('copiStudy.result.errorHint')}</p>
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
  const nextPointPrefix = t('copiStudy.result.nextPointPrefix')
  const improvementLine = explanationLines.find(line => line.startsWith(nextPointPrefix) || line.startsWith('次のポイント：'))
  const improvements = splitAdvice(improvementLine
    ?.replace(nextPointPrefix, '')
    .replace(/^次のポイント：/, ''))
  const practice = explanationLines.filter(line => line !== improvementLine).join(' ')

  return (
    <article className="grading-result-sheet">
      <header className="grading-sheet-header">
        <div>
          <div className={`grading-sheet-kicker teacher-${teacherMode}`}>{teacher.icon} {teacher.label}</div>
          <h1>{t('copiStudy.result.title')}</h1>
        </div>
        {level && (
          <div className="grading-score" aria-label={t('copiStudy.result.scoreLabel', { level })}>
            <strong>{level}</strong><span>/ 5</span>
          </div>
        )}
      </header>

      {result?.overallComment && (
        <section className="grading-summary">
          <h2>{t('copiStudy.result.overall')}</h2>
          <p>{result.overallComment}</p>
        </section>
      )}

      {goodPoints.length > 0 && (
        <section className="grading-advice-section grading-good-points">
          <h2><span>◎</span> {t('copiStudy.result.goodPoints')}</h2>
          <ul>{goodPoints.map((point, index) => <li key={index}>{point}</li>)}</ul>
        </section>
      )}

      {improvements.length > 0 && (
        <section className="grading-advice-section grading-improvements">
          <h2><span>→</span> {t('copiStudy.result.improvements')}</h2>
          <ol>{improvements.map((point, index) => <li key={index}>{point}</li>)}</ol>
        </section>
      )}

      {practice && (
        <section className="grading-practice">
          <h2>{t('copiStudy.result.practice')}</h2>
          <p>{practice}</p>
        </section>
      )}

      {!result && <p className="grading-empty-result">{t('copiStudy.result.empty')}</p>}

      {(modelName || responseTime != null) && (
        <footer className="grading-sheet-footer">
          {modelName}{modelName && responseTime != null ? ' ・ ' : ''}{responseTime != null ? t('copiStudy.result.seconds', { value: responseTime }) : ''}
        </footer>
      )}
    </article>
  )
}

export default GradingResult
