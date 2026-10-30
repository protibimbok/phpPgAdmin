import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/components/Modal'

export type BulkAction = 'copy_tbl' | 'add_prefix_tbl' | 'replace_prefix_tbl' | 'copy_tbl_change_prefix'

export interface BulkValues {
  /** Copy table: the schema the copies go to. */
  schema: string
  what: 'structure' | 'data' | 'dataonly'
  drop_if_exists: boolean
  add_constraints: boolean
  /** Add prefix. */
  prefix: string
  /** Replace prefix and Copy table with prefix. */
  from: string
  to: string
}

export interface BulkTableDialogProps {
  action: BulkAction | null
  /** The schemas a copy may go to; the current one is chosen first. */
  schemas: string[]
  schema: string
  onClose: () => void
  onContinue: (action: BulkAction, values: BulkValues) => void
}

/**
 * phpMyAdmin's bulk action modal (database/structure/bulk_action_modal.twig) with the form of
 * the chosen action: copy_form.twig ("Copy tables to"), add_prefix.twig ("Add table prefix") and
 * change_prefix_form.twig ("Replace table with prefix", "Copy table with prefix"). The copy goes
 * to another schema of this database, as PostgreSQL cannot copy a table across databases.
 */
export default function BulkTableDialog({ action, schemas, schema, onClose, onContinue }: BulkTableDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [values, setValues] = useState<BulkValues>({ schema, what: 'data', drop_if_exists: false, add_constraints: true, prefix: '', from: '', to: '' })

  // Each opening starts from phpMyAdmin's defaults.
  useEffect(() => {
    if (action) setValues({ schema, what: 'data', drop_if_exists: false, add_constraints: true, prefix: '', from: '', to: '' })
  }, [action, schema])

  const set = (patch: Partial<BulkValues>) => setValues((current) => ({ ...current, ...patch }))
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (action) onContinue(action, values)
  }
  const title = action ? t(`schema_structure.bulk.${action}_title`) : ''

  return (
    <Modal
      show={action !== null}
      title={title}
      id="bulkActionModal"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('cancel')}
          </button>
          <button type="button" className="btn btn-primary" id="bulkActionContinue" onClick={() => submit()}>
            {tApp('continue')}
          </button>
        </>
      }
    >
      <form id="ajax_form" onSubmit={submit}>
        {action === 'copy_tbl' && (
          <>
            <div className="mb-3">
              <label htmlFor="databaseNameSelect" className="form-label">
                {t('schema_structure.bulk.schema')}
              </label>
              <select className="form-select" id="databaseNameSelect" name="target_db" value={values.schema} onChange={(e) => set({ schema: e.target.value })}>
                {schemas.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="mb-3">
              <legend className="col-form-label">{t('schema_structure.bulk.options')}</legend>
              {(['data', 'structure', 'dataonly'] as const).map((what) => (
                <div key={what} className="form-check">
                  <input className="form-check-input" type="radio" name="what" id={`what_${what}_radio`} value={what} checked={values.what === what} onChange={() => set({ what })} />
                  <label className="form-check-label" htmlFor={`what_${what}_radio`}>
                    {t(`operations.what.${what}`)}
                  </label>
                </div>
              ))}
            </fieldset>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" name="drop_if_exists" id="addDropTableCheckbox" checked={values.drop_if_exists} onChange={(e) => set({ drop_if_exists: e.target.checked })} />
              <label className="form-check-label" htmlFor="addDropTableCheckbox">
                {t('operations.add_drop_table')}
              </label>
            </div>
            <div className="form-check mb-3">
              <input className="form-check-input" type="checkbox" name="add_constraints" id="addConstraintsCheckbox" checked={values.add_constraints} onChange={(e) => set({ add_constraints: e.target.checked })} />
              <label className="form-check-label" htmlFor="addConstraintsCheckbox">
                {t('operations.add_constraints')}
              </label>
            </div>
          </>
        )}
        {action === 'add_prefix_tbl' && (
          <div>
            <label htmlFor="addTablePrefixInput" className="form-label">
              {t('schema_structure.bulk.add_prefix')}
            </label>
            <input type="text" className="form-control" id="addTablePrefixInput" name="add_prefix" value={values.prefix} onChange={(e) => set({ prefix: e.target.value })} autoFocus />
          </div>
        )}
        {(action === 'replace_prefix_tbl' || action === 'copy_tbl_change_prefix') && (
          <>
            <div className="mb-3">
              <label htmlFor="initialPrefixInput" className="form-label">
                {t('schema_structure.bulk.from')}
              </label>
              <input type="text" className="form-control" id="initialPrefixInput" name="from_prefix" value={values.from} onChange={(e) => set({ from: e.target.value })} autoFocus />
            </div>
            <div>
              <label htmlFor="newPrefixInput" className="form-label">
                {t('schema_structure.bulk.to')}
              </label>
              <input type="text" className="form-control" id="newPrefixInput" name="to_prefix" value={values.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
          </>
        )}
      </form>
    </Modal>
  )
}

/** phpMyAdmin's ReplacePrefixController: a name that starts with "from" gets "to" in its place; others stay. */
export function replacedPrefix(name: string, from: string, to: string): string {
  return name.startsWith(from) ? to + name.slice(from.length) : name
}

/** phpMyAdmin's CopyTableWithPrefixController: the first characters, as many as "from" has, become "to". */
export function copiedPrefix(name: string, from: string, to: string): string {
  return to + [...name].slice([...from].length).join('')
}
