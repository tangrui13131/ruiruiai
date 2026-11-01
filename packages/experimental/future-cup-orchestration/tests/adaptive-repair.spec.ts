import { describe, expect, it } from 'vitest'
import {
  REPAIR_STRATEGIES,
  priorStrategyForSignature,
  repairCategoryForFinding,
  repairStrategyById,
  selectRepairContext,
  selectRepairStrategy,
  type RepairStrategyHistory,
  type SelectRepairStrategyInput,
} from '../src/adaptive-repair.ts'
import type { VerificationReportData } from '../src/types.ts'

const SIGNATURE_A = 'a'.repeat(64)
const SIGNATURE_B = 'b'.repeat(64)

function report(
  category: VerificationReportData['findings'][number]['category'],
  target = 'src/App.tsx',
  signature = SIGNATURE_A,
): VerificationReportData {
  return {
    verifier: 'future-cup-m3',
    status: 'FAIL',
    failureSignature: signature,
    checks: [{ name: category, status: 'FAIL', summary: `${category} failed` }],
    findings: [{
      category,
      code: `${category.toUpperCase()}_FAILURE`,
      severity: 'error',
      message: `${category} failed`,
      target,
    }],
    routes: ['/'],
    viewports: ['desktop'],
    screenshots: [],
  }
}

function input(overrides: Partial<SelectRepairStrategyInput> = {}): SelectRepairStrategyInput {
  return {
    report: report('typescript'),
    repairRound: 1,
    maxRepairRounds: 3,
    availableTools: ['fs-read'],
    priorStrategies: [],
    ...overrides,
  }
}

function history(
  strategyId: string,
  signature = SIGNATURE_A,
  repairRound = 1,
): RepairStrategyHistory {
  return { repairRound, failureSignature: signature, strategyId }
}

describe('adaptive repair strategy selection', () => {
  it('selects the highest-specificity strategy for a TypeScript failure', () => {
    const decision = selectRepairStrategy(input())

    expect(decision).toMatchObject({
      failureSignature: SIGNATURE_A,
      repeatedSignature: false,
      selectedStrategy: { id: 'typescript-contract' },
      nextRoundExpectation: 'FIRST_REPAIR',
      reverifyScope: 'FULL_VERIFICATION',
    })
    expect(decision.candidates[0]).toMatchObject({
      strategyId: 'typescript-contract',
      eligible: true,
      terms: {
        categoryMatch: 1,
        targetMatch: 1,
        repetitionSwitchBonus: 0,
      },
    })
    expect(() => JSON.stringify(decision)).not.toThrow()
  })

  it('switches to an unused strategy for a repeated signature', () => {
    const decision = selectRepairStrategy(input({
      repairRound: 2,
      priorStrategies: [history('typescript-contract')],
    }))

    expect(decision).toMatchObject({
      repeatedSignature: true,
      selectedStrategy: { id: 'bounded-regression' },
      swappedFromStrategyId: 'typescript-contract',
      nextRoundExpectation: 'SWITCHED_STRATEGY',
    })
    expect(decision.candidates.find(value => value.strategyId === 'typescript-contract'))
      .toMatchObject({
        eligible: false,
        rejectionReason: 'strategy-already-used-for-failure',
      })
  })

  it('escalates when every matching strategy was used for the repeated signature', () => {
    const decision = selectRepairStrategy(input({
      repairRound: 3,
      priorStrategies: [
        history('typescript-contract'),
        history('bounded-regression', SIGNATURE_A, 2),
      ],
    }))

    expect(decision).toMatchObject({
      repeatedSignature: true,
      nextRoundExpectation: 'ESCALATE_REPEATED_FAILURE',
      escalationReason: 'REPEATED_FAILURE',
    })
    expect(decision.selectedStrategy).toBeUndefined()
  })

  it('does not reuse another signature history to block a first repair', () => {
    const decision = selectRepairStrategy(input({
      priorStrategies: [history('typescript-contract', SIGNATURE_B)],
    }))

    expect(decision.selectedStrategy?.id).toBe('typescript-contract')
    expect(decision.repeatedSignature).toBe(false)
  })

  it('rejects strategies when the Repair Agent lacks the required tool', () => {
    const decision = selectRepairStrategy(input({ availableTools: [] }))

    expect(decision).toMatchObject({
      nextRoundExpectation: 'ESCALATE_NO_ELIGIBLE_STRATEGY',
      escalationReason: 'NO_ELIGIBLE_STRATEGY',
    })
    expect(decision.candidates.every(candidate =>
      candidate.rejectionReason === 'required-tools-unavailable')).toBe(true)
  })

  it('keeps candidate ordering deterministic and category-specific', () => {
    const first = selectRepairStrategy(input({ report: report('browser') }))
    const second = selectRepairStrategy(input({ report: report('browser') }))

    expect(first).toEqual(second)
    expect(first.candidates.slice(0, 2).map(candidate => candidate.strategyId))
      .toEqual(['browser-behavior', 'accessibility-responsive'])
    expect(REPAIR_STRATEGIES).toHaveLength(8)
  })

  it('handles failures without a matching target or target path', () => {
    const noMatch = selectRepairStrategy(input({
      report: report('typescript', 'docs/architecture.md'),
    }))
    expect(noMatch.candidates[0]?.terms.targetMatch).toBe(0)

    const withoutTarget = selectRepairStrategy(input({
      report: {
        ...report('typescript'),
        findings: [{
          category: 'typescript',
          code: 'TS_UNKNOWN',
          severity: 'error',
          message: 'No target',
        }],
      },
    }))
    expect(withoutTarget.inputSummary.targets).toEqual([])
  })

  it('requires a stable failure signature and valid round bounds', () => {
    expect(() => selectRepairStrategy(input({
      report: { ...report('typescript'), failureSignature: null },
    }))).toThrow(/stable failure signature/)
    expect(() => selectRepairStrategy(input({
      report: { ...report('typescript'), failureSignature: 'short' },
    }))).toThrow()
    expect(() => selectRepairStrategy(input({ repairRound: 4 }))).toThrow(/cannot exceed/)
  })

  it('exposes the finding category mapping used for repair selection', () => {
    expect(repairCategoryForFinding({
      category: 'network',
      code: 'REQUEST_FAILED',
      severity: 'error',
      message: 'request failed',
    })).toBe('network')
    expect(repairStrategyById('typescript-contract').id).toBe('typescript-contract')
    expect(() => repairStrategyById('missing')).toThrow(/unknown repair strategy/)
    expect(priorStrategyForSignature([history('typescript-contract')]))
      .toBe('typescript-contract')
    expect(() => priorStrategyForSignature([])).toThrow(/no prior strategy/)
  })
})

describe('repair context selection', () => {
  it('puts reported targets and matching source files first', () => {
    const decision = selectRepairStrategy(input())
    const context = selectRepairContext(decision, [
      { path: 'src/styles.css', content: 'body {}' },
      { path: 'src/pages/Users.tsx', content: 'export const Users = 1' },
      { path: 'src/App.tsx', content: 'export const App = 1' },
    ], 2)

    expect(context.map(value => value.path)).toEqual([
      'src/App.tsx',
      'src/pages/Users.tsx',
    ])

    expect(selectRepairContext(decision, [
      { path: 'src/pages/Users.tsx', content: '' },
      { path: 'src/App.tsx', content: '' },
    ], 2).map(value => value.path)).toEqual(['src/App.tsx', 'src/pages/Users.tsx'])
  })

  it('falls back to the bounded source order when no strategy was selected', () => {
    const decision = selectRepairStrategy(input({
      repairRound: 3,
      priorStrategies: [
        history('typescript-contract'),
        history('bounded-regression', SIGNATURE_A, 2),
      ],
    }))
    const context = selectRepairContext(decision, [
      { path: 'src/z.ts', content: '' },
      { path: 'src/a.tsx', content: '' },
    ])

    expect(context.map(value => value.path)).toEqual(['src/a.tsx', 'src/z.ts'])
  })

  it('rejects a non-positive context limit', () => {
    const decision = selectRepairStrategy(input())
    expect(() => selectRepairContext(decision, [], 0)).toThrow(/positive safe integer/)
  })
})
