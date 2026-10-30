/** Deterministic normalization and hashing for repeated verification failures. */

import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { VerificationFinding } from './types.ts'

/**
 * Normalize one diagnostic so equivalent reruns produce the same signature.
 * @param message - raw compiler, build, browser, or network diagnostic.
 * @param workspace - generated project root whose absolute paths are unstable.
 * @returns a whitespace-, path-, and source-location-normalized message.
 */
export function normalizeVerificationMessage(message: string, workspace?: string): string {
  let normalized = message
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/\r\n?/gu, '\n')

  if (workspace !== undefined) {
    const absolute = resolve(workspace)
    normalized = normalized
      .replaceAll(absolute, '<workspace>')
      .replaceAll(absolute.replaceAll('\\', '/'), '<workspace>')
  }

  return normalized
    .replace(/[A-Za-z]:[\\/][^\s:]+/gu, '<path>')
    .replace(/\/(?:[^\s/:]+\/)+[^\s/:]+/gu, '<path>')
    .replace(/:\d+(?::\d+)?/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Hash a stable, order-independent representation of all findings.
 * @param findings - verification findings in discovery order.
 * @param workspace - optional generated project root for path normalization.
 * @returns a lower-case SHA-256 signature, or null when there are no findings.
 */
export function createFailureSignature(
  findings: readonly VerificationFinding[],
  workspace?: string,
): string | null {
  if (findings.length === 0) return null
  const canonical = findings
    .map(finding => ({
      category: finding.category,
      code: finding.code,
      severity: finding.severity,
      target: finding.target === undefined
        ? null
        : normalizeVerificationMessage(finding.target, workspace),
      message: normalizeVerificationMessage(finding.message, workspace),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
