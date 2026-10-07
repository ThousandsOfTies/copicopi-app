import type { TFunction } from 'i18next'
import { localizeErrorMessage, translateKnownMessage } from '@home-teacher/common/i18n/errorMessages'
import ja from './locales/ja.json'
import en from './locales/en.json'

export function localizeAppError(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('Error: ')) return 'Error: ' + localizeAppError(message.slice(7), t)
  return translateKnownMessage(message, ja.errors, t, 'copicopi')
    ?? translateKnownMessage(message, en.errors, t, 'copicopi')
    ?? localizeErrorMessage(message, t)
}
