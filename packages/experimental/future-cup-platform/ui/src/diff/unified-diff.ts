export interface DiffLine {
  readonly kind: 'added' | 'removed' | 'hunk' | 'context'
  readonly text: string
}

/** Split one unified diff into display-safe line kinds. */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  return diff.split(/\r?\n/u).map((text) => {
    if (text.startsWith('@@')) return { kind: 'hunk', text }
    if (text.startsWith('+')) return { kind: 'added', text }
    if (text.startsWith('-')) return { kind: 'removed', text }
    return { kind: 'context', text }
  })
}
