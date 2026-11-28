import { describe, expect, it } from 'vitest'
import { localeDictionaries } from '../src/locale/types.ts'
import {
  schedulerReason,
  schedulerReassignReason,
  schedulerRejectionReason,
} from '../src/pages/SchedulerPage.tsx'

const dictionary = localeDictionaries['zh-CN']
const english = localeDictionaries['en']

describe('scheduler selection reasons', () => {
  it('localizes the role reason with the role dictionary', () => {
    expect(schedulerReason(dictionary, 'highest weighted score for role ui-designer'))
      .toBe('「UI 设计」岗位的候选中权重得分最高')
    expect(schedulerReason(english, 'highest weighted score for role ui-designer'))
      .toBe('Highest weighted score for role UI designer')
  })

  it('localizes the retry reassignment reason', () => {
    expect(schedulerReason(dictionary, 'highest weighted score for reassignment of retry 2'))
      .toBe('重试第 2 轮的重新指派中权重得分最高')
  })

  it('falls back to the raw reason for unknown text', () => {
    const raw = 'future scheduling reason'
    expect(schedulerReason(dictionary, raw)).toBe(raw)
  })
})

describe('scheduler reassignment reasons', () => {
  it('localizes the previous-failure reason with the failure code', () => {
    expect(schedulerReassignReason(dictionary, 'previous attempt failed with BUILD_FAILED'))
      .toBe('上次尝试失败（错误码 BUILD_FAILED）')
  })

  it('falls back to the raw reason for unknown text', () => {
    const raw = 'manual operator decision'
    expect(schedulerReassignReason(dictionary, raw)).toBe(raw)
  })
})

describe('scheduler rejection reasons', () => {
  it('localizes the fixed rejection reasons', () => {
    expect(schedulerRejectionReason(dictionary, 'excluded after the previous failed assignment'))
      .toBe('上一轮分配失败后已被排除')
    expect(schedulerRejectionReason(dictionary, 'Agent is unavailable'))
      .toBe('Agent 当前不可用')
    expect(schedulerRejectionReason(dictionary, 'Agent is at concurrency capacity'))
      .toBe('Agent 已达并发上限')
  })

  it('interpolates the capability list into the capability rejection reason', () => {
    expect(schedulerRejectionReason(dictionary, 'missing required capabilities: browser, ssh'))
      .toBe('缺少所需能力：browser, ssh')
  })

  it('falls back to the raw reason for unknown text', () => {
    const raw = 'blocked by the operator'
    expect(schedulerRejectionReason(dictionary, raw)).toBe(raw)
  })
})
