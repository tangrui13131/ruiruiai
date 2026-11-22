// One-shot assembler for the Future Cup boot overlay in ui/index.html.
//
//   node ui/boot-src/assemble.mjs
//
// Sources (this directory):
//   boot-markup.html     overlay markup, also the Tailwind content scan source
//   boot-utilities.css   compiled utilities (pnpm dlx tailwindcss@3.4.17)
//   boot-custom.css      hand-ported tokens and component styles
//
// Emits ../index.html. The decision + injection scripts and the 8s shell
// guard are reproduced verbatim below; bump BOOT_VERSION there when the boot
// copy or timeline changes so the six-hour play-once key replays.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const uiDir = resolve(here, '..')

const read = (name) => readFileSync(resolve(here, name), 'utf8')

const markupFull = read('boot-markup.html')
const start = markupFull.indexOf('<div id="fc-boot"')
const end = markupFull.indexOf('<!-- SCAN-ONLY')
if (start < 0 || end < 0) throw new Error('boot-markup.html markers missing')
const markup = markupFull.slice(start, end).trimEnd()

const customCss = read('boot-custom.css').trim()
const utilityCss = read('boot-utilities.css').trim()

const BOOT_VERSION = '2026-11-21.4'

const output = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/brand/future-cup-mark.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#f2e8e0" />
    <title>Future Cup · 多 Agent 调度工作站</title>
    <style>
/* Boot overlay, assembled from ui/boot-src/ (markup + compiled Tailwind
   utilities + hand-ported styles). Critical boot styles: painted before any
   bundle arrives. Runs before the React app and its LocaleProvider exist, so
   copy stays inline here (bilingual zh labels + en sublabels) and is exempt
   from the locale dictionary on purpose. */

${customCss}

/* Compiled Tailwind utilities for the boot markup (no preflight). */
${utilityCss}
    </style>
    <script>
      /* Decide before first paint; never depend on the app bundle for this. */
      (function () {
        var params = new URLSearchParams(window.location.search)
        var force = params.get('boot') === '1'
        var skip = params.get('noboot') === '1'
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
        var key = 'future-cup:boot:v1'
        var version = '${BOOT_VERSION}'
        var play = !skip && !reduced
        function readStored() {
          try {
            var fromLocal = window.localStorage.getItem(key)
            if (fromLocal !== null) return JSON.parse(fromLocal)
          } catch (err) { /* private mode may reject localStorage */ }
          try {
            var fromSession = window.sessionStorage.getItem(key)
            if (fromSession !== null) return JSON.parse(fromSession)
          } catch (err) { /* session storage can be unavailable too */ }
          return null
        }
        if (play && !force) {
          var saved = readStored()
          if (saved && saved.version === version && Date.now() - Number(saved.at || 0) < 6 * 60 * 60 * 1000) {
            play = false
          }
        }
        /* ?boot=1 is a one-shot replay: remove it from the address bar so F5 does not force it again. */
        if (force) {
          try {
            var nextUrl = new URL(window.location.href)
            nextUrl.searchParams.delete('boot')
            window.history.replaceState(null, '', nextUrl.pathname + nextUrl.search + nextUrl.hash)
          } catch (err) { /* history API can be unavailable in embedded views */ }
        }
        window.__FC_BOOT__ = { play: play, key: key, version: version }
      })()
    </script>
  </head>
  <body>
    <script>
      /* Inject the boot overlay only when this load will play it. The not-playing
         document keeps the exact shell of a bootless build: no overlay element, no
         state classes, no reserved space. If the bundle never takes over, the shell
         guard removes the overlay after 8s so the page still becomes usable. */
      (function () {
        var config = window.__FC_BOOT__
        if (!config || config.play !== true) return
        document.write(\`
${markup}
\`)
        document.documentElement.classList.add('fc-boot-armed')
        window.setTimeout(function () {
          if (window.__FC_BOOT_RUNNING__ === true) return
          var el = document.getElementById('fc-boot')
          if (el && el.parentNode) el.parentNode.removeChild(el)
          document.documentElement.classList.remove('fc-boot-armed')
          document.body.style.overflow = ''
        }, 8000)
      })()
    </script>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`

writeFileSync(resolve(uiDir, 'index.html'), output)

// The same markup ships inside the bundle so 系统重启 can replay the boot
// animation in place on loads where the overlay never armed (noboot flag,
// reduced motion, six-hour skip) — those documents carry no #fc-boot node.
if (markup.includes('`') || markup.includes('${')) {
  throw new Error('boot markup contains backtick or template placeholder; escape before embedding')
}
const generated = `/**
 * Generated by ui/boot-src/assemble.mjs — do not edit by hand.
 * Verbatim copy of the boot overlay markup from boot-markup.html; boot.ts
 * inserts it when replaying the animation on demand.
 */
export const bootOverlayMarkup = \`
${markup}
\`
`
writeFileSync(resolve(uiDir, 'src', 'boot', 'boot-markup.generated.ts'), generated)

console.log('assembled ui/index.html:', output.length, 'bytes')
console.log('generated ui/src/boot/boot-markup.generated.ts:', generated.length, 'bytes')
