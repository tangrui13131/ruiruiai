/** Zod validators for durable rows and Agent structured-output boundaries. */

import { z } from 'zod'
import { AGENT_ROLES, TASK_STATUSES } from './domain.ts'
import type { JsonValue } from './types.ts'

/** JSON-compatible durable value. */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))

/** Durable task state validator. */
export const taskStatusSchema = z.enum(TASK_STATUSES)

/** M3 Agent role validator. */
export const agentRoleSchema = z.enum(AGENT_ROLES)

/** Planner and Repair roles cannot appear as generated DAG implementation tasks. */
export const taskRoleSchema = agentRoleSchema.exclude(['planner', 'repair'])

/** Structured task failure validator. */
export const taskFailureSchema = z.object({
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
}).strict()

/** Durable task snapshot validator used for database reads and Journal replay. */
export const taskSnapshotSchema = z.object({
  id: z.string().min(1).max(120),
  projectId: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(20_000),
  role: taskRoleSchema,
  priority: z.number().int().min(0).max(100),
  dependencies: z.array(z.string().min(1).max(120)),
  requiredCapabilities: z.record(z.string(), z.number().min(0).max(1)),
  writeScopes: z.array(z.string().min(1).max(500)),
  pageId: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  status: taskStatusSchema,
  revision: z.number().int().positive(),
  retryCount: z.number().int().nonnegative(),
  excludedAgentIds: z.array(z.string().min(1).max(120)),
  assignedAgentId: z.string().min(1).max(120).optional(),
  result: jsonValueSchema.optional(),
  failure: taskFailureSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

/** Durable task Journal row validator. */
export const taskJournalEntrySchema = z.object({
  seq: z.number().int().positive(),
  projectId: z.string().min(1).max(120),
  taskId: z.string().min(1).max(120),
  revision: z.number().int().positive(),
  eventType: z.enum([
    'task/created',
    'task/ready',
    'task/blocked',
    'task/assigned',
    'task/completed',
    'task/failed',
    'task/requeued',
    'task/cancelled',
  ]),
  reason: z.string().min(1).max(2_000).optional(),
  snapshot: taskSnapshotSchema,
  createdAt: z.iso.datetime(),
}).strict()

/** Source file path and content proposed at the model-output boundary. */
export const filePlanSchema = z.object({
  path: z.string().min(1).max(300).refine(
    path => path.startsWith('src/') && !path.includes('..') && !path.includes('\\'),
    'file paths must be normalized repository-relative src/ paths',
  ),
  content: z.string().max(60_000),
}).strict()

/** Planner page output. */
export const plannedPageSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2_000),
  path: filePlanSchema.shape.path,
  route: z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/),
  navigationLabel: z.string().min(1).max(80),
}).strict()

/** Planner task output. */
export const plannedTaskSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4_000),
  role: taskRoleSchema,
  dependencies: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)),
  requiredCapabilities: z.record(z.string(), z.number().min(0).max(1)),
  writeScopes: z.array(z.string().min(1).max(300)),
  priority: z.number().int().min(0).max(100),
  pageId: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
}).strict()

/** Planner output with the M3 team shape enforced. */
export const plannerOutputSchema = z.object({
  projectName: z.string().min(1).max(120),
  pages: z.array(plannedPageSchema).min(2),
  tasks: z.array(plannedTaskSchema).min(5),
}).strict().superRefine((value, context) => {
  const pageIds = new Set(value.pages.map(page => page.id))
  if (pageIds.size !== value.pages.length) {
    context.addIssue({ code: 'custom', message: 'page ids must be unique', path: ['pages'] })
  }
  const routes = new Set(value.pages.map(page => page.route))
  if (routes.size !== value.pages.length) {
    context.addIssue({ code: 'custom', message: 'page routes must be unique', path: ['pages'] })
  }
  const taskIds = new Set(value.tasks.map(task => task.id))
  if (taskIds.size !== value.tasks.length) {
    context.addIssue({ code: 'custom', message: 'task ids must be unique', path: ['tasks'] })
  }
  for (const task of value.tasks) {
    for (const dependency of task.dependencies) {
      if (!taskIds.has(dependency)) {
        context.addIssue({
          code: 'custom',
          message: `task "${task.id}" names missing dependency "${dependency}"`,
          path: ['tasks'],
        })
      }
    }
    if (task.role === 'frontend' && (task.pageId === undefined || !pageIds.has(task.pageId))) {
      context.addIssue({
        code: 'custom',
        message: `frontend task "${task.id}" must name a declared pageId`,
        path: ['tasks'],
      })
    }
  }
  const designTasks = value.tasks.filter(task => task.role === 'ui-designer')
  const testerTasks = value.tasks.filter(task => task.role === 'tester')
  const frontendTasks = value.tasks.filter(task => task.role === 'frontend')
  const integrationTasks = value.tasks.filter(task => task.role === 'integration')
  if (designTasks.length !== 1) {
    context.addIssue({ code: 'custom', message: 'exactly one UI Designer task is required', path: ['tasks'] })
  }
  if (testerTasks.length !== 1) {
    context.addIssue({ code: 'custom', message: 'exactly one Tester task is required', path: ['tasks'] })
  }
  if (frontendTasks.length < 2 || new Set(frontendTasks.map(task => task.pageId)).size !== frontendTasks.length) {
    context.addIssue({
      code: 'custom',
      message: 'at least two frontend tasks with distinct pageIds are required',
      path: ['tasks'],
    })
  }
  if (integrationTasks.length !== 1) {
    context.addIssue({ code: 'custom', message: 'exactly one Integration task is required', path: ['tasks'] })
  }
  const designId = designTasks[0]?.id
  const testerId = testerTasks[0]?.id
  const frontendIds = new Set(frontendTasks.map(task => task.id))
  if (testerId !== undefined && designId !== undefined && !testerTasks[0]?.dependencies.includes(designId)) {
    context.addIssue({
      code: 'custom',
      message: `Tester task "${testerId}" must depend on "${designId}"`,
      path: ['tasks'],
    })
  }
  if (designId !== undefined && testerId !== undefined) {
    for (const task of frontendTasks) {
      if (!task.dependencies.includes(designId) || !task.dependencies.includes(testerId)) {
        context.addIssue({
          code: 'custom',
          message: `frontend task "${task.id}" must depend on both "${designId}" and "${testerId}"`,
          path: ['tasks'],
        })
      }
    }
  }
  const integration = integrationTasks[0]
  if (integration !== undefined) {
    for (const frontendId of frontendIds) {
      if (!integration.dependencies.includes(frontendId)) {
        context.addIssue({
          code: 'custom',
          message: `integration task must depend on frontend task "${frontendId}"`,
          path: ['tasks'],
        })
      }
    }
    if (testerId !== undefined && !integration.dependencies.includes(testerId)) {
      context.addIssue({
        code: 'custom',
        message: `integration task must depend on Tester task "${testerId}"`,
        path: ['tasks'],
      })
    }
  }
})

/** UI Designer structured output. */
export const uiDesignerOutputSchema = z.object({
  summary: z.string().min(1).max(4_000),
  designSpec: z.string().min(1).max(6_000),
  tokens: z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    muted: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    border: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    danger: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    fontFamily: z.string().min(1).max(200),
    cardRadius: z.number().int().min(0).max(48),
    spacingUnit: z.number().int().min(2).max(16),
  }).strict(),
}).strict()

/** Frontend Agent structured output. */
export const frontendOutputSchema = z.object({
  pageId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  summary: z.string().min(1).max(4_000),
  files: z.array(filePlanSchema).min(1).max(3),
}).strict()

/** Integration Agent structured output. */
export const integrationOutputSchema = z.object({
  summary: z.string().min(1).max(4_000),
  files: z.array(filePlanSchema).min(1).max(8),
}).strict()

/** Tester page assertion input owned by the independent browser verifier. */
export const testerPageSpecSchema = z.object({
  pageId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  route: z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/),
  navigationLabel: z.string().min(1).max(80),
  requiredText: z.array(z.string().min(1).max(160)).min(1).max(8),
}).strict()

/** One cross-page navigation assertion generated by the Tester Agent. */
export const testerInteractionSchema = z.object({
  fromRoute: z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/),
  clickText: z.string().min(1).max(80),
  expectedRoute: z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/),
  expectedText: z.string().min(1).max(160),
}).strict()

/** Tester structured output with page and route references closed over its own value. */
export const testerOutputSchema = z.object({
  summary: z.string().min(1).max(4_000),
  pages: z.array(testerPageSpecSchema).min(2),
  interactions: z.array(testerInteractionSchema).min(1),
}).strict().superRefine((value, context) => {
  const pageIds = new Set(value.pages.map(page => page.pageId))
  const routes = new Set(value.pages.map(page => page.route))
  const pagesByRoute = new Map(value.pages.map(page => [page.route, page]))
  if (pageIds.size !== value.pages.length) {
    context.addIssue({ code: 'custom', message: 'Tester page ids must be unique', path: ['pages'] })
  }
  if (routes.size !== value.pages.length) {
    context.addIssue({ code: 'custom', message: 'Tester routes must be unique', path: ['pages'] })
  }
  for (const [index, interaction] of value.interactions.entries()) {
    const fromPage = pagesByRoute.get(interaction.fromRoute)
    const expectedPage = pagesByRoute.get(interaction.expectedRoute)
    if (fromPage === undefined || expectedPage === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Tester interactions must reference declared routes',
        path: ['interactions', index],
      })
      continue
    }
    const bodyLabel = fromPage.requiredText.includes(interaction.clickText)
    const navigationLabel = expectedPage.navigationLabel === interaction.clickText
    if (!bodyLabel && !navigationLabel) {
      context.addIssue({
        code: 'custom',
        message: 'Tester clickText must be a source-page requiredText value or the destination navigationLabel',
        path: ['interactions', index, 'clickText'],
      })
    }
  }
})

/** Repair Agent structured output; the orchestrator applies and audits these files. */
export const repairOutputSchema = z.object({
  diagnosis: z.string().min(1).max(8_000),
  summary: z.string().min(1).max(4_000),
  files: z.array(filePlanSchema).min(1).max(8),
}).strict()

/** One verification finding shared by reports and signatures. */
export const verificationFindingSchema = z.object({
  category: z.enum([
    'structure',
    'dependency',
    'typescript',
    'build',
    'server',
    'browser',
    'console',
    'network',
  ]),
  code: z.string().min(1).max(120),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1).max(8_000),
  target: z.string().min(1).max(1_000).optional(),
}).strict()

/** Verification status validator. */
export const verificationStatusSchema = z.enum(['PASS', 'FAIL', 'WARNING', 'INCOMPLETE'])

/** Complete M3 verification report validator. */
export const verificationReportDataSchema = z.object({
  verifier: z.literal('future-cup-m3'),
  status: verificationStatusSchema,
  failureSignature: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  checks: z.array(z.object({
    name: z.string().min(1).max(120),
    status: z.enum(['PASS', 'FAIL', 'WARNING', 'SKIPPED']),
    summary: z.string().min(1).max(4_000),
  }).strict()),
  findings: z.array(verificationFindingSchema),
  routes: z.array(z.string()),
  viewports: z.array(z.string()),
  screenshots: z.array(z.string()),
}).strict()

/** Persisted Scheduler decision validator. */
export const schedulerDecisionSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  selectedAgentId: z.string().min(1),
  candidates: z.array(z.object({
    agentId: z.string().min(1),
    eligible: z.boolean(),
    rejectionReason: z.string().optional(),
    loadRatio: z.number().min(0).max(1),
    score: z.number(),
    terms: z.object({
      capabilityMatch: z.number().min(0).max(1),
      capabilityContribution: z.number(),
      successContribution: z.number(),
      availabilityContribution: z.number(),
      priorityContribution: z.number(),
      loadPenaltyContribution: z.number(),
    }).strict(),
  }).strict()),
  selectedReason: z.string().min(1),
  previousAgentId: z.string().optional(),
  reassignReason: z.string().optional(),
  createdAt: z.iso.datetime(),
}).strict()
