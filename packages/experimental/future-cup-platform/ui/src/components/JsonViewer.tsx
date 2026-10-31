/** Render JSON as escaped, scrollable text. */
export function JsonViewer({ value }: { readonly value: unknown }) {
  return <pre className="json-viewer">{JSON.stringify(value, null, 2)}</pre>
}
