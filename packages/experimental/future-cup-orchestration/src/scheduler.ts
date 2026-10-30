/** Explainable capability, success, availability, priority, and load-balance scheduler. */

import { randomUUID } from 'node:crypto'
import type { AgentId as AgentIdType, ProjectId as ProjectIdType } from './brand.ts'
import type {
  AgentProfile,
  ScheduledAssignment,
  SchedulerCandidate,
  SchedulerDecision,
  SchedulerScoreTerms,
  SchedulerWeights,
  TaskSnapshot,
} from './types.ts'

/** Default weights used by the M2 orchestration package. */
export const DEFAULT_SCHEDULER_WEIGHTS: SchedulerWeights = {
  capability: 0.5,
  success: 0.2,
  availability: 0.15,
  priority: 0.15,
  loadPenalty: 0.35,
}

interface SchedulerOptions {
  /** Override for deterministic test timestamps. */
  readonly now?: () => Date
  /** Override for deterministic decision ids. */
  readonly createDecisionId?: () => string
}

/**
 * Validate scheduler weights at the configuration boundary.
 * @param weights - deployment-provided weights.
 * @returns the complete validated weight record.
 */
export function resolveSchedulerWeights(weights: SchedulerWeights): SchedulerWeights {
  for (const [name, value] of Object.entries(weights)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`scheduler weight "${name}" must be a non-negative finite number`)
    }
  }
  return { ...weights }
}

/**
 * Overlay persisted Agent success history onto static Agent capabilities.
 * @param profiles - configured Agent profiles.
 * @param rates - observed success rate by Agent id.
 * @returns profiles with history when present.
 */
export function withHistoricalSuccessRates(
  profiles: readonly AgentProfile[],
  rates: Readonly<Record<string, number>>,
): AgentProfile[] {
  return profiles.map(profile => ({
    ...profile,
    historicalSuccessRate: rates[profile.id] ?? profile.historicalSuccessRate,
  }))
}

/** Explainable scheduler over one immutable Agent profile set. */
export class ExplainableScheduler {
  private readonly weights: SchedulerWeights
  private readonly now: () => Date
  private readonly createDecisionId: () => string

  /**
   * @param weights - explicit score weights.
   * @param options - deterministic clock and id overrides for tests.
   */
  constructor(weights: SchedulerWeights = DEFAULT_SCHEDULER_WEIGHTS, options: SchedulerOptions = {}) {
    this.weights = resolveSchedulerWeights(weights)
    this.now = options.now ?? (() => new Date())
    this.createDecisionId = options.createDecisionId ?? randomUUID
  }

  /**
   * Rank every Agent capable of one task role while retaining ineligible candidates.
   * @param task - READY task.
   * @param profiles - current Agent runtime profiles.
   * @param currentLoads - explicit per-Agent load snapshot.
   * @returns candidate list with term-by-term score evidence.
   */
  rank(
    task: TaskSnapshot,
    profiles: readonly AgentProfile[],
    currentLoads: ReadonlyMap<AgentIdType, number>,
  ): SchedulerCandidate[] {
    const priorityRatio = Math.max(0, Math.min(1, task.priority / 100))
    return profiles
      .filter(profile => profile.role === task.role)
      .map((profile): SchedulerCandidate => {
        const currentLoad = currentLoads.get(profile.id) ?? profile.currentLoad
        const loadRatio = Math.max(0, Math.min(1, currentLoad / profile.maxConcurrency))
        const missingCapabilities = Object.entries(task.requiredCapabilities)
          .filter(([capability, required]) => (profile.capabilities[capability] ?? 0) < required)
          .map(([capability]) => capability)
        const capabilityMatch = this.capabilityMatch(task, profile)
        const terms: SchedulerScoreTerms = {
          capabilityMatch,
          capabilityContribution: capabilityMatch * this.weights.capability,
          successContribution: profile.historicalSuccessRate * this.weights.success,
          availabilityContribution: (profile.available ? 1 : 0) * this.weights.availability,
          priorityContribution: priorityRatio * this.weights.priority,
          loadPenaltyContribution: -loadRatio * this.weights.loadPenalty,
        }
        const score = terms.capabilityContribution
          + terms.successContribution
          + terms.availabilityContribution
          + terms.priorityContribution
          + terms.loadPenaltyContribution
        const rejectionReason = task.excludedAgentIds.includes(profile.id)
          ? 'excluded after the previous failed assignment'
          : !profile.available
            ? 'Agent is unavailable'
            : currentLoad >= profile.maxConcurrency
              ? 'Agent is at concurrency capacity'
              : missingCapabilities.length > 0
                ? `missing required capabilities: ${missingCapabilities.join(', ')}`
                : undefined
        return {
          agentId: profile.id,
          eligible: rejectionReason === undefined,
          ...rejectionReason === undefined ? {} : { rejectionReason },
          loadRatio,
          score,
          terms,
        }
      })
      .sort((left, right) => right.score - left.score || left.agentId.localeCompare(right.agentId))
  }

  /**
   * Assign all READY tasks in one deterministic scheduling round.
   * @param projectId - owning project.
   * @param readyTasks - READY tasks.
   * @param profiles - current Agent profiles.
   * @returns assignments and durable decision records.
   */
  schedule(
    projectId: ProjectIdType,
    readyTasks: readonly TaskSnapshot[],
    profiles: readonly AgentProfile[],
  ): ScheduledAssignment[] {
    const loads = new Map<AgentIdType, number>(profiles.map(profile => [profile.id, profile.currentLoad]))
    const assignments: ScheduledAssignment[] = []
    const orderedTasks = [...readyTasks].sort((left, right) =>
      right.priority - left.priority || left.id.localeCompare(right.id),
    )
    for (const task of orderedTasks) {
      const candidates = this.rank(task, profiles, loads)
      const selected = candidates.find(candidate => candidate.eligible)
      if (selected === undefined) {
        throw new Error(`no eligible Agent for task "${task.id}" (${task.role})`)
      }
      const agent = profiles.find(profile => profile.id === selected.agentId)
      if (agent === undefined) throw new Error(`selected Agent "${selected.agentId}" is not configured`)
      const previousAgentId = task.assignedAgentId
      const decision: SchedulerDecision = {
        id: `scheduler-${this.createDecisionId()}`,
        projectId,
        taskId: task.id,
        selectedAgentId: selected.agentId,
        candidates,
        selectedReason: task.retryCount > 0
          ? `highest weighted score for reassignment of retry ${task.retryCount}`
          : `highest weighted score for role ${task.role}`,
        ...previousAgentId === undefined ? {} : { previousAgentId },
        ...task.failure === undefined
          ? {}
          : { reassignReason: `previous attempt failed with ${task.failure.code}` },
        createdAt: this.now().toISOString(),
      }
      assignments.push({ task, agent, decision })
      loads.set(agent.id, (loads.get(agent.id) ?? 0) + 1)
    }
    return assignments
  }

  private capabilityMatch(task: TaskSnapshot, profile: AgentProfile): number {
    const entries = Object.entries(task.requiredCapabilities)
    if (entries.length === 0) return 1
    if (entries.some(([capability, required]) => (profile.capabilities[capability] ?? 0) < required)) return 0
    return entries.reduce((sum, [capability, required]) => {
      const actual = profile.capabilities[capability] ?? 0
      return sum + Math.min(1, actual / required)
    }, 0) / entries.length
  }
}
