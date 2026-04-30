import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { isTauri, apiBaseUrl } from './lib/env'
import './index.css'
import App from './App.tsx'

// Tauri 窗口关闭时同步关闭 Phoenix 后端
if (isTauri) {
  import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) => {
      const appWindow = getCurrentWindow()
      appWindow.onCloseRequested(async (event) => {
        event.preventDefault()
        try {
          await fetch(`${apiBaseUrl}/api/system/shutdown`, { method: 'POST' })
        } catch {
          // 忽略网络错误，确保窗口仍能关闭
        }
        void appWindow.destroy()
      }).catch(() => {})
    })
    .catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
