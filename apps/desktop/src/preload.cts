/** Sandboxed preload: makes the app surfaces draggable and keeps native caption colors in sync. */
import { contextBridge, ipcRenderer } from 'electron'

const TITLEBAR_HEIGHT = 40
const CAPTION_SAFE_WIDTH = 160
const FALLBACK_COLOR = '#f2e8e0'
const FALLBACK_SYMBOL = '#3b2f26'

/** Progress states pushed by the main process while the local host boots. */
interface SplashProgress {
  readonly percent: number
  readonly phase: string
  readonly text: string
}

// The splash document is the only file: page that consumes host progress.
if (location.protocol === 'file:' && location.pathname.endsWith('splash.html')) {
  contextBridge.exposeInMainWorld('desktopSplash', {
    onProgress(callback: (state: SplashProgress) => void): () => void {
      const listener = (_event: unknown, state: SplashProgress): void => { callback(state) }
      ipcRenderer.on('splash:progress', listener)
      return () => { ipcRenderer.removeListener('splash:progress', listener) }
    },
  })
}

function normalizeColor(value: string | null): string | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i.exec(trimmed)
  if (rgb === null) return undefined
  const channels = [rgb[1], rgb[2], rgb[3]].map((part) => Number(part))
  if (channels.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4])
  if (!Number.isFinite(alpha) || alpha <= 0) return undefined
  return `#${channels.map((part) => part.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Sample the surface behind the native caption buttons.
 *
 * The window is frameless, so the overlay color must match the top-right
 * surface of whatever screen is showing rather than a synthetic title bar.
 */
function sampleColor(): string | undefined {
  const x = Math.max(0, window.innerWidth - 80)
  let element = document.elementFromPoint(x, TITLEBAR_HEIGHT / 2)
  while (element !== null) {
    const color = normalizeColor(getComputedStyle(element).backgroundColor)
    if (color !== undefined) return color
    element = element.parentElement
  }
  for (const fallback of [
    document.querySelector('.app-header'),
    document.getElementById('fc-boot'),
    document.getElementById('root'),
    document.body,
  ]) {
    if (fallback === null) continue
    const color = normalizeColor(getComputedStyle(fallback).backgroundColor)
    if (color !== undefined) return color
  }
  return undefined
}

function symbolFor(color: string): string {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  return luminance > 0.55 ? FALLBACK_SYMBOL : '#f7f3ee'
}

function install(): void {
  // The local splash document carries its own drag region.
  if (location.protocol === 'file:') return
  const root = document.documentElement
  root.dataset.windowsTitlebar = ''

  const style = document.createElement('style')
  style.textContent = `
    /* Boot and welcome overlay: the whole surface drags; controls opt out. */
    html[data-windows-titlebar] #fc-boot {
      -webkit-app-region: drag;
    }
    html[data-windows-titlebar] #fc-boot :is(
      button, a, input, select, textarea, [role='button'], [tabindex]
    ) {
      -webkit-app-region: no-drag;
    }

    /* The workspace header is the title bar; reserve the native caption area. */
    html[data-windows-titlebar] .app-header {
      -webkit-app-region: drag;
      padding-right: ${CAPTION_SAFE_WIDTH}px !important;
    }
    html[data-windows-titlebar] .app-header :is(
      button, a, input, select, textarea,
      [role='button'], [tabindex], .ant-dropdown-trigger, .ant-select
    ) {
      -webkit-app-region: no-drag;
    }
  `
  document.head.append(style)

  let lastBackground = ''
  const sendTheme = (): void => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const background = sampleColor()
      ?? normalizeColor(meta?.getAttribute('content') ?? null)
      ?? FALLBACK_COLOR
    if (background === lastBackground) return
    lastBackground = background
    ipcRenderer.send('desktop:titlebar', {
      // The native overlay is transparent; only the caption glyphs need contrast.
      color: '#00000000',
      symbolColor: symbolFor(background),
    })
  }

  let scheduled = false
  const scheduleTheme = (): void => {
    if (scheduled) return
    scheduled = true
    window.requestAnimationFrame(() => {
      scheduled = false
      sendTheme()
    })
  }
  const observer = new MutationObserver(scheduleTheme)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'data-theme', 'content'],
  })
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true })

  sendTheme()
  window.setTimeout(sendTheme, 1_000)
  window.setTimeout(sendTheme, 3_000)
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true })
else install()
