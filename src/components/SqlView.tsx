import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

export interface SqlViewProps {
  sql: string
  title?: string
}

/**
 * Statements shown read-only, the way phpMyAdmin shows a query in a .result_query box or a
 * "Show create" modal: in a <pre>, left-to-right, with a copy-to-clipboard link.
 */
export default function SqlView({ sql, title }: SqlViewProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  function copy() {
    void navigator.clipboard?.writeText(sql).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="card">
      {title && <div className="card-header">{title}</div>}
      <div className="card-body">
        <div className="preview_sql">
          <pre>
            <code className="sql" dir="ltr">
              {sql}
            </code>
          </pre>
        </div>
      </div>
      <div className="card-footer d-print-none">
        <a href="#copy" onClick={(e) => { e.preventDefault(); copy() }}>
          <Icon name="b_insrow" /> {copied ? t('copied') : t('copy_to_clipboard')}
        </a>
      </div>
    </div>
  )
}
