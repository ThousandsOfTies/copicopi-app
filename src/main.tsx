import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { i18nReady } from '@home-teacher/common/i18n/index'
import { APP_NAME, APP_DESCRIPTION, THEME_COLOR } from './config/features'
import { AuthProvider } from '@home-teacher/common/contexts/AuthContext'

document.title = APP_NAME
document.querySelector('meta[name="description"]')?.setAttribute('content', APP_DESCRIPTION)
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR)

i18nReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </React.StrictMode>,
  )
})
