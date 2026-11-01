/** Stable SHA-256 identities for immutable persisted JSON documents. */

import { createHash } from 'node:crypto'
import type { JsonValue } from './types.ts'

/**
 * Hash one JSON value after sorting object keys recursively.
 * @param value - JSON-compatible durable value.
 * @returns lowercase SHA-256 digest.
 */
export function checksumJson(value: JsonValue): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}
