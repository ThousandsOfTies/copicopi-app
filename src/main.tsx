import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import i18n, { i18nReady } from './i18n'
import { APP_NAME, APP_DESCRIPTION, THEME_COLOR } from './config/features'
import { AuthProvider } from '@home-teacher/common/contexts/AuthContext'

document.title = APP_NAME
document.querySelector('meta[name="description"]')?.setAttribute('content', APP_DESCRIPTION)
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR)

i18nReady.then(() => {
  const updateLanguage = () => {
    document.documentElement.lang = i18n.resolvedLanguage || i18n.language
    document.querySelector('meta[name="description"]')?.setAttribute('content',
      i18n.language.startsWith('ja') ? APP_DESCRIPTION : i18n.t('copicopi:app.description'))
  }
  updateLanguage()
  i18n.on('languageChanged', updateLanguage)
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </React.StrictMode>,
  )
})
