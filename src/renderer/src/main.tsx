import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { FeedbackOverlay } from './components/FeedbackOverlay'
import { applyCachedAppearance } from './appearance'
import { AddonBackgrounds } from './components/Addons'
import { installRichCopy } from './richCopy'

// The same bundle runs in the unseen window that hosts add-ons' background pages (see addonHost.ts).
const background = location.hash === '#addon-background'

if (!background) {
  applyCachedAppearance()
  installRichCopy()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {background ? (
      <AddonBackgrounds />
    ) : (
      <>
        <App />
        <FeedbackOverlay />
      </>
    )}
  </StrictMode>
)
