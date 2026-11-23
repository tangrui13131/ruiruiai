/** Electron main process for the Future Cup desktop shell. */
import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, screen } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ID, PRODUCT_NAME, SPLASH_FADE_MS, SPLASH_READY_HOLD_MS } from './constants.js'
import { killProcessTree, startHost, type RunningHost } from './host.js'
import { appendLog } from './log.js'
import { isPortableMode, portableUserDataPath } from './portable.js'
import { rebasePortablePaths } from './rebase.js'
import { loadApiKey, saveApiKey } from './settings.js'
import { applyTitleBarOverlay, createMainWindow } from './window.js'

const moduleDirectory = fileURLToPath(new URL('.', import.meta.url))
const rendererDirectory = join(app.getAppPath(), 'renderer')
const preloadPath = join(moduleDirectory, 'preload.cjs')
const settingsPreloadPath = join(moduleDirectory, 'settings-preload.cjs')

// Keep development and packaged userData paths identical.
app.setName(PRODUCT_NAME)

// A portable.flag next to the executable moves all user data onto the drive.
const portableUserData = portableUserDataPath()
if (portableUserData !== undefined) app.setPath('userData', portableUserData)

let mainWindow: BrowserWindow | undefined
let settingsWindow: BrowserWindow | undefined
let host: RunningHost | undefined
let hostPid: number | undefined
let settingsResolve: ((value: string | undefined) => void) | undefined
let quitting = false

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void stopHost().finally(() => { app.quit() })
  })
  app.whenReady().then(() => bootstrap()).catch((error: unknown) => {
    reportFatal('启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  })
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_ID)
  Menu.setApplicationMenu(null)
  registerIpc()

  const apiKey = loadApiKey() ?? await promptForApiKey()
  if (apiKey === undefined) {
    app.quit()
    return
  }

  const window = createMainWindow(preloadPath)
  mainWindow = window
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12') return
    window.webContents.toggleDevTools()
    event.preventDefault()
  })
  try {
    await window.loadFile(join(rendererDirectory, 'splash.html'))
    try {
      rebasePortablePaths()
    } catch (error) {
      appendLog(`rebase: failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    host = await startHost({
      apiKey,
      onSpawn: (pid) => {
        hostPid = pid
      },
      onProgress: (progress) => {
        if (!window.isDestroyed()) window.webContents.send('splash:progress', progress)
      },
      onUnexpectedExit: (message) => {
        reportFatal('本地服务已停止', message)
        app.quit()
      },
    })
    if (window.isDestroyed()) {
      await host.stop()
      return
    }
    await new Promise(resolve => setTimeout(resolve, SPLASH_READY_HOLD_MS + SPLASH_FADE_MS + 20))
    if (window.isDestroyed()) {
      await host.stop()
      return
    }
    await window.loadURL(host.url)
    appendLog(`shell: platform ready at ${host.url}`)
    await maybeCapture(window)
  } catch (error) {
    reportFatal(`${PRODUCT_NAME} 启动失败`, error instanceof Error ? error.message : String(error))
    app.quit()
  }
}

async function maybeCapture(window: BrowserWindow): Promise<void> {
  const capturePath = process.env.DSH_DESKTOP_CAPTURE?.trim()
  const screenCapturePath = process.env.DSH_DESKTOP_CAPTURE_SCREEN?.trim()
  const wantsPage = capturePath !== undefined && capturePath !== ''
  const wantsScreen = screenCapturePath !== undefined && screenCapturePath !== ''
  if (!wantsPage && !wantsScreen) return
  const clickExpression = process.env.DSH_DESKTOP_CAPTURE_CLICK?.trim()
  if (!app.isPackaged && clickExpression !== undefined && clickExpression !== '') {
    await window.webContents.executeJavaScript(clickExpression)
    await new Promise(resolve => setTimeout(resolve, 3_000))
  }
  const requestedDelay = Number(process.env.DSH_DESKTOP_CAPTURE_DELAY_MS ?? '2500')
  const delay = Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : 2_500
  await new Promise(resolve => setTimeout(resolve, delay))
  if (window.isDestroyed()) return
  window.show()
  window.focus()
  window.moveTop()
  await new Promise(resolve => setTimeout(resolve, 500))
  if (wantsPage) {
    const image = await window.webContents.capturePage()
    writeFileSync(capturePath, image.toPNG())
    appendLog(`capture: wrote ${capturePath}`)
  }
  if (wantsScreen) {
    await captureWindowWithChrome(window, screenCapturePath)
    appendLog(`capture: wrote ${screenCapturePath}`)
  }
  app.quit()
}

/** Capture the window including native chrome, for frameless-layout verification. */
async function captureWindowWithChrome(window: BrowserWindow, path: string): Promise<void> {
  const bounds = window.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const windowSources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: {
      width: Math.round(bounds.width * display.scaleFactor),
      height: Math.round(bounds.height * display.scaleFactor),
    },
  })
  const appWindow = windowSources.find(item => item.name.includes('Future Cup'))
  if (appWindow !== undefined && !appWindow.thumbnail.isEmpty()) {
    writeFileSync(path, appWindow.thumbnail.toPNG())
    return
  }
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor),
    },
  })
  const source = sources.find(item => item.display_id === String(display.id)) ?? sources.at(0)
  if (source === undefined) return
  const image = source.thumbnail
  const imageSize = image.getSize()
  const scaleX = imageSize.width / display.bounds.width
  const scaleY = imageSize.height / display.bounds.height
  const x = Math.max(0, Math.min(imageSize.width - 1, Math.round((bounds.x - display.bounds.x) * scaleX)))
  const y = Math.max(0, Math.min(imageSize.height - 1, Math.round((bounds.y - display.bounds.y) * scaleY)))
  const width = Math.max(1, Math.min(imageSize.width - x, Math.round(bounds.width * scaleX)))
  const height = Math.max(1, Math.min(imageSize.height - y, Math.round(bounds.height * scaleY)))
  const cropped = image.crop({ x, y, width, height })
  writeFileSync(path, cropped.toPNG())
}

function promptForApiKey(): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | undefined): void => {
      if (settled) return
      settled = true
      settingsResolve = undefined
      const window = settingsWindow
      settingsWindow = undefined
      if (window !== undefined && !window.isDestroyed()) window.destroy()
      resolve(value)
    }
    settingsResolve = finish

    const window = new BrowserWindow({
      width: 560,
      height: 380,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: PRODUCT_NAME,
      show: false,
      backgroundColor: '#f7f1ea',
      webPreferences: {
        preload: settingsPreloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    settingsWindow = window
    window.once('ready-to-show', () => { window.show() })
    window.on('closed', () => {
      if (settingsWindow === window) settingsWindow = undefined
      if (settled) return
      settled = true
      settingsResolve = undefined
      resolve(undefined)
    })
    const settingsCapture = process.env.DSH_DESKTOP_CAPTURE_SETTINGS?.trim()
    if (settingsCapture !== undefined && settingsCapture !== '') {
      window.webContents.once('did-finish-load', () => {
        setTimeout(() => {
          void (async () => {
            const image = await window.webContents.capturePage()
            writeFileSync(settingsCapture, image.toPNG())
            app.quit()
          })()
        }, 600)
      })
    }
    void window.loadFile(join(rendererDirectory, 'settings.html'))
  })
}

function registerIpc(): void {
  ipcMain.handle('settings:save', (event, key: unknown) => {
    const window = settingsWindow
    if (window === undefined || event.sender !== window.webContents) throw new Error('unexpected sender')
    if (typeof key !== 'string') throw new Error('API Key 格式无效')
    saveApiKey(key)
    settingsResolve?.(key.trim())
    return true
  })
  ipcMain.handle('settings:cancel', (event) => {
    const window = settingsWindow
    if (window === undefined || event.sender !== window.webContents) throw new Error('unexpected sender')
    settingsResolve?.(undefined)
    return true
  })
  ipcMain.on('settings:portable', (event) => {
    event.returnValue = isPortableMode()
  })
  ipcMain.on('desktop:titlebar', (event, payload: unknown) => {
    const window = mainWindow
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents) return
    if (typeof payload !== 'object' || payload === null) return
    const { color, symbolColor } = payload as { color?: unknown; symbolColor?: unknown }
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return
    if (typeof symbolColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(symbolColor)) return
    applyTitleBarOverlay(window, color, symbolColor)
  })
}

async function stopHost(): Promise<void> {
  if (host !== undefined) {
    const running = host
    host = undefined
    await running.stop()
    hostPid = undefined
    return
  }
  if (hostPid !== undefined) {
    killProcessTree(hostPid)
    hostPid = undefined
  }
}

function reportFatal(title: string, message: string): void {
  appendLog(`${title}: ${message}`)
  dialog.showErrorBox(title, message)
}
