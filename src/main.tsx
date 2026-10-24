import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@/i18n'
import App from './App'
import { seal } from './modular'
import '@/styles/theme.scss'

// Every module's frontend script ran before this entry, so whatever registers from here on would never be shown.
seal()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* Messages load per locale and namespace; a page renders once the ones it uses are in. */}
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
