import { describe, expect, it } from 'vitest'
import { localeDictionaries } from '../src/locale/types.ts'

function keys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`
    return typeof child === 'object' && child !== null ? keys(child, path) : [path]
  }).sort()
}

describe('management locale dictionaries', () => {
  it('keeps Chinese and English keys aligned', () => {
    expect(keys(localeDictionaries.en)).toEqual(keys(localeDictionaries['zh-CN']))
  })

  it('defines every durable status label', () => {
    expect(Object.keys(localeDictionaries['zh-CN'].statuses).sort()).toEqual([
      'blocked',
      'cancelled',
      'completed',
      'escalated',
      'fail',
      'failed',
      'incomplete',
      'pass',
      'passed',
      'pending',
      'ready',
      'running',
      'skipped',
      'warning',
    ])
  })
})
