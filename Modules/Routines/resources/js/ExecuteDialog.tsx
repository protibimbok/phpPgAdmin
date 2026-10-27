import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import Modal from '@/components/Modal'
import { qualifiedName, quoteLiteral } from '@sql/js/sql'
import { routines, type Argument, type RoutineKind } from './api'

export interface ExecuteDialogProps {
  show: boolean
  db: string
  scid: number
  schema: string
  /** The routine to run; its arguments are fetched when the dialog opens. */
  routine: { kind: RoutineKind; oid: number; name: string } | null
  onClose: () => void
  /** Called with the SELECT or CALL to run. */
  onRun: (sql: string) => void
}

/**
 * phpMyAdmin's execute_form.twig: the routine's parameters (name, type, a value box each) in
 * a dialog; Go builds "SELECT * FROM schema.fn(values)" (or CALL for a procedure) and hands it
 * over. A routine without input arguments runs at once, as phpMyAdmin's execute_routine does.
 */
export default function ExecuteDialog({ show, db, scid, schema, routine, onClose, onRun }: ExecuteDialogProps) {
  const { t } = useTranslation('routines')
  const { t: tApp } = useTranslation()
  const [values, setValues] = useState<Record<number, { value: string; isNull: boolean }>>({})
  const { data: inputs, error } = useRequest(async (): Promise<Argument[] | null> => {
    if (!show || !routine) return null
    const properties = await routines(db, scid, routine.kind).properties(routine.oid)

    return properties.arguments.filter((arg) => arg.argmode !== 'OUT')
  }, [show, routine?.kind, routine?.oid, db, scid])

  useEffect(() => {
    setValues({})
  }, [routine])

  function statement(args: Argument[]): string {
    if (!routine) return ''
    const list = args.map((arg, i) => {
      const entry = values[i] ?? { value: '', isNull: false }
      if (entry.isNull) return 'NULL'
      const raw = entry.value
      // Numbers and booleans go as they are; everything else as a literal of the argument's type.
      if (/^-?\d+(\.\d+)?$/.test(raw) || /^(true|false)$/i.test(raw)) return raw

      return `${quoteLiteral(raw)}::${arg.argtype}`
    })
    const call = `${qualifiedName(schema, routine.name)}(${list.join(', ')})`

    return routine.kind === 'procedure' ? `CALL ${call}` : `SELECT * FROM ${call}`
  }

  // Nothing to ask for: run it.
  useEffect(() => {
    if (show && routine && inputs && inputs.length === 0) onRun(statement(inputs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, routine, inputs])

  if (!show || !routine) return null

  return (
    <Modal
      show={show}
      title={t('execute.title')}
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="rte_execute_form" className="btn btn-primary" disabled={!inputs}>
            {tApp('go')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('close')}
          </button>
        </>
      }
    >
      {error ? (
        <div className="alert alert-danger mb-0" role="alert">
          {error.message}
        </div>
      ) : !inputs ? (
        tApp('loading')
      ) : (
        <form id="rte_execute_form" className="rte_form" onSubmit={(e) => { e.preventDefault(); onRun(statement(inputs)) }}>
          <table className="table w-auto rte_table">
            <thead>
              <tr>
                <th>{t('execute.name')}</th>
                <th>{t('execute.type')}</th>
                <th>{t('execute.value')}</th>
                <th>NULL</th>
              </tr>
            </thead>
            <tbody>
              {inputs.map((arg, i) => (
                <tr key={i}>
                  <td>{arg.argname || `$${i + 1}`}</td>
                  <td dir="ltr">{arg.argtype}</td>
                  <td className="nowrap">
                    <input className="form-control" type="text" name={`params[${arg.argname || i}]`} value={values[i]?.value ?? ''} disabled={values[i]?.isNull ?? false} onChange={(e) => setValues({ ...values, [i]: { value: e.target.value, isNull: false } })} aria-label={arg.argname || `$${i + 1}`} />
                  </td>
                  <td className="text-center">
                    <input type="checkbox" checked={values[i]?.isNull ?? false} onChange={(e) => setValues({ ...values, [i]: { value: values[i]?.value ?? '', isNull: e.target.checked } })} aria-label="NULL" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </form>
      )}
    </Modal>
  )
}
