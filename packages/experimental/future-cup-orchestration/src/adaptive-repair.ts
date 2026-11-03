/** Deterministic adaptive repair strategy selection over structured verification findings. */

import { z } from 'zod'
import { verificationReportDataSchema } from './schemas.ts'
import type {
  VerificationFinding,
  VerificationReportData,
} from './types.ts'

/** Failure categories recognized by the M5 repair strategy catalog. */
export const REPAIR_FAILURE_CATEGORIES = [
  'structure',
  'dependency',
  'typescript',
  'build',
  'server',
  'browser',
  'console',
  'network',
] as const

/** Source context breadth available to one repair strategy. */
export const REPAIR_CONTEXT_SCOPES = [
  'TARGET_FILES',
  'RELATED_SOURCE',
  'BOUNDED_SOURCE',
] as const

/** Repair strategies may never narrow the independent verifier. */
export const REPAIR_REVERIFY_SCOPE = 'FULL_VERIFICATION' as const

const identifierSchema = z.string().trim().min(1).max(160)
const repairFailureCategorySchema = z.enum(REPAIR_FAILURE_CATEGORIES)
const repairContextScopeSchema = z.enum(REPAIR_CONTEXT_SCOPES)

/** One predefined strategy that changes repair context without changing verification. */
export const repairStrategySchema = z.object({
  id: identifierSchema,
  label: z.string().trim().min(1).max(200),
  categories: z.array(repairFailureCategorySchema).min(1),
  targetPatterns: z.array(z.string().min(1).max(300)),
  promptFragment: z.string().trim().min(1).max(4_000),
  contextScope: repairContextScopeSchema,
  requiredTools: z.array(identifierSchema),
  writeScope: z.literal('src/'),
  reverifyScope: z.literal(REPAIR_REVERIFY_SCOPE),
  specificity: z.number().int().min(0).max(100),
}).strict()

/** One validated repair strategy. */
export type RepairStrategy = z.infer<typeof repairStrategySchema>

/** Prior strategy use that affects repeated-signature switching. */
export const repairStrategyHistorySchema = z.object({
  repairRound: z.number().int().positive(),
  failureSignature: z.string().regex(/^[0-9a-f]{64}$/),
  strategyId: identifierSchema,
}).strict()

/** One prior strategy selection relevant to the current decision. */
export type RepairStrategyHistory = z.infer<typeof repairStrategyHistorySchema>

/** Strategy selection input. */
export const selectRepairStrategyInputSchema = z.object({
  report: verificationReportDataSchema,
  repairRound: z.number().int().positive(),
  maxRepairRounds: z.number().int().positive(),
  availableTools: z.array(identifierSchema),
  priorStrategies: z.array(repairStrategyHistorySchema),
}).strict()

/** Input accepted by {@link selectRepairStrategy}. */
export interface SelectRepairStrategyInput {
  readonly report: VerificationReportData
  readonly repairRound: number
  readonly maxRepairRounds: number
  readonly availableTools: readonly string[]
  readonly priorStrategies: readonly RepairStrategyHistory[]
}

/** Explicit score terms retained for every candidate. */
export const repairStrategyScoreTermsSchema = z.object({
  categoryMatch: z.number().min(0).max(1),
  targetMatch: z.number().min(0).max(1),
  specificity: z.number().int().min(0).max(100),
  historyPenalty: z.number().int().nonnegative(),
  repetitionSwitchBonus: z.number().int().nonnegative(),
}).strict()

/** One ranked strategy candidate. */
export const repairStrategyCandidateSchema = z.object({
  strategyId: identifierSchema,
  eligible: z.boolean(),
  score: z.number(),
  terms: repairStrategyScoreTermsSchema,
  reasons: z.array(z.string()),
  rejectionReason: z.string().optional(),
}).strict()

/** Compact input evidence retained in the durable strategy decision. */
export const repairStrategyInputSummarySchema = z.object({
  categories: z.array(repairFailureCategorySchema),
  codes: z.array(z.string()),
  targets: z.array(z.string()),
}).strict()

/** Complete explainable strategy-selection result. */
export const repairStrategyDecisionSchema = z.object({
  failureSignature: z.string().regex(/^[0-9a-f]{64}$/),
  repairRound: z.number().int().positive(),
  maxRepairRounds: z.number().int().positive(),
  repeatedSignature: z.boolean(),
  selectedStrategy: repairStrategySchema.optional(),
  selectedReason: z.string(),
  swappedFromStrategyId: identifierSchema.optional(),
  candidates: z.array(repairStrategyCandidateSchema),
  inputSummary: repairStrategyInputSummarySchema,
  nextRoundExpectation: z.enum([
    'FIRST_REPAIR',
    'SWITCHED_STRATEGY',
    'ESCALATE_REPEATED_FAILURE',
    'ESCALATE_NO_ELIGIBLE_STRATEGY',
  ]),
  reverifyScope: z.literal(REPAIR_REVERIFY_SCOPE),
  escalationReason: z.enum([
    'REPEATED_FAILURE',
    'NO_ELIGIBLE_STRATEGY',
  ]).optional(),
}).strict()

/** Complete strategy-selection result. */
export type RepairStrategyDecision = z.infer<typeof repairStrategyDecisionSchema>

/** One focused source file supplied to the Repair Agent. */
export interface RepairSource {
  readonly path: string
  readonly content: string
}

const DEFAULT_TOOLS = Object.freeze(['fs-read'])

/** Predefined controlled repair catalog. */
export const REPAIR_STRATEGIES: readonly RepairStrategy[] = Object.freeze([
  strategy({
    id: 'typescript-contract',
    label: 'TypeScript contract repair',
    categories: ['typescript'],
    targetPatterns: ['src/**/*.ts', 'src/**/*.tsx'],
    promptFragment: [
      'Trace the TypeScript diagnostic to the exact declared or inferred contract.',
      'Correct imports, props, discriminated unions, and nullability without weakening tsconfig.',
    ].join(' '),
    contextScope: 'TARGET_FILES',
    specificity: 95,
  }),
  strategy({
    id: 'module-graph',
    label: 'Module graph and dependency repair',
    categories: ['dependency', 'build'],
    targetPatterns: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.json'],
    promptFragment: [
      'Trace unresolved modules, package mismatches, and build failures through the affected source graph.',
      'Preserve package scripts and avoid suppressing compiler or bundler diagnostics.',
    ].join(' '),
    contextScope: 'RELATED_SOURCE',
    specificity: 90,
  }),
  strategy({
    id: 'browser-behavior',
    label: 'Browser behavior repair',
    categories: ['browser'],
    targetPatterns: ['src/**/*.tsx'],
    promptFragment: [
      'Use the failed route, viewport, expected text, and interaction evidence to restore the asserted UI behavior.',
      'Do not change test expectations or hide failed controls.',
    ].join(' '),
    contextScope: 'RELATED_SOURCE',
    specificity: 90,
  }),
  strategy({
    id: 'accessibility-responsive',
    label: 'Accessibility and responsive repair',
    categories: ['browser'],
    targetPatterns: ['src/**/*.tsx', 'src/**/*.css'],
    promptFragment: [
      'Inspect responsive layout, accessible names, roles, focus, and text overflow at the failed viewport.',
      'Preserve the same visible behavior while correcting layout or semantics.',
    ].join(' '),
    contextScope: 'RELATED_SOURCE',
    specificity: 80,
  }),
  strategy({
    id: 'console-network-runtime',
    label: 'Runtime, console, and network repair',
    categories: ['console', 'network'],
    targetPatterns: ['src/**/*.ts', 'src/**/*.tsx'],
    promptFragment: [
      'Trace console errors, rejected requests, duplicate activity, and late updates to their runtime source.',
      'Fix the lifecycle or request contract instead of filtering diagnostics.',
    ].join(' '),
    contextScope: 'RELATED_SOURCE',
    specificity: 85,
  }),
  strategy({
    id: 'server-lifecycle',
    label: 'Preview server lifecycle repair',
    categories: ['server', 'network'],
    targetPatterns: ['src/**/*.ts', 'src/**/*.tsx'],
    promptFragment: [
      'Trace preview-server startup and request failures through application lifecycle code.',
      'Preserve server readiness, request contracts, and required acceptance checks.',
    ].join(' '),
    contextScope: 'BOUNDED_SOURCE',
    specificity: 75,
  }),
  strategy({
    id: 'project-structure',
    label: 'Project structure repair',
    categories: ['structure'],
    targetPatterns: ['src/**/*'],
    promptFragment: [
      'Restore the required React and Vite source files and the fixed HashRouter application contract.',
      'Do not weaken project structure or acceptance checks.',
    ].join(' '),
    contextScope: 'BOUNDED_SOURCE',
    specificity: 85,
  }),
  strategy({
    id: 'bounded-regression',
    label: 'Bounded regression repair',
    categories: [...REPAIR_FAILURE_CATEGORIES],
    targetPatterns: ['src/**/*'],
    promptFragment: [
      'Make the smallest coherent source change that addresses the complete reported failure set.',
      'Preserve unrelated routes and behavior, then rely on the full independent verification pipeline.',
    ].join(' '),
    contextScope: 'BOUNDED_SOURCE',
    specificity: 20,
  }),
])

/**
 * Select one controlled repair strategy from verification history.
 * @param input - report, round bound, available tools, and prior strategy uses.
 * @returns an explainable decision with JSON-safe candidates and no threshold changes.
 */
export function selectRepairStrategy(input: SelectRepairStrategyInput): RepairStrategyDecision {
  const value = selectRepairStrategyInputSchema.parse(input)
  if (value.repairRound > value.maxRepairRounds) {
    throw new Error('repairRound cannot exceed maxRepairRounds')
  }
  const signature = requiredFailureSignature(value.report)
  const inputSummary = summarizeInput(value.report)
  const signatureHistory = value.priorStrategies
    .filter(entry => entry.failureSignature === signature)
    .sort((left, right) => left.repairRound - right.repairRound)
  const repeatedSignature = signatureHistory.length > 0
  const usedStrategies = new Set(signatureHistory.map(entry => entry.strategyId))
  const availableTools = new Set(value.availableTools)

  const candidates = REPAIR_STRATEGIES.map((candidate) => {
    const categoryMatch = inputSummary.categories.some(category =>
      candidate.categories.includes(category))
    const targetMatch = inputSummary.targets.some(target =>
      candidate.targetPatterns.some(pattern => matchesTarget(pattern, target)))
    const requiredToolsAvailable = candidate.requiredTools.every(tool => availableTools.has(tool))
    const alreadyUsed = usedStrategies.has(candidate.id)
    const eligible = categoryMatch
      && requiredToolsAvailable
      && (!repeatedSignature || !alreadyUsed)
    const historyPenalty = alreadyUsed ? 30 : 0
    const repetitionSwitchBonus = repeatedSignature && !alreadyUsed ? 25 : 0
    const rejectionReason = !requiredToolsAvailable
      ? 'required-tools-unavailable'
      : !categoryMatch
        ? 'failure-category-mismatch'
        : repeatedSignature && alreadyUsed
          ? 'strategy-already-used-for-failure'
          : undefined
    const score = (categoryMatch ? 45 : 0)
      + (targetMatch ? 20 : 0)
      + candidate.specificity / 10
      + repetitionSwitchBonus
      - historyPenalty
    const reasons = [
      categoryMatch
        ? `Handles ${inputSummary.categories.filter(category => candidate.categories.includes(category)).join(', ')}.`
        : 'Does not handle the reported failure categories.',
      targetMatch
        ? 'Matches a reported target path.'
        : 'No reported target path matched its preferred scope.',
      repeatedSignature && !alreadyUsed
        ? 'Unused alternative for the repeated failure signature.'
        : repeatedSignature
          ? 'Already used for the repeated failure signature.'
          : 'First strategy selection for this failure signature.',
    ]
    return {
      strategyId: candidate.id,
      eligible,
      score,
      terms: {
        categoryMatch: categoryMatch ? 1 : 0,
        targetMatch: targetMatch ? 1 : 0,
        specificity: candidate.specificity,
        historyPenalty,
        repetitionSwitchBonus,
      },
      reasons,
      ...rejectionReason === undefined ? {} : { rejectionReason },
    }
  }).sort(compareCandidates)

  const selectedCandidate = candidates.find(candidate => candidate.eligible)
  if (selectedCandidate === undefined) {
    const reason = repeatedSignature ? 'REPEATED_FAILURE' : 'NO_ELIGIBLE_STRATEGY'
    return repairStrategyDecisionSchema.parse({
      failureSignature: signature,
      repairRound: value.repairRound,
      maxRepairRounds: value.maxRepairRounds,
      repeatedSignature,
      selectedReason: repeatedSignature
        ? 'Every eligible repair strategy was already used for this failure signature.'
        : 'No repair strategy matched the failure categories and available tools.',
      candidates,
      inputSummary,
      nextRoundExpectation: repeatedSignature
        ? 'ESCALATE_REPEATED_FAILURE'
        : 'ESCALATE_NO_ELIGIBLE_STRATEGY',
      reverifyScope: REPAIR_REVERIFY_SCOPE,
      escalationReason: reason,
    })
  }

  const selectedStrategy = repairStrategyById(selectedCandidate.strategyId)
  const previous = signatureHistory.at(-1)
  return repairStrategyDecisionSchema.parse({
    failureSignature: signature,
    repairRound: value.repairRound,
    maxRepairRounds: value.maxRepairRounds,
    repeatedSignature,
    selectedStrategy,
    selectedReason: repeatedSignature
      ? `Switch from ${priorStrategyForSignature(signatureHistory)} to ${selectedStrategy.id} for the repeated failure.`
      : `Selected ${selectedStrategy.id} for ${inputSummary.categories.join(', ')}.`,
    ...previous === undefined ? {} : { swappedFromStrategyId: previous.strategyId },
    candidates,
    inputSummary,
    nextRoundExpectation: repeatedSignature ? 'SWITCHED_STRATEGY' : 'FIRST_REPAIR',
    reverifyScope: REPAIR_REVERIFY_SCOPE,
  })
}

/**
 * Prioritize reported targets while preserving a bounded source context.
 * @param decision - selected strategy decision.
 * @param sources - complete bounded source snapshot.
 * @param limit - maximum files supplied to the Repair Agent.
 * @returns targeted files first, then deterministic surrounding source.
 */
export function selectRepairContext(
  decision: RepairStrategyDecision,
  sources: readonly RepairSource[],
  limit = 24,
): RepairSource[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('repair context limit must be a positive safe integer')
  }
  const parsed = repairStrategyDecisionSchema.parse(decision)
  const targets = new Set(parsed.inputSummary.targets)
  const strategyPatterns = parsed.selectedStrategy?.targetPatterns ?? ['src/**/*']
  return sources
    .map(source => ({
      source,
      targetRank: targets.has(source.path) ? 0 : 1,
      patternRank: strategyPatterns.some(pattern => matchesTarget(pattern, source.path)) ? 0 : 1,
    }))
    .sort((left, right) => {
      return left.targetRank - right.targetRank
        || left.patternRank - right.patternRank
        || left.source.path.localeCompare(right.source.path)
    })
    .slice(0, limit)
    .map(entry => ({ ...entry.source }))
}

function strategy(
  value: Omit<RepairStrategy, 'requiredTools' | 'writeScope' | 'reverifyScope'>
    & Partial<Pick<RepairStrategy, 'requiredTools' | 'writeScope' | 'reverifyScope'>>,
): RepairStrategy {
  return repairStrategySchema.parse({
    requiredTools: DEFAULT_TOOLS,
    writeScope: 'src/',
    reverifyScope: REPAIR_REVERIFY_SCOPE,
    ...value,
  })
}

function requiredFailureSignature(report: VerificationReportData): string {
  if (report.failureSignature === null) {
    throw new Error('adaptive repair requires a stable failure signature')
  }
  return report.failureSignature
}

function summarizeInput(report: VerificationReportData) {
  return repairStrategyInputSummarySchema.parse({
    categories: [...new Set(report.findings.map(repairCategoryForFinding))].sort(),
    codes: [...new Set(report.findings.map(finding => finding.code))].sort(),
    targets: [...new Set(report.findings.flatMap(finding =>
      finding.target === undefined ? [] : [finding.target]))].sort(),
  })
}

/**
 * Resolve one strategy from the controlled catalog.
 * @param id - catalog strategy identity.
 * @returns the exact predefined strategy.
 */
export function repairStrategyById(id: string): RepairStrategy {
  const found = REPAIR_STRATEGIES.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`unknown repair strategy "${id}"`)
  return found
}

/**
 * Read the strategy used by the latest attempt for one repeated signature.
 * @param history - prior strategies for the current signature in round order.
 * @returns the latest strategy identity.
 * @throws Error when repeated-signature history is unexpectedly empty.
 */
export function priorStrategyForSignature(
  history: readonly RepairStrategyHistory[],
): string {
  const previous = history.at(-1)
  if (previous === undefined) {
    throw new Error('repeated failure signature has no prior strategy')
  }
  return previous.strategyId
}

function compareCandidates(
  left: RepairStrategyCandidate,
  right: RepairStrategyCandidate,
): number {
  return Number(right.eligible) - Number(left.eligible)
    || right.score - left.score
    || right.terms.specificity - left.terms.specificity
    || left.strategyId.localeCompare(right.strategyId)
}

type RepairStrategyCandidate = z.infer<typeof repairStrategyCandidateSchema>

function matchesTarget(pattern: string, target: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('/**/', '/(?:.*/)?')
    .replaceAll('**', '.*')
    .replaceAll('*', '[^/]*')
  return new RegExp(`^${escaped}$`, 'u').test(target)
}

/**
 * Convert one verification finding category into its repair strategy category.
 * @param finding - verification finding carrying the source category.
 * @returns the matching controlled repair category.
 */
export function repairCategoryForFinding(finding: VerificationFinding): typeof REPAIR_FAILURE_CATEGORIES[number] {
  return repairFailureCategorySchema.parse(finding.category)
}
