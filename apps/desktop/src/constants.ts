/** Shared desktop-shell constants. */

/** Height reserved for the Windows caption overlay and the injected drag band. */
export const TITLEBAR_HEIGHT = 40

/** Product name shown by the shell and the window title. */
export const PRODUCT_NAME = 'Future Cup'

/** Splash surface color, matched to the edge of the splash background art. */
export const SPLASH_BACKGROUND = '#e6e5e0'

/** Time the ready state stays visible before the splash starts fading. */
export const SPLASH_READY_HOLD_MS = 260

/** Splash fade duration; the host waits this long before loading the platform. */
export const SPLASH_FADE_MS = 300

/** Windows AppUserModelID used by shortcuts and notifications. */
export const APP_ID = 'com.ruirui.futurecup'

/** Paper theme used before the platform reports its own theme color. */
export const THEME_FALLBACK = {
  color: '#f2e8e0',
  symbolColor: '#3b2f26',
} as const
