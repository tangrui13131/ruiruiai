/** Render an empty state that preserves the owning panel's footprint. */
export function EmptyPanel({ text }: { readonly text: string }) {
  return <div className="empty-panel">{text}</div>
}
