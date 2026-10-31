import { parseUnifiedDiff } from '../diff/unified-diff.ts'

/** Render a unified diff with line-level added, removed, and hunk treatment. */
export function UnifiedDiffViewer({
  diff,
  ariaLabel,
}: {
  readonly diff: string
  readonly ariaLabel: string
}) {
  return (
    <div className="diff-viewer" role="region" aria-label={ariaLabel}>
      {parseUnifiedDiff(diff).map((line, index) => (
        <div className={`diff-line diff-line-${line.kind}`} key={`${String(index)}-${line.text}`}>
          {line.text || ' '}
        </div>
      ))}
    </div>
  )
}
