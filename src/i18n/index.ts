import { useTranslation } from 'react-i18next'
import i18n, { i18nReady as commonI18nReady } from '@home-teacher/common/i18n/index'
import ja from './locales/ja.json'
import en from './locales/en.json'

// Share the language menu while keeping app-specific wording in its own namespace.
export const i18nReady = commonI18nReady.then(() => {
  i18n.addResourceBundle('ja', 'copicopi', ja)
  i18n.addResourceBundle('en', 'copicopi', en)
})

export function useAppTranslation() {
  return useTranslation('copicopi')
}

export default i18n
