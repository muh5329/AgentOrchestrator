import React, { useMemo } from 'react'
import { toHtml } from '@shared/markdown'

/** Renders the application's markdown dialect. See shared/markdown.ts. */
export function Markdown({
  children,
  className = ''
}: {
  children: string
  className?: string
}): React.JSX.Element {
  const html = useMemo(() => toHtml(children ?? ''), [children])
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
