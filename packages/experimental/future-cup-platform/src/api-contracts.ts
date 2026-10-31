/** Browser-safe Future Cup REST response contracts and public projections. */

import { z } from 'zod'
import type {
  PlatformProjectSnapshot,
  ProjectRunRecord,
  VerificationReport,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'

/** Stable public project-run lifecycle. */
export const projectRunStatusSchema = z.enum([
  'RUNNING',
  'PASSED',
  'FAILED',
  'CANCELLED',
  'ESCALATED',
])

/** One project run without private filesystem paths. */
export const publicProjectRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: projectRunStatusSchema,
  ownerId: z.string(),
  fencingToken: z.string(),
  hasWorkspace: z.boolean(),
  hasPreview: z.boolean(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
}).strict()

/** Public project run value returned by REST and Socket.IO. */
export type PublicProjectRun = z.infer<typeof publicProjectRunSchema>

/** One public project snapshot with sanitized project runs. */
export interface PublicProjectSnapshot extends Omit<PlatformProjectSnapshot, 'runs'> {
  readonly runs: readonly PublicProjectRun[]
}

/** One screenshot artifact address returned to the browser. */
export const screenshotArtifactSchema = z.object({
  name: z.string(),
  url: z.string(),
}).strict()

/** Final delivery summary without host paths. */
export const projectDeliverySchema = z.object({
  projectId: z.string(),
  runId: z.string().optional(),
  status: projectRunStatusSchema.optional(),
  workspacePath: z.string().optional(),
  previewUrl: z.string().optional(),
  screenshots: z.array(screenshotArtifactSchema),
}).strict()

/** Final delivery summary returned by REST. */
export type ProjectDelivery = z.infer<typeof projectDeliverySchema>

/** Accepted project-run response. */
export const projectRunStartSchema = z.object({
  runId: z.string(),
}).strict()

/** Cancellation response. */
export const projectRunCancelSchema = z.object({
  cancelled: z.boolean(),
}).strict()

/** Stable REST error response. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  issues: z.array(z.unknown()).optional(),
}).strict()

/**
 * Convert one internal run to its public value.
 * @param run - durable run with private paths and bigint fencing token.
 * @returns browser-safe run fields.
 */
export function publicProjectRun(run: ProjectRunRecord): PublicProjectRun {
  return publicProjectRunSchema.parse({
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    ownerId: run.ownerId,
    fencingToken: run.fencingToken.toString(),
    hasWorkspace: run.workspacePath !== undefined,
    hasPreview: run.previewPath !== undefined,
    startedAt: run.startedAt,
    ...run.completedAt === undefined ? {} : { completedAt: run.completedAt },
    ...run.error === undefined ? {} : { error: run.error },
  })
}

/**
 * Convert a complete snapshot to the public REST and Socket.IO value.
 * @param snapshot - internal snapshot with private run paths.
 * @returns snapshot whose runs contain no private filesystem values.
 */
export function publicProjectSnapshot(snapshot: PlatformProjectSnapshot): PublicProjectSnapshot {
  return {
    ...snapshot,
    runs: snapshot.runs.map(publicProjectRun),
    verificationReports: snapshot.verificationReports.map(publicVerificationReport),
  }
}

/**
 * Replace absolute screenshot paths in one verification report with file names.
 * @param report - durable verification report.
 * @returns a report safe for REST and Socket.IO delivery.
 */
export function publicVerificationReport(report: VerificationReport): VerificationReport {
  const value = report.report
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return report
  const screenshots = value.screenshots
  if (!Array.isArray(screenshots)
    || !screenshots.every(path => typeof path === 'string')) return report
  return {
    ...report,
    report: {
      ...value,
      screenshots: screenshots.map(path => fileName(path)),
    },
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path
}
