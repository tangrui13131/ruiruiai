import type { Dictionary } from '../locale/types.ts'
import type { TeamRecommendationPlanView } from '../api/contracts.ts'

type Recommendation = NonNullable<TeamRecommendationPlanView['recommendation']>
type Role = Recommendation['members'][number]['role']
type Risk = Recommendation['risks'][number]
type Adjustment = TeamRecommendationPlanView['adjustments'][number]
type QuestionType = TeamRecommendationPlanView['questions'][number]['type']
type QualityLevel = NonNullable<Recommendation['profile']['qualityLevel']>
type DesignComplexity = NonNullable<Recommendation['profile']['designComplexity']>
type BudgetPreference = NonNullable<Recommendation['profile']['budgetPreference']>
type TimePreference = NonNullable<Recommendation['profile']['timePreference']>
type Parallelism = NonNullable<Recommendation['profile']['moduleParallelism']>
type MemoryKind = Recommendation['memoryPolicy']['allowedKinds'][number]
type MemoryAccess = Recommendation['memoryPolicy']['allowedAccess']

/** Render one controlled Agent role. */
export function roleLabel(dictionary: Dictionary, role: Role): string {
  return dictionary.teamBuilder.roles[role]
}

/** Render one clarification prompt. */
export function questionPrompt(dictionary: Dictionary, type: QuestionType): string {
  switch (type) {
    case 'page-count':
      return dictionary.teamBuilder.questions.pageCount
    case 'module-parallelism':
      return dictionary.teamBuilder.questions.moduleParallelism
    case 'quality-verification':
      return dictionary.teamBuilder.questions.qualityVerification
  }
}

/** Render one verification level. */
export function qualityLabel(dictionary: Dictionary, value: QualityLevel): string {
  return dictionary.teamBuilder.qualities[value]
}

/** Render one design-complexity level. */
export function designLabel(dictionary: Dictionary, value: DesignComplexity): string {
  return dictionary.teamBuilder.designs[value]
}

/** Render one budget preference. */
export function budgetLabel(dictionary: Dictionary, value: BudgetPreference): string {
  return dictionary.teamBuilder.budgets[value]
}

/** Render one time preference. */
export function timeLabel(dictionary: Dictionary, value: TimePreference): string {
  return dictionary.teamBuilder.times[value]
}

/** Render one module-parallelism preference. */
export function parallelismLabel(dictionary: Dictionary, value: Parallelism): string {
  return dictionary.teamBuilder.parallelisms[value]
}

/** Render one structured memory kind. */
export function memoryKindLabel(dictionary: Dictionary, value: MemoryKind): string {
  return dictionary.teamBuilder.memoryKinds[value]
}

/** Render one project-memory access level. */
export function memoryAccessLabel(dictionary: Dictionary, value: MemoryAccess): string {
  return dictionary.teamBuilder.memoryAccess[value]
}

/** Render one recommendation risk without exposing backend-authored English copy. */
export function riskLabel(dictionary: Dictionary, risk: Risk): string {
  const text = dictionary.teamBuilder.risksText
  switch (risk.kind) {
    case 'missing-role':
      return format(text.missingRole, { role: roleLabel(dictionary, risk.role) })
    case 'capability-gap':
      return format(text.capabilityGap, { capability: risk.capability })
    case 'budget-tradeoff':
      return text.budgetTradeoff
    case 'quality-tradeoff':
      return text.qualityTradeoff
    case 'concurrency-limit':
      return format(text.concurrencyLimit, {
        requested: String(risk.requested),
        applied: String(risk.applied),
      })
    case 'unsupported-tech-stack':
      return format(text.unsupportedTechStack, { technology: risk.technology })
  }
}

/** Render one applied adjustment from its persisted structured intent. */
export function adjustmentLabel(dictionary: Dictionary, adjustment: Adjustment): string {
  const text = dictionary.teamBuilder.adjustments
  switch (adjustment.intent.type) {
    case 'add-role-instance':
      return format(text.addRoleInstance, { role: roleLabel(dictionary, adjustment.intent.role) })
    case 'remove-role-instance':
      return format(text.removeRoleInstance, { role: roleLabel(dictionary, adjustment.intent.role) })
    case 'raise-quality':
      return text.raiseQuality
    case 'reduce-concurrency':
      return text.reduceConcurrency
    case 'reduce-scale':
      return text.reduceScale
  }
}

/** Replace named placeholders in locale-owned templates. */
export function format(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  )
}
