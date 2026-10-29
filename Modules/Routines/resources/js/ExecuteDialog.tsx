import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import Modal from '@/components/Modal'
import { qualifiedName, quoteIdent, quoteLiteral } from '@sql/js/sql'
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
  const { data: args, error } = useRequest(async (): Promise<Argument[] | null> => {
    if (!show || !routine) return null
    const properties = await routines(db, scid, routine.kind).properties(routine.oid)

    // A function's OUT arguments are its result; a procedure's are passed (as NULL) in the CALL.
    return routine.kind === 'procedure' ? properties.arguments : properties.arguments.filter((arg) => arg.argmode !== 'OUT')
  }, [show, routine?.kind, routine?.oid, db, scid])
  const inputs = args ? args.map((arg, i) => ({ arg, i })).filter(({ arg }) => arg.argmode !== 'OUT') : null

  useEffect(() => {
    setValues({})
  }, [routine])

  /**
   * The SELECT or CALL with the values typed in. An empty box of an argument with a default
   * leaves the argument out: trailing ones are dropped, and the arguments after one left out in
   * the middle go in named notation (name => value), or, if one of them has no name, the left
   * out ones get their default expression. A VARIADIC argument's array is marked VARIADIC.
   */
  function statement(list: Argument[]): string {
    if (!routine) return ''
    const parts = list.map((arg, i) => {
      if (arg.argmode === 'OUT') return { arg, sql: 'NULL' }
      const entry = values[i] ?? { value: '', isNull: false }
      if (entry.isNull) return { arg, sql: 'NULL' }
      const raw = entry.value
      if (raw === '' && arg.argdefval !== '') return { arg, sql: null }
      // Numbers and booleans go as they are; everything else as a literal of the argument's type.
      if (/^-?\d+(\.\d+)?$/.test(raw) || /^(true|false)$/i.test(raw)) return { arg, sql: raw }

      return { arg, sql: `${quoteLiteral(raw)}::${arg.argtype}` }
    })
    let end = parts.length
    while (end > 0 && parts[end - 1].sql === null) end--
    const kept = parts.slice(0, end)
    const firstSkipped = kept.findIndex((part) => part.sql === null)
    const named = firstSkipped >= 0 && kept.slice(firstSkipped).every((part) => part.sql === null || part.arg.argname !== '')
    const sql = kept.flatMap((part, i) => {
      const variadic = part.arg.argmode === 'VARIADIC' ? 'VARIADIC ' : ''
      if (part.sql === null) return named ? [] : [`${variadic}${part.arg.argdefval}`]
      if (named && i > firstSkipped) return [`${variadic}${quoteIdent(part.arg.argname)} => ${part.sql}`]

      return [`${variadic}${part.sql}`]
    })
    const call = `${qualifiedName(schema, routine.name)}(${sql.join(', ')})`

    return routine.kind === 'procedure' ? `CALL ${call}` : `SELECT * FROM ${call}`
  }

  // Nothing to ask for: run it.
  useEffect(() => {
    if (show && routine && args && inputs && inputs.length === 0) onRun(statement(args))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, routine, args])

  if (!show || !routine) return null

  return (
    <Modal
      show={show}
      title={t('execute.title')}
      onClose={onClose}
      footer={
        <>
          <button type="submit" form="rte_execute_form" className="btn btn-primary" disabled={!args}>
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
      ) : !args || !inputs ? (
        tApp('loading')
      ) : (
        <form id="rte_execute_form" className="rte_form" onSubmit={(e) => { e.preventDefault(); if (args) onRun(statement(args)) }}>
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
              {inputs.map(({ arg, i }) => (
                <tr key={i}>
                  <td>{arg.argname || `$${i + 1}`}</td>
                  <td dir="ltr">{arg.argtype}</td>
                  <td className="nowrap">
                    <input className="form-control" type="text" name={`params[${arg.argname || i}]`} value={values[i]?.value ?? ''} placeholder={arg.argdefval} disabled={values[i]?.isNull ?? false} onChange={(e) => setValues({ ...values, [i]: { value: e.target.value, isNull: false } })} aria-label={arg.argname || `$${i + 1}`} />
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
