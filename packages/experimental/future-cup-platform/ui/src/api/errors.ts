import type { Dictionary } from '../locale/types.ts'
import { ApiRequestError } from './client.ts'

type ErrorDictionary = Dictionary['errors']

const CODE_TO_KEY: Readonly<Record<string, keyof ErrorDictionary>> = {
  PROJECT_RUN_ACTIVE: 'projectRunActive',
  PROJECT_RUN_START_FAILED: 'projectRunStartFailed',
  WORKFLOW_FENCE_LOST: 'workflowFenceLost',
  PROJECT_RUN_INTERRUPTED: 'projectRunInterrupted',
  PROJECT_RUN_FAILED: 'projectRunFailed',
  PROJECT_RUN_SETTLEMENT_PENDING: 'projectRunSettlementPending',
  PROJECT_RUN_SETTLEMENT_TIMEOUT: 'projectRunSettlementTimeout',
  PROJECT_EXISTS: 'projectExists',
  PROJECT_NOT_FOUND: 'projectNotFound',
  INVALID_REQUEST: 'invalidRequest',
  RUN_LAUNCHER_UNAVAILABLE: 'runLauncherUnavailable',
  RUN_NOT_FOUND: 'runNotFound',
  INCOMPLETE_TEAM: 'teamIncomplete',
  TEAM_RECOMMENDATION_INCOMPLETE: 'teamIncomplete',
  CAPABILITY_NOT_COVERED: 'teamIncomplete',
  CONCURRENCY_INSUFFICIENT: 'teamIncomplete',
  TOOL_POLICY_INVALID: 'teamIncomplete',
  MEMORY_POLICY_INVALID: 'teamIncomplete',
  OUTPUT_CONTRACT_INVALID: 'teamIncomplete',
  REALTIME_CONNECTION_FAILED: 'realtimeConnection',
  INVALID_REALTIME_DATA: 'realtimeData',
  INVALID_CURSOR: 'realtimeData',
  SNAPSHOT_FAILED: 'realtimeData',
  INTERNAL_ERROR: 'unknown',
  REQUEST_FAILED: 'unknown',
}

/** Map one stable API or realtime code to localized text. */
export function localizedErrorCode(
  code: string | undefined,
  errors: ErrorDictionary,
  fallback: string,
): string {
  const key = code === undefined ? undefined : CODE_TO_KEY[code]
  return key === undefined ? fallback : errors[key]
}

/** Map one caught API failure without exposing the backend's English message. */
export function localizedApiError(
  error: unknown,
  errors: ErrorDictionary,
  fallback: string,
): string {
  return localizedErrorCode(
    apiErrorCode(error),
    errors,
    fallback,
  )
}

/** Extract the stable API code from a caught failure. */
export function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiRequestError ? error.code : undefined
}
