import { useLocale } from '../locale/LocaleProvider.tsx'
import type { Dictionary } from '../locale/types.ts'

const STATUS_CLASS: Readonly<Record<string, string>> = {
  PENDING: 'status-neutral',
  READY: 'status-running',
  RUNNING: 'status-running',
  COMPLETED: 'status-success',
  PASSED: 'status-success',
  PASS: 'status-success',
  WARNING: 'status-warning',
  FAILED: 'status-danger',
  FAIL: 'status-danger',
  BLOCKED: 'status-warning',
  CANCELLED: 'status-neutral',
  ESCALATED: 'status-danger',
  INCOMPLETE: 'status-warning',
  SKIPPED: 'status-neutral',
}

const STATUS_LOCALE_KEY: Readonly<Record<string, keyof Dictionary['statuses']>> = {
  PENDING: 'pending',
  READY: 'ready',
  RUNNING: 'running',
  COMPLETED: 'completed',
  PASSED: 'passed',
  PASS: 'pass',
  WARNING: 'warning',
  FAILED: 'failed',
  FAIL: 'fail',
  BLOCKED: 'blocked',
  CANCELLED: 'cancelled',
  ESCALATED: 'escalated',
  INCOMPLETE: 'incomplete',
  SKIPPED: 'skipped',
}

/** Render a text-backed state badge so color is never the only signal. */
export function StatusBadge({ status }: { readonly status: string }) {
  const { dictionary } = useLocale()
  const className = STATUS_CLASS[status] ?? 'status-neutral'
  const key = STATUS_LOCALE_KEY[status]
  const label = key === undefined ? status : dictionary.statuses[key]
  return <span className={`status-badge ${className}`}>{label}</span>
}
