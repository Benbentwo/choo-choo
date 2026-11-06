import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { FeedbackOverlay } from './dev/FeedbackOverlay'
import { applyCachedAppearance } from './appearance'

applyCachedAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    {import.meta.env.DEV && <FeedbackOverlay />}
  </StrictMode>
)
