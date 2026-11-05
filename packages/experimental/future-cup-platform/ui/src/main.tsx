import 'antd/dist/reset.css'
import '@xyflow/react/dist/style.css'
import './styles/global.css'
import './styles/neumorphic.css'
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
