import { useMemo, type ReactNode } from 'react'
import { PostgreSQL } from '@codemirror/lang-sql'
import { classHighlighter, highlightCode } from '@lezer/highlight'

export interface HighlightedSqlProps {
  sql: string
}

/**
 * SQL shown read-only with syntax colours, as phpMyAdmin highlights a query in its
 * .result_query box: a <code class="sql"> block holding the highlighted lines, whose tokens
 * carry the lezer "tok-*" classes that _results.scss colours like CodeMirror's default theme.
 */
export default function HighlightedSql({ sql }: HighlightedSqlProps) {
  const nodes = useMemo(() => highlight(sql), [sql])

  return (
    <code className="sql" dir="ltr">
      <div className="sql-highlight">{nodes}</div>
    </code>
  )
}

function highlight(sql: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const tree = PostgreSQL.language.parser.parse(sql)
  let key = 0

  highlightCode(
    sql,
    tree,
    classHighlighter,
    (text, classes) => {
      nodes.push(classes ? <span key={key++} className={classes}>{text}</span> : text)
    },
    () => {
      nodes.push('\n')
    },
  )

  return nodes
}
