/** Main application window with the Windows caption overlay. */
import { BrowserWindow, shell } from 'electron'
import { SPLASH_BACKGROUND, THEME_FALLBACK, TITLEBAR_HEIGHT } from './constants.js'

/**
 * Create the frameless primary window.
 * @param preloadPath - compiled CommonJS preload script.
 * @returns a hidden window that the caller shows after the splash is ready.
 */
export function createMainWindow(preloadPath: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: SPLASH_BACKGROUND,
    title: 'Future Cup',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: TITLEBAR_HEIGHT,
      // Transparent overlay: the page itself paints the titlebar surface.
      color: '#00000000',
      symbolColor: THEME_FALLBACK.symbolColor,
    },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('file://')
      || url.startsWith('http://127.0.0.1:')
      || url.startsWith('http://localhost:')
    if (allowed) return
    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
  })

  return window
}

/**
 * Update the native caption colors to match the page theme.
 * @param window - primary window.
 * @param color - opaque `#rrggbb` caption background.
 * @param symbolColor - opaque `#rrggbb` caption glyph color.
 */
export function applyTitleBarOverlay(window: BrowserWindow, color: string, symbolColor: string): void {
  if (window.isDestroyed()) return
  window.setTitleBarOverlay({ height: TITLEBAR_HEIGHT, color, symbolColor })
}
