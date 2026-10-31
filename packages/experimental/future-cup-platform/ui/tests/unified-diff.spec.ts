import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../src/diff/unified-diff.ts'

describe('parseUnifiedDiff', () => {
  it('classifies hunk, added, removed, and context lines', () => {
    expect(parseUnifiedDiff('@@ -1 +1 @@\n-old\n+new\n same')).toEqual([
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'removed', text: '-old' },
      { kind: 'added', text: '+new' },
      { kind: 'context', text: ' same' },
    ])
  })
})
