import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './App'
import { FeedbackOverlay } from './dev/FeedbackOverlay'
import { applyCachedAppearance } from './appearance'
import { AddonBackgrounds } from './components/Addons'

// The same bundle runs in the unseen window that hosts add-ons' background pages (see addonHost.ts).
const background = location.hash === '#addon-background'

if (!background) applyCachedAppearance()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {background ? (
      <AddonBackgrounds />
    ) : (
      <>
        <App />
        {import.meta.env.DEV && <FeedbackOverlay />}
      </>
    )}
  </StrictMode>
)
