import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../src/api/client.ts'
import { localizedApiError, localizedErrorCode } from '../src/api/errors.ts'
import { localeDictionaries } from '../src/locale/types.ts'

describe('localized API errors', () => {
  const errors = localeDictionaries['zh-CN'].errors

  it.each([
    ['PROJECT_RUN_ACTIVE', errors.projectRunActive],
    ['PROJECT_RUN_START_FAILED', errors.projectRunStartFailed],
    ['WORKFLOW_FENCE_LOST', errors.workflowFenceLost],
    ['PROJECT_EXISTS', errors.projectExists],
    ['PROJECT_RUN_SETTLEMENT_PENDING', errors.projectRunSettlementPending],
    ['PROJECT_RUN_SETTLEMENT_TIMEOUT', errors.projectRunSettlementTimeout],
  ])('maps %s without exposing the backend message', (code, expected) => {
    const error = new ApiRequestError(409, code, 'backend English message')
    expect(localizedApiError(error, errors, errors.unknown)).toBe(expected)
  })

  it('uses a localized fallback for unknown failures', () => {
    expect(localizedApiError(
      new ApiRequestError(500, 'UNRECOGNIZED_CODE', 'backend English message'),
      errors,
      errors.createProject,
    )).toBe(errors.createProject)
    expect(localizedApiError(new Error('network exploded'), errors, errors.cancelProject))
      .toBe(errors.cancelProject)
  })

  it('maps realtime error codes through the same dictionary', () => {
    expect(localizedErrorCode('INVALID_CURSOR', errors, errors.unknown))
      .toBe(errors.realtimeData)
  })
})
