import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Macro } from '../api'

export interface MacrosMenuProps {
  macros: Macro[]
  onManage: () => void
  onAdd: () => void
  onRun: (macro: Macro) => void
}

/**
 * pgAdmin's Macros menu as a Bootstrap dropdown among the SQL page's buttons: "Manage
 * macros", "Add to macros", then the macros themselves with their keys; picking one runs it.
 */
export default function MacrosMenu({ macros, onManage, onAdd, onRun }: MacrosMenuProps) {
  const { t } = useTranslation('sql')
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="btn-group me-2 dropdown" role="group" ref={root}>
      <button type="button" id="macros" className="btn btn-secondary dropdown-toggle sqlbutton" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('macros.title')}
      </button>
      <ul className={`dropdown-menu${open ? ' show' : ''}`} data-bs-popper="static" onClick={() => setOpen(false)}>
        <li>
          <a className="dropdown-item" href="#manage-macros" onClick={(e) => { e.preventDefault(); onManage() }}>
            {t('macros.manage')}
          </a>
        </li>
        <li>
          <a className="dropdown-item" href="#add-macro" onClick={(e) => { e.preventDefault(); onAdd() }}>
            {t('macros.add')}
          </a>
        </li>
        {macros.length > 0 && (
          <li>
            <hr className="dropdown-divider" />
          </li>
        )}
        {macros.map((macro) => (
          <li key={macro.id}>
            <a className="dropdown-item d-flex justify-content-between gap-3" href="#run-macro" title={macro.sql} onClick={(e) => { e.preventDefault(); onRun(macro) }}>
              <span className="text-truncate">{macro.name}</span>
              {macro.key && <kbd className="small">{macro.key}</kbd>}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The macro key a keyboard event stands for ("Ctrl+3", "Alt+F5"), or null. */
export function macroKeyOf(e: KeyboardEvent): string | null {
  if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && /^[0-9]$/.test(e.key)) return `Ctrl+${e.key}`
  if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && /^F([1-9]|1[0-2])$/.test(e.key)) return `Alt+${e.key}`

  return null
}
