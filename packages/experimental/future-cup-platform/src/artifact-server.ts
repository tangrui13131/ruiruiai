/** Static management UI, verification screenshots, and generated-project preview routes. */

import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  verificationReportDataSchema,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type {
  PlatformProjectSnapshot,
  PlatformStore,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  projectDeliverySchema,
} from './api-contracts.ts'
import type { ProjectDelivery } from './api-contracts.ts'

const projectParamsSchema = z.object({
  projectId: z.string().min(1).max(120),
}).strict()

const screenshotParamsSchema = projectParamsSchema.extend({
  fileName: z.string().min(1).max(240).regex(/^[A-Za-z0-9._-]+$/u),
}).strict()

const previewParamsSchema = projectParamsSchema.extend({
  '*': z.string().max(2_048).optional(),
}).strict()

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

/** Inputs required by management UI, screenshot, preview, and delivery routes. */
export interface FutureCupArtifactOptions {
  readonly store: PlatformStore
  readonly runRoot: string
  readonly uiRoot?: string | undefined
}

/**
 * Register management assets and private run artifacts after the API routes.
 * @param app - Fastify instance that already owns the REST routes.
 * @param options - store, private run root, and optional built UI root.
 */
export function registerFutureCupArtifacts(
  app: FastifyInstance,
  options: FutureCupArtifactOptions,
): void {
  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/delivery',
    async (request, reply) => {
      const { projectId } = projectParamsSchema.parse(request.params)
      const snapshot = await requireSnapshot(options.store, projectId)
      return await reply.send(projectDelivery(projectId, snapshot, options.runRoot))
    },
  )

  app.get<{ Params: unknown }>(
    '/api/v1/projects/:projectId/screenshots/:fileName',
    async (request, reply) => {
      const { projectId, fileName } = screenshotParamsSchema.parse(request.params)
      const snapshot = await requireSnapshot(options.store, projectId)
      const path = screenshotPath(snapshot, fileName)
      if (path === undefined) {
        return await reply.code(404).send({
          code: 'SCREENSHOT_NOT_FOUND',
          message: `Screenshot "${fileName}" was not found`,
        })
      }
      const safe = await existingPathWithin(options.runRoot, path, 'file')
      if (safe === undefined) {
        return await reply.code(404).send({
          code: 'SCREENSHOT_NOT_FOUND',
          message: `Screenshot "${fileName}" is no longer available`,
        })
      }
      return await sendFile(reply, safe, 'private, max-age=60')
    },
  )

  app.get<{ Params: unknown }>(
    '/preview/:projectId/*',
    async (request, reply) => {
      const params = previewParamsSchema.parse(request.params)
      const snapshot = await requireSnapshot(options.store, params.projectId)
      const previewRoot = snapshot.runs.at(-1)?.previewPath
      if (previewRoot === undefined) {
        return await reply.code(404).send({
          code: 'PREVIEW_NOT_FOUND',
          message: 'This project has no production preview',
        })
      }
      const root = await existingPathWithin(options.runRoot, previewRoot, 'directory')
      if (root === undefined) {
        return await reply.code(404).send({
          code: 'PREVIEW_NOT_FOUND',
          message: 'The production preview is no longer available',
        })
      }
      const encoded = params['*'] === undefined || params['*'] === ''
        ? 'index.html'
        : params['*']
      const requested = decodedRelativePath(encoded)
      if (requested === undefined) {
        return await reply.code(400).send({ code: 'INVALID_ARTIFACT_PATH', message: 'Invalid preview path' })
      }
      const file = await existingPathWithin(root, resolve(root, requested), 'file')
      if (file !== undefined) return await sendFile(reply, file, 'private, max-age=60')
      if (extname(requested) !== '') {
        return await reply.code(404).send({ code: 'PREVIEW_FILE_NOT_FOUND', message: 'Preview file not found' })
      }
      const index = await existingPathWithin(root, resolve(root, 'index.html'), 'file')
      if (index === undefined) {
        return await reply.code(404).send({ code: 'PREVIEW_NOT_FOUND', message: 'Preview index was not found' })
      }
      return await sendFile(reply, index, 'no-store')
    },
  )

  const uiRoot = options.uiRoot
  if (uiRoot === undefined) return

  app.get('/', async (_request, reply) => {
    const index = await existingPathWithin(uiRoot, resolve(uiRoot, 'index.html'), 'file')
    if (index === undefined) {
      return await reply.code(503).send({
        code: 'MANAGEMENT_UI_UNAVAILABLE',
        message: 'The management UI build is missing',
      })
    }
    return await sendFile(reply, index, 'no-store')
  })

  app.get<{ Params: unknown }>('/*', async (request, reply) => {
    const params = z.object({ '*': z.string().max(2_048) }).strict().parse(request.params)
    const requested = decodedRelativePath(params['*'])
    if (requested === undefined) {
      return await reply.code(400).send({ code: 'INVALID_ASSET_PATH', message: 'Invalid asset path' })
    }
    if (requested.startsWith('api/') || requested.startsWith('future-cup/')) {
      return await reply.code(404).send({ code: 'NOT_FOUND', message: 'Route not found' })
    }
    const root = uiRoot
    const file = await existingPathWithin(root, resolve(root, requested), 'file')
    if (file !== undefined) {
      const cache = requested.startsWith('assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=60'
      return await sendFile(reply, file, cache)
    }
    if (extname(requested) !== '') {
      return await reply.code(404).send({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' })
    }
    const index = await existingPathWithin(root, resolve(root, 'index.html'), 'file')
    if (index === undefined) {
      return await reply.code(503).send({
        code: 'MANAGEMENT_UI_UNAVAILABLE',
        message: 'The management UI build is missing',
      })
    }
    return await sendFile(reply, index, 'no-store')
  })
}

async function requireSnapshot(store: PlatformStore, projectId: string): Promise<PlatformProjectSnapshot> {
  const snapshot = await store.getProjectSnapshot(projectId, 0, 1)
  if (snapshot === undefined) {
    throw Object.assign(new Error(`Project "${projectId}" was not found`), {
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
    })
  }
  return snapshot
}

function projectDelivery(
  projectId: string,
  snapshot: PlatformProjectSnapshot,
  runRoot: string,
): ProjectDelivery {
  const run = snapshot.runs.at(-1)
  const screenshots = new Map<string, string>()
  for (const report of snapshot.verificationReports) {
    const parsed = verificationReportDataSchema.safeParse(report.report)
    if (!parsed.success) continue
    for (const path of parsed.data.screenshots) screenshots.set(basename(path), path)
  }
  return projectDeliverySchema.parse({
    projectId,
    ...run === undefined ? {} : {
      runId: run.id,
      status: run.status,
    },
    ...run?.workspacePath === undefined ? {} : {
      workspacePath: relativePath(runRoot, run.workspacePath),
    },
    ...run?.previewPath === undefined ? {} : {
      previewUrl: `/preview/${encodeURIComponent(projectId)}/`,
    },
    screenshots: [...screenshots.keys()].sort().map(name => ({
      name,
      url: `/api/v1/projects/${encodeURIComponent(projectId)}/screenshots/${encodeURIComponent(name)}`,
    })),
  })
}

function screenshotPath(snapshot: PlatformProjectSnapshot, fileName: string): string | undefined {
  for (const report of [...snapshot.verificationReports].reverse()) {
    const parsed = verificationReportDataSchema.safeParse(report.report)
    if (!parsed.success) continue
    const match = parsed.data.screenshots.find(path => basename(path) === fileName)
    if (match !== undefined) return match
  }
  return undefined
}

function relativePath(root: string, path: string): string | undefined {
  const value = relative(resolve(root), resolve(path))
  if (value === '' || value === '..' || value.startsWith(`..${sep}`)) return undefined
  return value.split(sep).join('/')
}

async function existingPathWithin(
  root: string,
  path: string,
  kind: 'file' | 'directory',
): Promise<string | undefined> {
  try {
    const realRoot = await realpath(resolve(root))
    const realPath = await realpath(resolve(path))
    const rel = relative(realRoot, realPath)
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(realRoot, rel) !== realPath) return undefined
    const info = await stat(realPath)
    return (kind === 'directory' ? info.isDirectory() : info.isFile()) ? realPath : undefined
  } catch (error: unknown) {
    if (isFileSystemMiss(error)) return undefined
    throw error
  }
}

async function sendFile(
  reply: FastifyReply,
  path: string,
  cacheControl: string,
): Promise<FastifyReply> {
  const info = await stat(path)
  reply
    .header('cache-control', cacheControl)
    .header('content-length', String(info.size))
    .type(MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream')
  return await reply.send(createReadStream(path))
}

function isFileSystemMiss(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

function isUnsafeRelativePath(path: string): boolean {
  if (path.includes('\0') || path.includes('\\')) return true
  return path.split('/').some(segment => segment === '..')
}

function decodedRelativePath(path: string): string | undefined {
  try {
    const decoded = decodeURIComponent(path)
    return isUnsafeRelativePath(decoded) ? undefined : decoded
  } catch (error: unknown) {
    if (error instanceof URIError) return undefined
    throw error
  }
}
