import 'antd/dist/reset.css'
import '@xyflow/react/dist/style.css'
import './styles/global.css'
import './styles/neumorphic.css'
import './styles/motion.css'
import './boot/boot.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('Future Cup management root element is missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const readyWindow = window as Window & { __FC_APP_READY__?: boolean }
    readyWindow.__FC_APP_READY__ = true
    window.dispatchEvent(new Event('future-cup:ready'))
  })
})
