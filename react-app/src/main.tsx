import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@/i18n'
import App from './App'
import '@/styles/theme.scss'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Messages load per locale and namespace; a page renders once the ones it uses are in. */}
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </StrictMode>,
)
