import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import AdminPanel from '@home-teacher/common/components/admin/AdminPanel'
import StudyPanel from './components/study/StudyPanel'
import PDFEditorPanel from '@home-teacher/common/components/admin/PDFEditorPanel'
import { PDFFileRecord } from '@home-teacher/common/utils/indexedDB'
import { useAppInitializer } from '@home-teacher/common/hooks/useAppInitializer'

type AppView = 'admin' | 'viewer' | 'editor'

function App() {
  const [currentView, setCurrentView] = useState<AppView>('admin')
  const [selectedPDF, setSelectedPDF] = useState<PDFFileRecord | null>(null)
  const { isInitialized, initialView, initialPDF, settingsVersion } = useAppInitializer()

  useEffect(() => {
    if (isInitialized && initialView === 'viewer' && initialPDF) {
      setSelectedPDF(initialPDF)
      setCurrentView('viewer')
    }
  }, [isInitialized, initialView, initialPDF])

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      registration?.update().catch(() => {})
    },
  })

  const handleSelectPDF = (record: PDFFileRecord) => {
    setSelectedPDF(record)
    setCurrentView('viewer')
  }

  const handleEditPDF = (record: PDFFileRecord) => {
    setSelectedPDF(record)
    setCurrentView('editor')
  }

  const handleBackToAdmin = () => {
    setCurrentView('admin')
    setSelectedPDF(null)
  }

  if (!isInitialized) {
    return <div className="loading-screen">Loading...</div>
  }

  return (
    <div className="app">
      {currentView === 'admin' ? (
        <AdminPanel
          key={`admin-${settingsVersion}`}
          onSelectPDF={handleSelectPDF}
          onEditPDF={handleEditPDF}
          hasUpdate={needRefresh}
          onUpdate={() => updateServiceWorker(true)}
          studyTabLabel="Enjoy"
          storageIconSrc={`${import.meta.env.BASE_URL}icons/copicopi/logo.png`}
          historyVariant="progress"
          settingsVariant="teachers"
          guideVariant="copy"
        />
      ) : currentView === 'viewer' && selectedPDF ? (
        <StudyPanel
          key={`study-${settingsVersion}-${selectedPDF.id}`}
          pdfRecord={selectedPDF}
          pdfId={selectedPDF.id}
          onBack={handleBackToAdmin}
        />
      ) : currentView === 'editor' && selectedPDF ? (
        <PDFEditorPanel
          key={`editor-${settingsVersion}-${selectedPDF.id}`}
          pdfRecord={selectedPDF}
          pdfId={selectedPDF.id}
          onBack={handleBackToAdmin}
        />
      ) : (
        <div>No PDF selected</div>
      )}
    </div>
  )
}

export default App
