/** Browser bridge from the Future Cup REST/Socket.IO data plane into the standalone HQ scene. */

import { io, type Socket } from 'socket.io-client'
import { agentSchema } from '../api/contracts.ts'
import type { AgentView } from '../api/contracts.ts'
import { animationActionsForTransition } from './animation.ts'
import type { HqAnimationAction } from './animation.ts'
import {
  applyProductEvent,
  createProjection,
  needsSnapshotResync,
  parseProductEvent,
  parseSnapshot,
} from './projection.ts'
import type { HqProjection } from './projection.ts'

interface HqRealAdapter {
  readonly apply: (projection: HqProjection) => void
  readonly animate: (action: HqAnimationAction) => void
  readonly setStatus: (status: string, detail?: string) => void
  readonly error: (message: string) => void
}

interface HqRealHost extends HTMLElement {
  readonly __real?: HqRealAdapter
}

const projectId = new URLSearchParams(window.location.search).get('projectId')?.trim()
const host = document.getElementById('host-hq') as HqRealHost | null
const adapter = host?.__real

if (projectId === undefined || projectId === '') {
  adapter?.error('缺少 projectId；请从平台项目页打开 HQ 大屏')
} else if (adapter === undefined) {
  showFatal('HQ 真实事件适配器尚未初始化')
} else {
  void start(projectId, adapter).catch((error: unknown) => {
    console.error(error)
    adapter.error(errorMessage(error))
  })
}

async function start(projectId: string, adapter: HqRealAdapter): Promise<void> {
  let projection = await loadProjection(projectId)
  adapter.apply(projection)
  adapter.setStatus('connecting', '等待 Socket.IO')
  const socket = createSocket(projectId, projection.lastEventSeq)
  let resyncing = false

  const resync = async (): Promise<void> => {
    if (resyncing) return
    resyncing = true
    socket.disconnect()
    adapter.setStatus('reconnecting', '正在重新同步')
    try {
      const next = await loadProjection(projectId)
      projection = next
      adapter.apply(projection)
      socket.auth = { projectId, afterSeq: projection.lastEventSeq }
      socket.connect()
    } catch (error: unknown) {
      adapter.error(errorMessage(error))
    } finally {
      resyncing = false
    }
  }

  socket.on('connect', () => {
    socket.auth = { projectId, afterSeq: projection.lastEventSeq }
    adapter.setStatus('live', `事件 ${projection.lastEventSeq}`)
  })
  socket.on('disconnect', (reason) => {
    adapter.setStatus('reconnecting', reason)
  })
  socket.on('sync.snapshot', async (value: unknown) => {
    const snapshot = parseSnapshot(value)
    if (snapshot === undefined) {
      adapter.error('收到无法识别的项目快照')
      return
    }
    try {
      const next = createProjection(snapshot, await loadAgents(projectId))
      if (next.lastEventSeq < projection.lastEventSeq) return
      projection = next
    } catch (error: unknown) {
      console.error(error)
      adapter.error(errorMessage(error))
      return
    }
    adapter.apply(projection)
    socket.auth = { projectId, afterSeq: projection.lastEventSeq }
  })
  socket.on('project.event', (value: unknown) => {
    const event = parseProductEvent(value)
    if (event === undefined) {
      adapter.error('收到无法识别的项目事件')
      return
    }
    if (event.projectId !== projection.projectId) {
      adapter.error('收到其他项目的实时事件')
      return
    }
    if (needsSnapshotResync(projection, event)) {
      adapter.error('实时事件出现缺口，正在重新同步')
      void resync()
      return
    }
    const next = applyProductEvent(projection, event)
    if (next === projection) return
    const actions = animationActionsForTransition(projection, next, event)
    projection = next
    adapter.apply(projection)
    for (const action of actions) adapter.animate(action)
    socket.auth = { projectId, afterSeq: projection.lastEventSeq }
  })
  socket.on('sync.error', (value: unknown) => {
    const code = readErrorCode(value)
    adapter.error(`实时同步失败：${code}`)
    void resync()
  })
}

function createSocket(
  projectId: string,
  afterSeq: number,
): Socket {
  return io(window.location.origin, {
    path: '/future-cup/socket.io',
    auth: { projectId, afterSeq },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
    timeout: 10_000,
  })
}

async function loadProjection(projectId: string): Promise<HqProjection> {
  const encoded = encodeURIComponent(projectId)
  const snapshotValue = await getJson(`/api/v1/projects/${encoded}/snapshot?afterSeq=0&limit=500`)
  const snapshot = parseSnapshot(snapshotValue)
  if (snapshot === undefined) throw new Error('项目快照格式无效')
  return createProjection(snapshot, await loadAgents(projectId))
}

async function loadAgents(projectId: string): Promise<readonly AgentView[]> {
  const agentsValue = await getJson(`/api/v1/projects/${encodeURIComponent(projectId)}/agents`)
  return agentSchema.array().parse(agentsValue)
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  const value: unknown = await response.json()
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}: ${readErrorCode(value)}`)
  }
  return value
}

function readErrorCode(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('code' in value)) return 'UNKNOWN'
  return typeof value.code === 'string' ? value.code : 'UNKNOWN'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function showFatal(message: string): void {
  const target = document.getElementById('glFail')
  if (target === null) return
  target.textContent = message
  target.hidden = false
}
