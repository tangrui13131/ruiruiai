import { describe, expect, it } from 'vitest'
import { localeDictionaries } from '../src/locale/types.ts'
import {
  adjustmentLabel,
  budgetLabel,
  designLabel,
  format,
  memoryAccessLabel,
  memoryKindLabel,
  parallelismLabel,
  qualityLabel,
  questionPrompt,
  riskLabel,
  roleLabel,
  timeLabel,
} from '../src/team/recommendation-labels.ts'

const dictionary = localeDictionaries['zh-CN']

describe('team recommendation labels', () => {
  it('renders every controlled role, level, question, and memory label', () => {
    expect(roleLabel(dictionary, 'ui-designer')).toBe('UI 设计')
    expect(questionPrompt(dictionary, 'page-count')).toContain('页面')
    expect(questionPrompt(dictionary, 'module-parallelism')).toContain('模块')
    expect(questionPrompt(dictionary, 'quality-verification')).toContain('验证')
    expect(qualityLabel(dictionary, 'critical')).toContain('关键')
    expect(designLabel(dictionary, 'high')).toBe('复杂')
    expect(budgetLabel(dictionary, 'low')).toBe('节省')
    expect(timeLabel(dictionary, 'fast')).toBe('尽快')
    expect(parallelismLabel(dictionary, 'parallel')).toBe('尽量并行')
    expect(memoryKindLabel(dictionary, 'failure-signature')).toBe('失败签名')
    expect(memoryAccessLabel(dictionary, 'WRITE')).toBe('读写')
  })

  it('renders every structured risk variant', () => {
    expect(riskLabel(dictionary, {
      kind: 'missing-role',
      role: 'verifier',
      message: 'ignored',
    })).toContain('验证')
    expect(riskLabel(dictionary, {
      kind: 'capability-gap',
      capability: 'testing',
      message: 'ignored',
    })).toContain('testing')
    expect(riskLabel(dictionary, {
      kind: 'budget-tradeoff',
      message: 'ignored',
    })).toContain('预算')
    expect(riskLabel(dictionary, {
      kind: 'quality-tradeoff',
      message: 'ignored',
    })).toContain('验证')
    expect(riskLabel(dictionary, {
      kind: 'concurrency-limit',
      requested: 4,
      applied: 2,
      message: 'ignored',
    })).toContain('4')
    expect(riskLabel(dictionary, {
      kind: 'unsupported-tech-stack',
      technology: 'Svelte',
      message: 'ignored',
    })).toContain('Svelte')
  })

  it('renders every controlled adjustment intent', () => {
    expect(adjustmentLabel(dictionary, {
      intent: { type: 'add-role-instance', role: 'frontend' },
      changes: [],
      explanation: 'ignored',
    })).toContain('前端')
    expect(adjustmentLabel(dictionary, {
      intent: { type: 'remove-role-instance', role: 'frontend' },
      changes: [],
      explanation: 'ignored',
    })).toContain('前端')
    expect(adjustmentLabel(dictionary, {
      intent: { type: 'raise-quality' },
      changes: [],
      explanation: 'ignored',
    })).toContain('验证')
    expect(adjustmentLabel(dictionary, {
      intent: { type: 'reduce-concurrency', maximum: 2 },
      changes: [],
      explanation: 'ignored',
    })).toContain('并行')
    expect(adjustmentLabel(dictionary, {
      intent: { type: 'reduce-scale' },
      changes: [],
      explanation: 'ignored',
    })).toContain('团队')
  })

  it('replaces every named placeholder without changing unknown text', () => {
    expect(format('{a}-{b}-{missing}', { a: 'one', b: 'two' }))
      .toBe('one-two-{missing}')
  })
})
