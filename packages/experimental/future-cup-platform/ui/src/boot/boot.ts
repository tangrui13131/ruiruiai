/**
 * First-paint boot overlay controller — RR 3D emblem cinematic.
 *
 * Locale note: boot copy is deliberately inline zh-first with en sublabels in
 * index.html; this controller runs before LocaleProvider mounts, so the locale
 * dictionary does not cover it.
 *
 * The decision to play (URL flags, reduced motion, six-hour preference) and the
 * eight-second shell guard live in index.html: if this module never loads the
 * page must still become usable. This module only animates a boot that the
 * inline script already decided to arm.
 *
 * Timeline contract: the four-act visual narrative and the ERR 3090 → 3-step
 * self-heal story are scripted theater. The four real API probes
 * (`CHECKS`) never interrupt the story — their results surface only in the
 * end state: fusion-strip module dots flip to OFFLINE and the welcome layer
 * gains a failure note when a real endpoint is down.
 */

import { bootOverlayMarkup } from './boot-markup.generated.ts'

interface BootConfig {
  readonly play: boolean
  readonly key: string
  readonly version: string
}

interface BootWindow extends Window {
  __FC_BOOT__?: BootConfig
  __FC_APP_READY__?: boolean
  __FC_BOOT_RUNNING__?: boolean
  __FC_BOOT_REPLAY__?: () => void
}

interface BootCheck {
  readonly key: string
  readonly url: string
}

const CHECKS: readonly BootCheck[] = [
  { key: 'projects', url: '/api/v1/projects' },
  { key: 'agents', url: '/api/v1/agent-definitions' },
  { key: 'scheduler', url: '/api/v1/teams' },
  { key: 'mcp', url: '/api/v1/mcp/info' },
]

interface BootModule {
  readonly key: string
  readonly label: string
  /** Scripted latency shown while the narrative reports the module healthy. */
  readonly ms: string
}

const MODULES: readonly BootModule[] = [
  { key: 'projects', label: 'PROJECT INDEX', ms: '14ms' },
  { key: 'agents', label: 'AGENT REGISTRY', ms: '28ms' },
  { key: 'scheduler', label: 'SCHEDULER', ms: '31ms' },
  { key: 'mcp', label: 'MCP GATEWAY', ms: '19ms' },
]

const DURATION_MS = 3800
const DIAG_TICK_COUNT = 36

/** Normalized four-act timeline percentages. */
const ACT = {
  A1_END: 0.16,
  A2_END: 0.36,
  A3_END: 0.82,
  GLITCH_START: 0.87,
  EXIT_START: 0.92,
} as const

/** Scripted fault → self-repair → recovery sequence, in narrative ms. */
const HEAL = {
  ALERT_END: 650,
  STEP1_END: 1250,
  STEP2_END: 1900,
  REPAIR_END: 2550,
  TOTAL: 3150,
} as const

const HEAL_STEPS: readonly { start: number; end: number; running: string; done: string }[] = [
  { start: 650, end: 1250, running: 'SCANNING', done: 'CLEARED' },
  { start: 1250, end: 1900, running: 'REBUILDING', done: 'REBUILT' },
  { start: 1900, end: 2550, running: 'PROBING', done: '21ms OK' },
]

type HealMode = 'none' | 'alert' | 'healing' | 'recovered'
type VisualMode = 'normal' | 'fault' | 'healing' | 'recovered'
type ModuleState = 'wait' | 'probe' | 'ok' | 'err' | 'heal' | 'recovered'

interface Particle {
  isOrbital: boolean
  angle: number
  speed: number
  rxFactor: number
  ryFactor: number
  offsetX: number
  offsetY: number
  size: number
  alpha: number
  phase: number
  tint: 'white' | 'cyan' | 'violet'
}

interface BootState {
  active: boolean
  healMode: HealMode
  healElapsed: number
  healTotalAccum: number
  faultRecovered: boolean
  autoHealed: boolean
  welcomeMode: boolean
  welcomeElapsed: number
  elapsed: number
  ambientClock: number
  lastFrameTs: number
  rafId: number | null
  timers: number[]
}

const state: BootState = {
  active: false,
  healMode: 'none',
  healElapsed: 0,
  healTotalAccum: 0,
  faultRecovered: false,
  autoHealed: false,
  welcomeMode: false,
  welcomeElapsed: 0,
  elapsed: 0,
  ambientClock: 0,
  lastFrameTs: 0,
  rafId: null,
  timers: [],
}

/** Real probe outcome per check key; null until the probe batch settles. */
let probeResults: Record<string, boolean> | null = null

interface BootDom {
  boot: HTMLElement
  appRoot: HTMLElement | null
  stage: HTMLElement
  curtain: HTMLElement
  curtainClock: HTMLElement
  sweepBeam: HTMLElement
  hud: HTMLElement
  hudTopActions: HTMLElement
  hudScanTitle: HTMLElement
  hudMicroTL: HTMLElement
  hudFusionStrip: HTMLElement
  hudBarFill: HTMLElement
  hudDiagTicks: HTMLElement
  hudFaultCapsule: HTMLElement
  capsuleAlertView: HTMLElement
  capsuleAutoBadge: HTMLElement
  capsuleHealView: HTMLElement
  capsuleRecoveredView: HTMLElement
  healPct: HTMLElement
  healProgressFill: HTMLElement
  healStepEls: HTMLElement[]
  heroWrap: HTMLElement
  orbitBack: SVGGElement
  haloRot: SVGGElement
  rrWireframe: SVGGElement
  wireBig: SVGPathElement
  wireSmall: SVGPathElement
  rrSolid: SVGGElement
  rrSheenBar: SVGRectElement
  rrHealScanClipped: SVGRectElement
  healReticle: SVGGElement
  healRingOuter: SVGGElement
  healRingInner: SVGGElement
  healScanline: SVGGElement
  recoveryWave: SVGGElement
  orbitFront: SVGGElement
  swooshPlasma1: SVGPathElement
  swooshPlasma2: SVGPathElement
  starGroup: SVGGElement
  starInner: SVGGElement
  glitchCyan: SVGElement
  glitchViolet: SVGElement
  canvas: HTMLCanvasElement
  welcomeLayer: HTMLElement
  welcomeNote: HTMLElement
  btnWelcomeEnter: HTMLButtonElement
}

let dom: BootDom
let ctx: CanvasRenderingContext2D | null = null
let canvasW = 0
let canvasH = 0
const particles: Particle[] = []

const TITLE_SPAN_STYLE = 'font-family:\'JetBrains Mono\',monospace;font-size:0.86em;'

function bootWindow(): BootWindow {
  return window as BootWindow
}

function must(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`boot overlay markup is missing #${id}`)
  return node
}

function svg(id: string): SVGGElement {
  const node = must(id)
  if (!(node instanceof SVGGElement)) throw new Error(`boot overlay markup: #${id} is not an SVG group`)
  return node
}

function svgAny(id: string): SVGElement {
  const node = must(id)
  if (!(node instanceof SVGElement)) throw new Error(`boot overlay markup: #${id} is not an SVG element`)
  return node
}

function svgPath(id: string): SVGPathElement {
  const node = must(id)
  if (!(node instanceof SVGPathElement)) throw new Error(`boot overlay markup: #${id} is not an SVG path`)
  return node
}

/* -----------------------------------------------------------------------
   EASING & SAFE SVG LENGTH HELPERS
   ----------------------------------------------------------------------- */
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3)
const easeInOutCubic = (t: number): number => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
const easeOutBack = (t: number): number => {
  const x = clamp01(t)
  const c1 = 1.45
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

function safePathLength(el: SVGPathElement, fallback: number): number {
  try {
    const len = el.getTotalLength()
    if (Number.isFinite(len) && len > 0) return len
  } catch { /* getTotalLength can throw for detached or malformed paths */ }
  return fallback
}

let wireBigLen = 1180
let wireSmallLen = 760
let plasma1Len = 520
let plasma2Len = 360

function measurePaths(): void {
  wireBigLen = safePathLength(dom.wireBig, 1180)
  wireSmallLen = safePathLength(dom.wireSmall, 760)
  plasma1Len = safePathLength(dom.swooshPlasma1, 520)
  plasma2Len = safePathLength(dom.swooshPlasma2, 360)
  dom.wireBig.style.strokeDasharray = `${String(wireBigLen)}`
  dom.wireSmall.style.strokeDasharray = `${String(wireSmallLen)}`
  dom.swooshPlasma1.style.strokeDasharray = `120 ${String(plasma1Len)}`
  dom.swooshPlasma2.style.strokeDasharray = `85 ${String(plasma2Len)}`
}

/* -----------------------------------------------------------------------
   60FPS CANVAS STARDUST & ORBITAL BOKEH ENGINE
   ----------------------------------------------------------------------- */
function initParticles(): void {
  particles.length = 0
  for (let i = 0; i < 68; i++) {
    const isOrbital = i < 42
    particles.push({
      isOrbital,
      angle: Math.random() * Math.PI * 2,
      speed: (0.18 + Math.random() * 0.42) * (Math.random() > 0.15 ? 1 : -1),
      rxFactor: 0.72 + Math.random() * 0.58,
      ryFactor: 0.34 + Math.random() * 0.46,
      offsetX: (Math.random() - 0.5) * 1.15,
      offsetY: (Math.random() - 0.5) * 0.95,
      size: Math.random() < 0.22 ? (2.2 + Math.random() * 2.2) : (0.9 + Math.random() * 1.6),
      alpha: 0.32 + Math.random() * 0.68,
      phase: Math.random() * Math.PI * 2,
      tint: Math.random() < 0.5 ? 'white' : Math.random() < 0.72 ? 'cyan' : 'violet',
    })
  }
}

function resizeCanvas(): void {
  if (ctx === null) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvasW = window.innerWidth
  canvasH = window.innerHeight
  dom.canvas.width = Math.round(canvasW * dpr)
  dom.canvas.height = Math.round(canvasH * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function renderParticles(dtSec: number, progress01: number, visualMode: VisualMode): void {
  if (ctx === null || canvasW === 0 || canvasH === 0) return
  ctx.clearRect(0, 0, canvasW, canvasH)

  let visibility = 0
  if (progress01 < ACT.A1_END) {
    visibility = 0.28 * (progress01 / ACT.A1_END)
  } else if (progress01 < ACT.A2_END) {
    visibility = 0.28 + 0.72 * ((progress01 - ACT.A1_END) / (ACT.A2_END - ACT.A1_END))
  } else {
    visibility = 1
  }

  // Smoothly clear all particles when transitioning into the logo-only welcome stage.
  if (state.welcomeMode) {
    const clearFade = 1 - easeOutCubic(clamp01(state.welcomeElapsed / 420))
    visibility *= clearFade
  } else if (progress01 >= ACT.EXIT_START) {
    visibility *= Math.max(0, 1 - (progress01 - ACT.EXIT_START) / (1 - ACT.EXIT_START))
  }

  if (visibility <= 0.01) return

  const act4P = progress01 > ACT.A3_END ? clamp01((progress01 - ACT.A3_END) / (1 - ACT.A3_END)) : 0
  const isHealing = visualMode === 'healing'
  const isRecovered = visualMode === 'recovered'
  const isFault = visualMode === 'fault'

  let speedMult = 1 + act4P * 2.6
  let radiusPull = 1 - act4P * 0.28
  let dir = 1

  if (isHealing) {
    dir = -1
    speedMult = 2.15
    const healP = clamp01((state.healElapsed - HEAL.ALERT_END) / (HEAL.REPAIR_END - HEAL.ALERT_END))
    radiusPull = 0.94 - Math.sin(healP * Math.PI) * 0.2
  } else if (isRecovered) {
    const recP = clamp01((state.healElapsed - HEAL.REPAIR_END) / (HEAL.TOTAL - HEAL.REPAIR_END))
    speedMult = 1.85
    radiusPull = 0.88 + easeOutCubic(recP) * 0.22
  }

  const cx = canvasW * 0.5
  const cy = canvasH * 0.48
  const heroScale = Math.min(Math.max(Math.min(canvasW, canvasH) * 0.6, 270), 560) * 0.36
  const tilt = -0.33
  const cosT = Math.cos(tilt)
  const sinT = Math.sin(tilt)

  for (const p of particles) {
    p.angle += p.speed * dtSec * speedMult * dir
    p.phase += dtSec * (isHealing ? 4.2 : 2.6)

    let px: number
    let py: number
    if (p.isOrbital) {
      const lx = Math.cos(p.angle) * heroScale * p.rxFactor * radiusPull
      const ly = Math.sin(p.angle) * heroScale * p.ryFactor * radiusPull
      px = cx + lx * cosT - ly * sinT
      py = cy + lx * sinT + ly * cosT
    } else {
      const drift = Math.sin(p.phase * 0.5) * 8
      px = cx + p.offsetX * heroScale * 1.45 * radiusPull + drift
      py = cy + p.offsetY * heroScale * 1.35 * radiusPull - Math.cos(p.phase * 0.4) * 6
    }

    const twinkle = 0.55 + 0.45 * Math.sin(p.phase)
    const a = p.alpha * twinkle * visibility

    let fillStyle: string
    let glowStyle: string
    if (isFault) {
      fillStyle = p.tint === 'white'
        ? `rgba(255, 240, 210, ${String(a)})`
        : `rgba(255, 102, 56, ${String(a * 0.92)})`
      glowStyle = `rgba(255, 92, 62, ${String(a * 0.18)})`
    } else if (isHealing) {
      fillStyle = p.tint === 'violet'
        ? `rgba(255, 198, 66, ${String(a * 0.96)})`
        : p.tint === 'cyan'
          ? `rgba(56, 232, 255, ${String(a * 0.95)})`
          : `rgba(255, 246, 214, ${String(a)})`
      glowStyle = p.tint === 'cyan'
        ? `rgba(56, 232, 255, ${String(a * 0.22)})`
        : `rgba(245, 158, 11, ${String(a * 0.22)})`
    } else if (isRecovered) {
      fillStyle = p.tint === 'white'
        ? `rgba(235, 255, 248, ${String(a)})`
        : `rgba(38, 224, 172, ${String(a * 0.94)})`
      glowStyle = `rgba(45, 212, 191, ${String(a * 0.24)})`
    } else if (p.tint === 'white') {
      fillStyle = `rgba(255, 255, 255, ${String(a)})`
      glowStyle = `rgba(98, 198, 255, ${String(a * 0.18)})`
    } else if (p.tint === 'cyan') {
      fillStyle = `rgba(76, 224, 255, ${String(a * 0.9)})`
      glowStyle = `rgba(98, 198, 255, ${String(a * 0.18)})`
    } else {
      fillStyle = `rgba(126, 98, 255, ${String(a * 0.78)})`
      glowStyle = `rgba(98, 198, 255, ${String(a * 0.18)})`
    }

    ctx.beginPath()
    ctx.arc(px, py, p.size, 0, Math.PI * 2)
    ctx.fillStyle = fillStyle
    ctx.fill()

    if (p.size > 2.0) {
      ctx.beginPath()
      ctx.arc(px, py, p.size * 2.8, 0, Math.PI * 2)
      ctx.fillStyle = glowStyle
      ctx.fill()
    }
  }
}

/* -----------------------------------------------------------------------
   HUD BUILDERS & MODULE STATES
   ----------------------------------------------------------------------- */
function buildHudElements(): void {
  dom.hudDiagTicks.innerHTML = ''
  for (let i = 0; i < DIAG_TICK_COUNT; i++) {
    const tick = document.createElement('span')
    tick.className = 'diag-tick'
    dom.hudDiagTicks.appendChild(tick)
  }

  dom.hudFusionStrip.innerHTML = MODULES.map((m, i) => `
    <div class="fusion-mod flex items-center justify-between gap-1.5 rounded border b-hairline px-2 py-1 bg-[var(--bg-card)] backdrop-blur-sm" data-idx="${String(i)}">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="mod-dot h-1.5 w-1.5 rounded-full shrink-0" style="background: var(--hud-tick-off);"></span>
        <span class="font-mono text-[9px] sm:text-[9.5px] tracking-[0.06em] text-ink truncate">${m.label}</span>
      </div>
      <span class="mod-ms font-mono text-[9px] text-ink-muted tabular-nums shrink-0">--</span>
    </div>
  `).join('')
}

function updateModuleStates(act3P: number, visualMode: VisualMode): void {
  const slice = 1 / MODULES.length
  const statuses = MODULES.map((m, i) => {
    const local = (act3P - i * slice) / (slice * 0.9)
    if (i === 2) {
      if (visualMode === 'fault') return { state: 'err' as ModuleState, text: 'ERR 3090' }
      if (visualMode === 'healing') return { state: 'heal' as ModuleState, text: 'HEALING...' }
      if (visualMode === 'recovered' || (state.autoHealed && local >= 1)) {
        return { state: 'recovered' as ModuleState, text: 'FIXED 21ms' }
      }
    }
    if (local <= 0) return { state: 'wait' as ModuleState, text: '--' }
    if (local < 1) return { state: 'probe' as ModuleState, text: '...' }
    return { state: 'ok' as ModuleState, text: m.ms }
  })

  // Real probes own the end state: once the narrative is done, any module whose
  // endpoint is actually down flips to OFFLINE regardless of the story.
  if (state.autoHealed && probeResults !== null) {
    statuses.forEach((st, i) => {
      if (probeResults !== null && probeResults[MODULES[i].key] === false) {
        st.state = 'err'
        st.text = 'OFFLINE'
      }
    })
  }

  const modCards = dom.hudFusionStrip.children
  for (let i = 0; i < modCards.length; i++) {
    const card = modCards[i]
    const dot = card.querySelector<HTMLElement>('.mod-dot')
    const msEl = card.querySelector<HTMLElement>('.mod-ms')
    const st = statuses[i]
    if (dot === null || msEl === null) continue

    msEl.textContent = st.text
    if (st.state === 'ok') {
      dot.style.background = 'var(--status-ok)'
      msEl.style.color = 'var(--status-ok)'
    } else if (st.state === 'recovered') {
      dot.style.background = 'var(--status-recover)'
      msEl.style.color = 'var(--status-recover)'
    } else if (st.state === 'heal') {
      dot.style.background = 'var(--status-heal)'
      msEl.style.color = 'var(--status-heal)'
    } else if (st.state === 'probe') {
      dot.style.background = 'var(--accent)'
      msEl.style.color = 'var(--accent)'
    } else if (st.state === 'err') {
      dot.style.background = 'var(--status-err)'
      msEl.style.color = 'var(--status-err)'
    } else {
      dot.style.background = 'var(--hud-tick-off)'
      msEl.style.color = 'var(--ink-muted)'
    }
  }

  if (visualMode === 'fault') {
    dom.hudScanTitle.innerHTML = `SELF_CHECK_SCAN <span style="color:var(--status-err);${TITLE_SPAN_STYLE}">// FAULT_3090</span>`
  } else if (visualMode === 'healing') {
    dom.hudScanTitle.innerHTML = `SELF_HEAL_SCAN <span style="color:var(--status-heal);${TITLE_SPAN_STYLE}">// AUTO_REPAIR</span>`
  } else if (visualMode === 'recovered') {
    dom.hudScanTitle.innerHTML = `SELF_CHECK_SCAN <span style="color:var(--status-recover);${TITLE_SPAN_STYLE}">// RECOVERED</span>`
  } else {
    dom.hudScanTitle.textContent = 'SELF_CHECK_SCAN'
  }

  let nodeLine = 'FASTIFY HANDSHAKE OK'
  if (visualMode === 'fault') {
    nodeLine = '<span style="color:var(--status-err);font-weight:600;">TIMEOUT ERR (3090)</span>'
  } else if (visualMode === 'healing') {
    nodeLine = '<span style="color:var(--status-heal);font-weight:600;">AUTO-REPAIR IN PROGRESS</span>'
  } else if (visualMode === 'recovered' || state.autoHealed) {
    nodeLine = '<span style="color:var(--status-recover);font-weight:600;">AUTO-HEALED · 21ms OK</span>'
  }
  dom.hudMicroTL.innerHTML = `
    <div>SYS.BOOT // RUIRUIAI-FUTURE-CUP</div>
    <div>NODE.3090 // ${nodeLine}</div>
    <div>ARCHIVE.ID // FC-2026-SCAN-04</div>
  `
}

/* -----------------------------------------------------------------------
   FAULT CAPSULE & VISUAL MODE
   ----------------------------------------------------------------------- */
function updateHealCapsuleUI(visualMode: VisualMode): void {
  const showCapsule = visualMode !== 'normal' && !state.welcomeMode
  dom.hudFaultCapsule.classList.toggle('hidden', !showCapsule)
  if (!showCapsule) {
    dom.hudFaultCapsule.style.opacity = ''
    dom.hudFaultCapsule.style.transform = ''
    return
  }

  dom.hudFaultCapsule.classList.remove('capsule-alert', 'capsule-healing', 'capsule-recovered')
  dom.capsuleAlertView.classList.add('hidden')
  dom.capsuleHealView.classList.add('hidden')
  dom.capsuleRecoveredView.classList.add('hidden')

  if (visualMode === 'fault') {
    dom.hudFaultCapsule.classList.add('capsule-alert')
    dom.capsuleAlertView.classList.remove('hidden')
    dom.capsuleAutoBadge.classList.remove('hidden')
    dom.hudFaultCapsule.style.opacity = '1'
    dom.hudFaultCapsule.style.transform = 'translateY(0)'
  } else if (visualMode === 'healing') {
    dom.hudFaultCapsule.classList.add('capsule-healing')
    dom.capsuleHealView.classList.remove('hidden')
    dom.hudFaultCapsule.style.opacity = '1'
    dom.hudFaultCapsule.style.transform = 'translateY(0)'

    const repairP = clamp01((state.healElapsed - HEAL.ALERT_END) / (HEAL.REPAIR_END - HEAL.ALERT_END))
    dom.healPct.textContent = `${String(Math.round(repairP * 100))}%`
    dom.healProgressFill.style.transform = `scaleX(${repairP.toFixed(4)})`

    HEAL_STEPS.forEach((step, idx) => {
      const row = dom.healStepEls[idx]
      const badge = row.querySelector<HTMLElement>('.step-badge')
      const labelEl = row.firstElementChild
      if (badge === null) return
      if (state.healElapsed >= step.end) {
        badge.textContent = step.done
        badge.style.background = 'var(--status-recover-bg)'
        badge.style.color = 'var(--status-recover)'
        if (labelEl instanceof HTMLElement) labelEl.style.color = 'var(--ink-primary)'
      } else if (state.healElapsed >= step.start) {
        badge.textContent = step.running
        badge.style.background = 'var(--status-heal-bg)'
        badge.style.color = 'var(--status-heal)'
        if (labelEl instanceof HTMLElement) labelEl.style.color = 'var(--ink-primary)'
      } else {
        badge.textContent = 'WAIT'
        badge.style.background = 'transparent'
        badge.style.color = 'var(--ink-muted)'
        if (labelEl instanceof HTMLElement) labelEl.style.color = 'var(--ink-muted)'
      }
    })
  } else if (visualMode === 'recovered') {
    dom.hudFaultCapsule.classList.add('capsule-recovered')
    dom.capsuleRecoveredView.classList.remove('hidden')

    const recP = clamp01((state.healElapsed - HEAL.REPAIR_END) / (HEAL.TOTAL - HEAL.REPAIR_END))
    const fadeOut = recP > 0.74 ? 1 - clamp01((recP - 0.74) / 0.26) : 1
    dom.hudFaultCapsule.style.opacity = fadeOut.toFixed(3)
    dom.hudFaultCapsule.style.transform = `translateY(${((1 - fadeOut) * 6).toFixed(1)}px)`
  }
}

function getCurrentVisualMode(): VisualMode {
  if (state.welcomeMode) return 'normal'
  if (state.healMode === 'alert') return 'fault'
  if (state.healMode === 'healing') return 'healing'
  if (state.healMode === 'recovered') return 'recovered'
  return 'normal'
}

/* -----------------------------------------------------------------------
   CORE DETERMINISTIC FRAME RENDERER
   ----------------------------------------------------------------------- */
function renderFrameAt(elapsedMs: number, ambientSec: number): void {
  const p = clamp01(elapsedMs / DURATION_MS)
  const visualMode = getCurrentVisualMode()
  const isFault = visualMode === 'fault'
  const isHealing = visualMode === 'healing'
  const isRecovered = visualMode === 'recovered'

  // Welcome stage clearing & logo levitation progress
  const clearEase = state.welcomeMode ? easeOutCubic(clamp01(state.welcomeElapsed / 440)) : 0
  const logoShiftEase = state.welcomeMode ? easeInOutCubic(clamp01((state.welcomeElapsed - 90) / 560)) : 0
  const keepNonLogo = 1 - clearEase

  dom.boot.classList.toggle('is-fault-state', isFault)
  dom.boot.classList.toggle('is-healing-state', isHealing)
  dom.boot.classList.toggle('is-recovered-state', isRecovered)
  updateHealCapsuleUI(visualMode)

  // Show the clean welcome layer smoothly after the HUD & orbitals clear away
  const showWelcomeUI = state.welcomeMode && state.welcomeElapsed >= 260
  dom.welcomeLayer.classList.toggle('welcome-visible', showWelcomeUI)
  dom.hudTopActions.style.pointerEvents = state.welcomeMode ? 'none' : 'auto'

  // Curtain clock (the only remaining on-screen time readout)
  const liveClockMs = elapsedMs + state.healTotalAccum
  dom.curtainClock.textContent = `${(liveClockMs / 1000).toFixed(2)}s`

  /* --- ACT 1: 0% -> 16% (Dark Curtain + Wireframe RR) --- */
  const a1P = clamp01(p / ACT.A1_END)
  const wireDrawBig = easeOutCubic(clamp01(a1P / 0.85))
  const wireDrawSmall = easeOutCubic(clamp01((a1P - 0.16) / 0.84))
  dom.wireBig.style.strokeDashoffset = `${String(wireBigLen * (1 - wireDrawBig))}`
  dom.wireSmall.style.strokeDashoffset = `${String(wireSmallLen * (1 - wireDrawSmall))}`

  /* --- ACT 2: 16% -> 36% (Diagonal Sweep -> Warm Paper Stage + HUD Frame) --- */
  const a2P = p <= ACT.A1_END ? 0 : clamp01((p - ACT.A1_END) / (ACT.A2_END - ACT.A1_END))
  const stageReveal = easeInOutCubic(clamp01((a2P - 0.12) / 0.68))
  dom.stage.style.opacity = String(stageReveal)
  dom.curtain.style.opacity = String(1 - stageReveal)

  if (a2P > 0 && a2P < 1) {
    const sweepX = -42 + easeInOutCubic(a2P) * 320
    const beamAlpha = Math.sin(a2P * Math.PI) * 0.88
    dom.sweepBeam.style.transform = `translate3d(${sweepX.toFixed(2)}%, 0, 0) skewX(-22deg)`
    dom.sweepBeam.style.opacity = String(beamAlpha)
  } else {
    dom.sweepBeam.style.opacity = '0'
  }

  // HUD Frame smooth entry -> clean fade out on the welcome stage
  const hudAlpha = easeOutCubic(clamp01((a2P - 0.25) / 0.75)) * keepNonLogo
  dom.hud.style.opacity = hudAlpha.toFixed(3)

  /* --- ACT 3: 36% -> 82% (3D Embossed RR + Orbitals + Star + Scan) --- */
  const a3P = p <= ACT.A2_END ? 0 : clamp01((p - ACT.A2_END) / (ACT.A3_END - ACT.A2_END))

  const solidP = clamp01((p - (ACT.A2_END - 0.06)) / 0.18)
  const solidEase = easeOutCubic(solidP)
  dom.rrSolid.style.opacity = String(state.welcomeMode ? 1 : solidEase)
  dom.rrWireframe.style.opacity = String(state.welcomeMode ? 0 : Math.max(0, 1 - solidEase * 1.35))

  // Gentle floating motion on the 3D RR
  const floatY = state.welcomeMode
    ? (Math.sin(ambientSec * 2.1) * 3.2 * (1 - logoShiftEase))
    : (solidP >= 1 ? Math.sin(ambientSec * 2.1) * 4.5 : (1 - solidEase) * 10)
  const solidScale = state.welcomeMode ? 1 : (0.94 + 0.06 * easeOutBack(solidP))
  dom.rrSolid.style.transform = `translate3d(0, ${floatY.toFixed(2)}px, 0) scale(${solidScale.toFixed(4)})`

  // Specular gloss sheen sweep (plus periodic subtle ceramic glints on the welcome stage)
  if (state.welcomeMode) {
    const cycle = (state.welcomeElapsed % 3600) / 3600
    const sheenWin = clamp01((cycle - 0.15) / 0.28)
    const sheenX = -150 + easeInOutCubic(sheenWin) * 580
    dom.rrSheenBar.setAttribute('transform', `translate(${sheenX.toFixed(1)}, 0) skewX(-24)`)
  } else {
    const sheenWindow = clamp01((a3P - 0.08) / 0.52)
    const sheenX = -150 + easeInOutCubic(sheenWindow) * 580
    dom.rrSheenBar.setAttribute('transform', `translate(${sheenX.toFixed(1)}, 0) skewX(-24)`)
  }

  // Orbital halo & front/back blue-violet swooshes (cleared smoothly on the welcome stage)
  const orbitIn = easeOutCubic(clamp01((p - (ACT.A2_END - 0.04)) / 0.22))
  const act4P = p <= ACT.A3_END ? 0 : clamp01((p - ACT.A3_END) / (1 - ACT.A3_END))
  const orbitPull = (1 - easeInOutCubic(act4P) * 0.16) * (1 - clearEase * 0.14)

  let orbitRot = (1 - orbitIn) * -28 + Math.sin(ambientSec * 1.4) * 1.6 + act4P * 18
  let haloDeg = (ambientSec * 18 + act4P * 75) % 360
  let flowSpeed = 240 + act4P * 520
  let flowDir = -1

  if (isFault) {
    flowSpeed = 130
  } else if (isHealing) {
    const healSec = (state.healElapsed - HEAL.ALERT_END) / 1000
    orbitRot = -Math.sin(healSec * 3.2) * 5.5 - healSec * 12
    haloDeg = ((-ambientSec * 52) % 360 + 360) % 360
    flowSpeed = 520
    flowDir = 1
  } else if (isRecovered) {
    flowSpeed = 420
  }

  dom.orbitBack.style.opacity = (orbitIn * keepNonLogo).toFixed(3)
  dom.orbitBack.style.transform = `scale(${((0.84 + 0.16 * orbitIn) * orbitPull).toFixed(4)}) rotate(${(orbitRot * 0.45).toFixed(2)}deg)`
  dom.haloRot.style.transform = `rotate(${haloDeg.toFixed(2)}deg)`

  dom.orbitFront.style.opacity = (orbitIn * keepNonLogo).toFixed(3)
  dom.orbitFront.style.transform = `scale(${((0.86 + 0.14 * orbitIn) * orbitPull).toFixed(4)}) rotate(${(orbitRot * 0.25).toFixed(2)}deg)`

  dom.swooshPlasma1.style.strokeDashoffset = `${String(flowDir * ((ambientSec * flowSpeed) % (plasma1Len + 120)))}`
  dom.swooshPlasma2.style.strokeDashoffset = `${String(flowDir * ((ambientSec * flowSpeed * 1.25 + 140) % (plasma2Len + 85)))}`

  // 4-point electric cyan sparkle star (cleared smoothly on the welcome stage)
  const starIn = easeOutBack(clamp01((p - ACT.A2_END) / 0.16))
  const starPulse = 1 + Math.sin(ambientSec * (isHealing ? 7.5 : 4.2)) * (isRecovered ? 0.16 : 0.085)
  const starSpin = Math.sin(ambientSec * 1.6) * 6 + act4P * 45 + (isHealing ? -ambientSec * 45 : 0)
  dom.starGroup.style.opacity = (clamp01(starIn) * keepNonLogo).toFixed(3)
  dom.starInner.setAttribute('transform', `scale(${(starIn * starPulse * orbitPull).toFixed(3)}) rotate(${starSpin.toFixed(2)})`)

  /* --- STAGE 2: DIAGNOSTIC RETICLE RING & LASER SCANLINE --- */
  if (isHealing && !state.welcomeMode) {
    const healP = clamp01((state.healElapsed - HEAL.ALERT_END) / (HEAL.REPAIR_END - HEAL.ALERT_END))
    const fadeIn = easeOutCubic(clamp01(healP / 0.14))
    const fadeOut = healP > 0.88 ? 1 - clamp01((healP - 0.88) / 0.12) : 1
    const diagAlpha = fadeIn * fadeOut

    dom.healReticle.style.opacity = diagAlpha.toFixed(3)
    const outerAngle = (state.healElapsed * 0.07) % 360
    const innerAngle = (-state.healElapsed * 0.11) % 360
    dom.healRingOuter.style.transform = `rotate(${outerAngle.toFixed(1)}deg) scale(${(0.96 + 0.04 * fadeIn).toFixed(3)})`
    dom.healRingInner.style.transform = `rotate(${innerAngle.toFixed(1)}deg)`

    const sweepCycle = (Math.sin(healP * Math.PI * 3 - Math.PI / 2) + 1) * 0.5
    const scanY = 104 + sweepCycle * 214
    dom.healScanline.style.opacity = (diagAlpha * 0.96).toFixed(3)
    dom.healScanline.setAttribute('transform', `translate(0, ${scanY.toFixed(1)})`)
    dom.rrHealScanClipped.style.opacity = (diagAlpha * 0.92).toFixed(3)
    dom.rrHealScanClipped.setAttribute('y', (scanY - 22).toFixed(1))
  } else {
    dom.healReticle.style.opacity = '0'
    dom.healScanline.style.opacity = '0'
    dom.rrHealScanClipped.style.opacity = '0'
  }

  /* --- STAGE 3: EMERALD-CYAN RECOVERY PULSE RING --- */
  if (isRecovered && !state.welcomeMode) {
    const recP = clamp01((state.healElapsed - HEAL.REPAIR_END) / (HEAL.TOTAL - HEAL.REPAIR_END))
    const waveScale = 0.34 + easeOutCubic(recP) * 1.32
    const waveAlpha = Math.sin(clamp01(recP / 0.86) * Math.PI) * 0.92
    dom.recoveryWave.style.opacity = waveAlpha.toFixed(3)
    dom.recoveryWave.style.transform = `scale(${waveScale.toFixed(3)})`
  } else {
    dom.recoveryWave.style.opacity = '0'
  }

  // Progress bar + diagonal ticks + footer rail
  const scanProgress = p < ACT.A2_END
    ? (a2P * 0.14)
    : (0.14 + a3P * 0.86)
  dom.hudBarFill.style.transform = `scaleX(${scanProgress.toFixed(4)})`

  const litTicks = Math.round(scanProgress * DIAG_TICK_COUNT)
  const tickNodes = dom.hudDiagTicks.children
  const healWavePos = isHealing
    ? ((state.healElapsed - HEAL.ALERT_END) / 48) % Math.max(litTicks, 1)
    : -10

  for (let i = 0; i < tickNodes.length; i++) {
    const tick = tickNodes[i]
    const isLit = i < litTicks
    const inHealWave = isHealing && isLit && Math.abs(i - healWavePos) < 4.5
    tick.classList.toggle('lit', isLit && !isFault && !inHealWave && !isRecovered)
    tick.classList.toggle('err', isLit && isFault && i >= litTicks - 6)
    tick.classList.toggle('healing', inHealWave)
    tick.classList.toggle('recovered', isLit && isRecovered)
  }

  updateModuleStates(a3P, visualMode)

  /* --- ACT 4 & STAGE 1 MICRO-SHAKE + WELCOME LOGO ELEVATION & FLOAT --- */
  const heroScaleOut = 1 - easeInOutCubic(act4P) * 0.045
  let shakeX = 0
  let shakeY = 0
  let stage1Glitch = 0

  if (state.healMode === 'alert' && state.healElapsed < 220) {
    const shP = state.healElapsed / 220
    const decay = 1 - shP
    shakeX = Math.sin(shP * Math.PI * 10) * 5.5 * decay
    shakeY = Math.cos(shP * Math.PI * 8) * 2.2 * decay
    stage1Glitch = decay
  }

  // Elevate the centered RR logo smoothly & gently float in the welcome stage
  const finalHeroY = -4 - logoShiftEase * 14
  const welcomeFloatPx = state.welcomeMode
    ? Math.sin((state.welcomeElapsed / 1000) * 2.1) * 10 * logoShiftEase
    : 0
  const finalHeroScale = state.welcomeMode
    ? (heroScaleOut + logoShiftEase * (0.92 - heroScaleOut))
    : heroScaleOut

  dom.heroWrap.style.transform = `translate3d(${shakeX.toFixed(1)}px, calc(${finalHeroY.toFixed(2)}% + ${(shakeY + welcomeFloatPx).toFixed(2)}px), 0) scale(${finalHeroScale.toFixed(4)})`

  // RGB chromatic dispersion split (stage-1 crimson impact or act-4 finale)
  if (!state.welcomeMode && stage1Glitch > 0.02) {
    const shift = 6.5 * stage1Glitch
    dom.glitchCyan.classList.add('fault-crimson')
    dom.glitchViolet.classList.add('fault-crimson')
    dom.glitchCyan.style.opacity = (stage1Glitch * 0.55).toFixed(3)
    dom.glitchCyan.style.transform = `translate3d(${(-shift).toFixed(1)}px, ${(shift * 0.25).toFixed(1)}px, 0)`
    dom.glitchViolet.style.opacity = (stage1Glitch * 0.65).toFixed(3)
    dom.glitchViolet.style.transform = `translate3d(${shift.toFixed(1)}px, ${(-shift * 0.2).toFixed(1)}px, 0)`
  } else if (!state.welcomeMode && p >= ACT.GLITCH_START && p <= ACT.EXIT_START + 0.04) {
    dom.glitchCyan.classList.remove('fault-crimson')
    dom.glitchViolet.classList.remove('fault-crimson')
    const gP = clamp01((p - ACT.GLITCH_START) / (ACT.EXIT_START - ACT.GLITCH_START))
    const wave = Math.sin(gP * Math.PI)
    const jitter = Math.sin(gP * Math.PI * 5)
    const shift = 7.5 * wave * (jitter >= 0 ? 1 : -0.75)
    dom.glitchCyan.style.opacity = (wave * 0.65).toFixed(3)
    dom.glitchCyan.style.transform = `translate3d(${(-shift).toFixed(1)}px, ${(shift * 0.22).toFixed(1)}px, 0)`
    dom.glitchViolet.style.opacity = (wave * 0.65).toFixed(3)
    dom.glitchViolet.style.transform = `translate3d(${shift.toFixed(1)}px, ${(-shift * 0.22).toFixed(1)}px, 0)`
  } else {
    dom.glitchCyan.style.opacity = '0'
    dom.glitchViolet.style.opacity = '0'
    dom.glitchCyan.classList.remove('fault-crimson')
    dom.glitchViolet.classList.remove('fault-crimson')
  }
}

/* -----------------------------------------------------------------------
   PLAYBACK LOOP, SELF-HEAL & WELCOME LIFECYCLE
   ----------------------------------------------------------------------- */
function clearTimers(): void {
  state.timers.forEach((id) => { window.clearTimeout(id) })
  state.timers = []
}

function addTimer(fn: () => void, ms: number): number {
  const id = window.setTimeout(fn, ms)
  state.timers.push(id)
  return id
}

function stopLoop(): void {
  if (state.rafId !== null) {
    window.cancelAnimationFrame(state.rafId)
    state.rafId = null
  }
  clearTimers()
}

let finished = false
let appReady = false
let pendingEnter = false
let keydownBound = false

function detachKeys(): void {
  if (!keydownBound) return
  keydownBound = false
  window.removeEventListener('keydown', onKeydown)
}

function finishBoot(): void {
  stopLoop()
  if (finished || !state.active) return
  finished = true
  state.active = false
  state.healMode = 'none'
  state.welcomeMode = false
  detachKeys()
  dom.welcomeLayer.classList.remove('welcome-visible')

  dom.boot.style.opacity = ''
  dom.boot.style.transform = ''
  dom.boot.classList.add('boot-exiting')

  if (dom.appRoot !== null) {
    dom.appRoot.removeAttribute('inert')
    dom.appRoot.removeAttribute('aria-hidden')
  }
  document.body.style.overflow = ''
  window.removeEventListener('resize', resizeCanvas)
  writePlayedRecord()
  window.setTimeout(() => {
    dom.boot.classList.add('boot-hidden')
    dom.boot.classList.remove('boot-exiting', 'is-fault-state', 'is-healing-state', 'is-recovered-state')
    if (dom.boot.parentNode !== null) dom.boot.parentNode.removeChild(dom.boot)
    document.documentElement.classList.remove('fc-boot-armed')
  }, 440)
}

function onReady(): void {
  appReady = true
  if (pendingEnter) finishBoot()
}

function requestEnter(): void {
  if (!state.active) return
  if (!appReady) {
    pendingEnter = true
    dom.btnWelcomeEnter.disabled = true
    dom.btnWelcomeEnter.querySelector('span')?.replaceChildren('正在进入工作台…')
    return
  }
  finishBoot()
}

function updateWelcomeNote(): void {
  if (probeResults === null) return
  const failed = MODULES.filter(m => probeResults !== null && probeResults[m.key] === false).length
  if (failed === 0) {
    dom.welcomeNote.classList.add('hidden')
    return
  }
  dom.welcomeNote.classList.remove('hidden')
  dom.welcomeNote.textContent = `${String(failed)} 项服务未就绪 · 仍可进入`
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && state.welcomeMode) {
    event.preventDefault()
    requestEnter()
  }
}

function writePlayedRecord(): void {
  const config = bootWindow().__FC_BOOT__
  if (config === undefined) return
  try {
    const played = JSON.stringify({ version: config.version, at: Date.now() })
    window.localStorage.setItem(config.key, played)
    window.sessionStorage.setItem(config.key, played)
  } catch { /* storage can be unavailable; the in-memory run still finishes */ }
}

/** Probe every real endpoint once, in parallel; theater timing is untouched. */
async function runProbes(): Promise<void> {
  const results = await Promise.all(CHECKS.map(async (check) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => { controller.abort() }, 1200)
    try {
      const response = await fetch(check.url, { signal: controller.signal, headers: { accept: 'application/json' } })
      return response.ok
    } catch {
      return false
    } finally {
      window.clearTimeout(timeout)
    }
  }))
  const settled: Record<string, boolean> = {}
  CHECKS.forEach((check, i) => {
    settled[check.key] = results[i]
  })
  probeResults = settled
  updateWelcomeNote()
}

function frameLoop(now: number): void {
  if (!state.active) return

  const dtMs = state.lastFrameTs !== 0 ? Math.min(now - state.lastFrameTs, 50) : 16.6
  state.lastFrameTs = now
  const dtSec = dtMs / 1000
  state.ambientClock += dtSec

  if (state.welcomeMode) {
    // Logo-only welcome stage: float the logo and await click / Enter.
    state.welcomeElapsed += dtMs
  } else if (state.healMode !== 'none') {
    // Scripted fault → self-repair → recovery sequence.
    state.healElapsed += dtMs
    state.healTotalAccum += dtMs

    if (state.healElapsed < HEAL.ALERT_END) {
      state.healMode = 'alert'
    } else if (state.healElapsed < HEAL.REPAIR_END) {
      state.healMode = 'healing'
    } else if (state.healElapsed < HEAL.TOTAL) {
      state.healMode = 'recovered'
    } else {
      state.healMode = 'none'
      state.faultRecovered = true
      state.autoHealed = true
    }
  } else {
    // Normal four-act main timeline progression.
    state.elapsed += dtMs

    const faultTriggerMs = DURATION_MS * (ACT.A2_END + (ACT.A3_END - ACT.A2_END) * 0.66)
    if (!state.faultRecovered && state.elapsed >= faultTriggerMs) {
      state.elapsed = faultTriggerMs
      state.healMode = 'alert'
      state.healElapsed = 0
    }

    // Transition smoothly into the logo-only welcome stage instead of auto-closing.
    if (state.healMode === 'none' && state.elapsed >= DURATION_MS * ACT.EXIT_START) {
      state.elapsed = DURATION_MS * ACT.EXIT_START
      state.welcomeMode = true
      state.welcomeElapsed = 0
      updateWelcomeNote()
    }
  }

  const visualMode = getCurrentVisualMode()
  renderFrameAt(state.elapsed, state.ambientClock)
  renderParticles(dtSec, clamp01(state.elapsed / DURATION_MS), visualMode)

  state.rafId = window.requestAnimationFrame(frameLoop)
}

function startBoot(): void {
  stopLoop()
  finished = false
  pendingEnter = false
  state.active = true
  state.healMode = 'none'
  state.healElapsed = 0
  state.healTotalAccum = 0
  state.faultRecovered = false
  state.autoHealed = false
  state.welcomeMode = false
  state.welcomeElapsed = 0
  state.elapsed = 0
  state.lastFrameTs = 0

  dom.welcomeLayer.classList.remove('welcome-visible')
  dom.welcomeNote.classList.add('hidden')
  dom.btnWelcomeEnter.disabled = false
  dom.btnWelcomeEnter.querySelector('span')?.replaceChildren('点击进入工作台')
  dom.boot.classList.remove('boot-hidden', 'boot-exiting', 'is-fault-state', 'is-healing-state', 'is-recovered-state')
  dom.boot.style.opacity = ''
  dom.boot.style.transform = ''

  if (dom.appRoot !== null) {
    dom.appRoot.setAttribute('inert', '')
    dom.appRoot.setAttribute('aria-hidden', 'true')
  }
  document.body.style.overflow = 'hidden'

  writePlayedRecord()
  void runProbes()

  window.addEventListener('future-cup:ready', onReady, { once: true })
  if (bootWindow().__FC_APP_READY__ === true) onReady()
  if (!keydownBound) {
    keydownBound = true
    window.addEventListener('keydown', onKeydown)
  }
  dom.btnWelcomeEnter.addEventListener('click', requestEnter)

  window.addEventListener('resize', resizeCanvas)

  renderFrameAt(state.elapsed, state.ambientClock)
  state.rafId = window.requestAnimationFrame(frameLoop)

  // Independent hard failsafes, suspended while the welcome stage waits for input.
  addTimer(() => {
    if (state.active && !state.welcomeMode && state.healMode === 'none') finishBoot()
  }, 8000)
  addTimer(() => {
    if (state.active && !state.welcomeMode) finishBoot()
  }, 12000)
}

function gatherDom(): BootDom {
  const healStepEls = [must('heal-step-0'), must('heal-step-1'), must('heal-step-2')]
  const canvas = must('boot-particles')
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('boot overlay markup: #boot-particles is not a canvas')
  const welcomeEnter = must('btn-welcome-enter')
  if (!(welcomeEnter instanceof HTMLButtonElement)) throw new Error('boot overlay markup: #btn-welcome-enter is not a button')
  return {
    boot: must('fc-boot'),
    appRoot: document.getElementById('root'),
    stage: must('boot-stage'),
    curtain: must('boot-curtain'),
    curtainClock: must('curtain-clock'),
    sweepBeam: must('boot-sweep-beam'),
    hud: must('boot-hud'),
    hudTopActions: must('hud-top-actions'),
    hudScanTitle: must('hud-scan-title'),
    hudMicroTL: must('hud-micro-tl'),
    hudFusionStrip: must('hud-fusion-strip'),
    hudBarFill: must('hud-bar-fill'),
    hudDiagTicks: must('hud-diag-ticks'),
    hudFaultCapsule: must('hud-fault-capsule'),
    capsuleAlertView: must('capsule-alert-view'),
    capsuleAutoBadge: must('capsule-auto-badge'),
    capsuleHealView: must('capsule-heal-view'),
    capsuleRecoveredView: must('capsule-recovered-view'),
    healPct: must('heal-pct'),
    healProgressFill: must('heal-progress-fill'),
    healStepEls,
    heroWrap: must('hero-emblem-wrap'),
    orbitBack: svg('svg-orbit-back'),
    haloRot: svg('svg-halo-rot'),
    rrWireframe: svg('svg-rr-wireframe'),
    wireBig: svgPath('wire-rr-big'),
    wireSmall: svgPath('wire-rr-small'),
    rrSolid: svg('svg-rr-solid'),
    rrSheenBar: (() => {
      const node = must('rr-sheen-bar')
      if (!(node instanceof SVGRectElement)) throw new Error('boot overlay markup: #rr-sheen-bar is not an SVG rect')
      return node
    })(),
    rrHealScanClipped: (() => {
      const node = must('rr-heal-scan-clipped')
      if (!(node instanceof SVGRectElement)) throw new Error('boot overlay markup: #rr-heal-scan-clipped is not an SVG rect')
      return node
    })(),
    healReticle: svg('svg-heal-reticle'),
    healRingOuter: svg('svg-heal-ring-outer'),
    healRingInner: svg('svg-heal-ring-inner'),
    healScanline: svg('rr-heal-scanline'),
    recoveryWave: svg('svg-recovery-wave'),
    orbitFront: svg('svg-orbit-front'),
    swooshPlasma1: svgPath('swoosh-plasma-1'),
    swooshPlasma2: svgPath('swoosh-plasma-2'),
    starGroup: svg('svg-star-group'),
    starInner: svg('svg-star-inner'),
    glitchCyan: svgAny('rr-glitch-cyan'),
    glitchViolet: svgAny('rr-glitch-violet'),
    canvas,
    welcomeLayer: must('boot-welcome-layer'),
    welcomeNote: must('welcome-health-note'),
    btnWelcomeEnter: welcomeEnter,
  }
}

/** Remove the boot overlay and hand the page back to the application. */
function tearDownBootOverlay(): void {
  const overlay = document.getElementById('fc-boot')
  if (overlay !== null && overlay.parentNode !== null) overlay.parentNode.removeChild(overlay)
  document.documentElement.classList.remove('fc-boot-armed')
  document.body.style.overflow = ''
  const appRoot = document.getElementById('root')
  if (appRoot !== null) {
    appRoot.removeAttribute('inert')
    appRoot.removeAttribute('aria-hidden')
  }
}

/**
 * Replay the boot animation in place: insert the overlay markup template,
 * rebuild the DOM handles and run the same controller from frame zero. Works
 * on any load — including ones where the animation never armed (noboot flag,
 * reduced motion, six-hour skip) — because the template ships in the bundle.
 */
function replayBoot(): void {
  if (document.getElementById('fc-boot') !== null) return
  document.body.insertAdjacentHTML('beforeend', bootOverlayMarkup)
  document.documentElement.classList.add('fc-boot-armed')
  try {
    dom = gatherDom()
    ctx = dom.canvas.getContext('2d')
    initParticles()
    resizeCanvas()
    buildHudElements()
    measurePaths()
    startBoot()
  } catch (err) {
    console.error('[boot] replay failed to start; tearing the overlay down', err)
    tearDownBootOverlay()
  }
}

bootWindow().__FC_BOOT_REPLAY__ = replayBoot

const config = bootWindow().__FC_BOOT__
if (config !== undefined && config.play === true) {
  bootWindow().__FC_BOOT_RUNNING__ = true
  try {
    dom = gatherDom()
    ctx = dom.canvas.getContext('2d')
    initParticles()
    resizeCanvas()
    buildHudElements()
    measurePaths()
    startBoot()
  } catch (err) {
    // Fail loud but never brick the page: tear the overlay down so the app shows.
    console.error('[boot] overlay failed to start; skipping boot animation', err)
    tearDownBootOverlay()
  }
}
