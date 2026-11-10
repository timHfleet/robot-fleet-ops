import type { ReactNode } from 'react'

export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={
        'rounded-lg border border-border bg-card text-card-foreground p-5 shadow-retool-sm ' + (className ?? '')
      }
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function PageGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{children}</div>
}

export function Loading() {
  return <div className="p-10 text-sm text-muted-foreground">Loading metrics…</div>
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {message}
    </div>
  )
}
