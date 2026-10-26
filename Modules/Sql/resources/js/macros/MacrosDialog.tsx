import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import { notifyError, notifySuccess } from '@/notify'
import { createMacro, deleteMacro, updateMacro, type Macro } from '../api'

export interface MacrosDialogProps {
  show: boolean
  macros: Macro[]
  keys: string[]
  /** The query in the box, which a new row starts from. */
  currentSql: string
  onClose: () => void
  onSaved: () => void
}

interface Row {
  id: number | null
  key: string
  name: string
  sql: string
}

/** The next free "Macro N" name, as pgAdmin's getRandomName picks it. */
export function nextMacroName(taken: string[], t: (key: string, options: { number: number }) => string): string {
  let number = taken.length + 1
  for (;;) {
    const candidate = t('macros.default_name', { number })
    if (!taken.some((name) => name.toLowerCase() === candidate.toLowerCase())) return candidate
    number++
  }
}

/**
 * pgAdmin's "Manage macros" dialog: one row per macro with its key, name and SQL, rows added
 * and removed in place, saved together. Names and keys must be unique; a row's key may be left
 * blank, in which case the macro is only in the menu.
 */
export default function MacrosDialog({ show, macros, keys, currentSql, onClose, onSaved }: MacrosDialogProps) {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (show) setRows(macros.map((m) => ({ id: m.id, key: m.key ?? '', name: m.name, sql: m.sql })))
  }, [show, macros])

  const update = (i: number, patch: Partial<Row>) => setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  function addRow() {
    setRows((current) => [...current, { id: null, key: '', name: nextMacroName(current.map((row) => row.name), t), sql: currentSql }])
  }

  /** What stops the rows from being saved, if anything. */
  function problem(): string | null {
    if (rows.some((row) => row.name.trim() === '' || row.sql.trim() === '')) return t('macros.name_required')
    const names = rows.map((row) => row.name.trim().toLowerCase())
    if (new Set(names).size !== names.length) return t('macros.unique_name')
    const bound = rows.map((row) => row.key).filter(Boolean)
    if (new Set(bound).size !== bound.length) return t('macros.unique_key')

    return null
  }

  async function save() {
    const why = problem()
    if (why) return notifyError(why)
    setBusy(true)
    try {
      // Deletions first so a freed name or key can be reused by a row below.
      for (const macro of macros) {
        if (!rows.some((row) => row.id === macro.id)) await deleteMacro(macro.id)
      }
      // Keys are released before they are claimed: rows that give up a key go first.
      const changed = rows.filter((row) => {
        const was = row.id === null ? null : macros.find((m) => m.id === row.id)
        return !was || was.name !== row.name.trim() || was.sql !== row.sql || (was.key ?? '') !== row.key
      })
      const release = changed.filter((row) => row.id !== null && row.key === '')
      const rest = changed.filter((row) => !release.includes(row))
      for (const row of [...release, ...rest]) {
        const input = { name: row.name.trim(), sql: row.sql, key: row.key || null }
        if (row.id === null) await createMacro(input)
        else await updateMacro(row.id, input)
      }
      notifySuccess(t('macros.saved'))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      show={show}
      onClose={onClose}
      id="macrosDialogModal"
      size="lg"
      title={t('macros.manage')}
      footer={
        <>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {t('macros.save')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('close')}
          </button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void save() }}>
        <div className="table-responsive">
          <table className="table table-striped table-hover table-sm align-middle" id="macros_table">
            <thead>
              <tr>
                <th>{t('macros.key')}</th>
                <th>{t('macros.name')}</th>
                <th className="w-50">{t('macros.sql')}</th>
                <th className="d-print-none" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center text-muted">
                    {t('macros.none')}
                  </td>
                </tr>
              )}
              {rows.map((row, i) => (
                <tr key={row.id ?? `new_${i}`} className="noclick">
                  <td>
                    <select className="form-select form-select-sm" value={row.key} aria-label={t('macros.key')} onChange={(e) => update(i, { key: e.target.value })}>
                      <option value="">{t('macros.no_key')}</option>
                      {keys.map((key) => (
                        <option key={key} value={key} disabled={rows.some((other, j) => j !== i && other.key === key)}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="form-control form-control-sm" type="text" value={row.name} maxLength={1024} required aria-label={t('macros.name')} onChange={(e) => update(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <textarea className="form-control form-control-sm font-monospace" rows={2} value={row.sql} required aria-label={t('macros.sql')} dir="ltr" onChange={(e) => update(i, { sql: e.target.value })} />
                  </td>
                  <td className="text-nowrap">
                    <a href="#delete-macro" onClick={(e) => { e.preventDefault(); setRows((current) => current.filter((_, j) => j !== i)) }}>
                      <Icon name="b_drop" /> {t('macros.delete')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
          <Icon name="b_insrow" /> {t('macros.add_row')}
        </button>
        <div className="form-text">{t('macros.key_hint')}</div>
      </form>
    </Modal>
  )
}
