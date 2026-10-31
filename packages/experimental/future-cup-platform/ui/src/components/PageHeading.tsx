import type { ReactNode } from 'react'

/** Render one page's operational title, description, and primary actions. */
export function PageHeading({
  title,
  description,
  actions,
}: {
  readonly title: string
  readonly description: string
  readonly actions?: ReactNode
}) {
  return (
    <header className="page-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions === undefined ? null : <div className="page-heading-actions">{actions}</div>}
    </header>
  )
}
