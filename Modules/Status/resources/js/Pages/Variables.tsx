import { Fragment, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { notify, notifyError, notifySuccess } from '@/notify'
import { setVariable, variable as fetchVariable, variables, type Variable } from '../api'

/** phpMyAdmin prints a variable's name with spaces for its underscores. */
const label = (name: string) => name.replaceAll('_', ' ')

/**
 * phpMyAdmin's Server variables and settings for pg_settings: the Filters card ("Containing
 * the word", matched as phpMyAdmin does with spaces read as underscores), then every parameter
 * with Edit where this role may ALTER SYSTEM it. Edit loads the parameter and swaps the value
 * for an editor (a select for a boolean or an enum) with Cancel, Reset (ALTER SYSTEM RESET) and
 * Save; Enter saves and Escape cancels, as in phpMyAdmin. A parameter changed for the next
 * restart gets a second, italic row with that value, as phpMyAdmin's session values do.
 * ?filter= fills the filter, as phpMyAdmin's ?filter= does.
 */
export default function Variables() {
  const { t } = useTranslation('status')
  const { t: tApp } = useTranslation()
  const { data, error } = useRequest(() => variables(), [])
  // The parameters saved since the list loaded, as the server read them back.
  const [saved, setSaved] = useState<Record<string, Variable>>({})
  const [search] = useSearchParams()
  const [filter, setFilter] = useState(() => search.get('filter') ?? '')
  const [editing, setEditing] = useState<{ variable: Variable; value: string } | null>(null)

  const shown = useMemo(() => {
    const word = filter.toUpperCase().replace(/ /g, '_')

    return (data?.variables ?? []).filter((v) => v.name.toUpperCase().includes(word)).map((v) => saved[v.name] ?? v)
  }, [data, saved, filter])

  async function edit(name: string) {
    try {
      const { variable } = await fetchVariable(name)
      setEditing({ variable, value: variable.pending ?? variable.value })
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  async function save(change: { value: string } | { reset: true }) {
    if (!editing) return
    notify(t('variables.processing'), 'notice', null)
    try {
      const result = await setVariable(editing.variable.name, change)
      setSaved((s) => ({ ...s, [result.variable.name]: result.variable }))
      setEditing(null)
      notifySuccess(result.restart ? t('variables.saved_restart', { name: result.variable.name }) : t('variables.saved', { name: result.variable.name }))
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  return (
    <div className="container-fluid">
      <div className="row">
        <h2>
          <Icon name="s_vars" /> {t('variables.title')}{' '}
          <a href="https://www.postgresql.org/docs/current/runtime-config.html" target="_blank" rel="noopener noreferrer">
            <Icon name="b_help" title={tApp('postgresql_documentation')} />
          </a>
        </h2>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      <div className="card mb-3" id="tableFilter">
        <div className="card-header">{t('processes.filters')}</div>
        <div className="card-body row row-cols-lg-auto gy-1 gx-3 align-items-center">
          <label className="col-12 col-form-label" htmlFor="filterText">
            {t('variables.containing')}
          </label>
          <div className="col-12">
            <input className="form-control" name="filterText" type="text" id="filterText" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="table-responsive">
        <table id="serverVariables" className="table table-striped table-hover table-sm">
          <thead>
            <tr>
              <th scope="col">{t('variables.action')}</th>
              <th scope="col">{t('variables.variable')}</th>
              <th scope="col" className="text-end">
                {t('variables.value')}
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => {
              const open = editing?.variable.name === v.name

              return (
                <Fragment key={v.name}>
                  <tr className="var-row">
                    <td className={open ? 'edit' : undefined}>
                      {open ? (
                        <div className="d-flex gap-3">
                          <a href="#cancel" className="cancelLink" onClick={(e) => { e.preventDefault(); setEditing(null) }}>
                            <Icon name="b_close" /> {t('variables.cancel')}
                          </a>
                          <a href="#reset" className="resetLink" title={t('variables.reset_title')} onClick={(e) => { e.preventDefault(); void save({ reset: true }) }}>
                            <Icon name="b_undo" /> {t('variables.reset')}
                          </a>
                          <a href="#save" className="ajax saveLink" onClick={(e) => { e.preventDefault(); void save({ value: editing.value }) }}>
                            <Icon name="b_save" /> {t('variables.save')}
                          </a>
                        </div>
                      ) : v.editable ? (
                        <a href="#edit" data-variable={v.name} className="editLink" onClick={(e) => { e.preventDefault(); void edit(v.name) }}>
                          <Icon name="b_edit" /> {t('variables.edit')}
                        </a>
                      ) : (
                        <span title={v.context === 'internal' ? t('variables.read_only') : t('variables.not_allowed')} className="read_only_var">
                          <Icon name="bd_edit" /> {t('variables.edit')}
                        </span>
                      )}
                    </td>
                    <td className="var-name fw-bold">
                      <span title={v.extra_desc ? `${v.short_desc} ${v.extra_desc}` : v.short_desc}>{label(v.name)}</span>
                    </td>
                    <td className="var-value text-end font-monospace">
                      {open ? <Editor variable={editing.variable} value={editing.value} onChange={(value) => setEditing({ ...editing, value })} onSave={() => void save({ value: editing.value })} onCancel={() => setEditing(null)} /> : v.value.replaceAll(',', ',​')}
                    </td>
                  </tr>
                  {v.pending_restart && (
                    <tr className="var-row">
                      <td></td>
                      <td className="var-name fst-italic">
                        {label(v.name)} ({t('variables.after_restart')})
                      </td>
                      <td className="var-value text-end font-monospace">{v.pending ?? ''}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface EditorProps {
  variable: Variable
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}

/** phpMyAdmin's .serverVariableEditor: one small field, focused, Enter to save and Escape to cancel. */
function Editor({ variable, value, onChange, onSave, onCancel }: EditorProps) {
  const options = variable.vartype === 'bool' ? ['on', 'off'] : variable.vartype === 'enum' ? (variable.enumvals ?? []) : null
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSave()
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className="serverVariableEditor">
      {options ? (
        <select className="form-select form-select-sm" autoFocus value={value} aria-label={variable.name} onChange={(e) => onChange(e.target.value)} onKeyDown={keys}>
          {!options.includes(value) && <option value={value}>{value}</option>}
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input type="text" className="form-control form-control-sm" autoFocus value={value} aria-label={variable.name} title={range(variable)} onChange={(e) => onChange(e.target.value)} onKeyDown={keys} />
      )}
    </div>
  )
}

/** "64 … 2147483647 kB" for a number, so the editor tells what it accepts. */
function range(variable: Variable): string | undefined {
  if (variable.min_val === null || variable.max_val === null) return undefined

  return `${variable.min_val} … ${variable.max_val}${variable.unit ? ` ${variable.unit}` : ''}`
}
