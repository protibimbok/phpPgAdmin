import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { notify } from '@/notify'

export interface ObjectSectionLabels {
  name: string
  edit: string
  export: string
  drop: string
}

export interface ObjectSectionProps<Row extends { oid: number; name: string }> {
  id: string
  icon: string
  title: string
  rows: Row[]
  empty: string
  /** The create button; a list of objects created on the SQL page has none. */
  createLabel?: string
  createIcon?: string
  onCreate?: () => void
  columns: { label: string; render: (row: Row) => ReactNode }[]
  onEdit: (row: Row) => void
  onExport: (rows: Row[]) => void
  onDrop: (rows: Row[]) => void
  noneSelected: string
  labels: ObjectSectionLabels
  /** Shown instead of the Edit link for a row that cannot be edited. */
  canEdit?: (row: Row) => boolean
  /** A notice under the heading: the state the objects depend on (row security enabled or not). */
  notice?: ReactNode
  /** More buttons beside the create button. */
  actions?: ReactNode
}

/**
 * One list of schema objects after phpMyAdmin's triggers/list.twig: the heading, the check-all /
 * Export / Drop group with the create button, then the table with a row per object and its
 * Edit / Export / Drop links. The triggers, rules, policies, collations and text search lists
 * are all this.
 */
export default function ObjectSection<Row extends { oid: number; name: string }>({ id, icon, title, rows, empty, createLabel, createIcon, onCreate, columns, onEdit, onExport, onDrop, noneSelected, labels, canEdit, notice, actions }: ObjectSectionProps<Row>) {
  const { t: tApp } = useTranslation()
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(row.oid))
  const selected = () => rows.filter((row) => checked.has(row.oid))
  const withSelected = (action: (rows: Row[]) => void) => {
    const target = selected()
    if (target.length === 0) return notify(noneSelected, 'error')
    action(target)
  }

  function toggle(oid: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(oid)
      else next.delete(oid)

      return next
    })
  }

  return (
    <div className="container-fluid my-3" id={`${id}_section`}>
      <h2>
        <Icon name={icon} /> {title}
      </h2>

      {notice}

      <div className="d-flex flex-wrap my-3">
        {rows.length > 0 && (
          <div>
            <div className="input-group">
              <div className="input-group-text">
                <div className="form-check mb-0">
                  <input className="form-check-input checkall_box" type="checkbox" id={`${id}_checkAll`} checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.oid)) : new Set())} />
                  <label className="form-check-label" htmlFor={`${id}_checkAll`}>
                    {tApp('check_all')}
                  </label>
                </div>
              </div>
              <button className="btn btn-outline-secondary" type="button" title={labels.export} onClick={() => withSelected(onExport)}>
                <Icon name="b_export" /> {labels.export}
              </button>
              <button className="btn btn-outline-secondary" type="button" title={labels.drop} onClick={() => withSelected(onDrop)}>
                <Icon name="b_drop" /> {labels.drop}
              </button>
            </div>
          </div>
        )}
        {(onCreate || actions) && (
          <div className={rows.length > 0 ? 'ms-auto' : undefined}>
            {onCreate && (
              <button type="button" className="ajax add_anchor btn btn-primary" onClick={onCreate}>
                <Icon name={createIcon ?? 'b_plus'} /> {createLabel}
              </button>
            )}
            {actions}
          </div>
        )}
      </div>

      <form className="ajax" onSubmit={(e) => e.preventDefault()}>
        {rows.length === 0 ? (
          <div className="alert alert-primary" role="alert">
            <Icon name="s_notice" /> {empty}
          </div>
        ) : (
          <table id={`${id}Table`} className="table table-striped table-hover w-auto data">
            <thead>
              <tr>
                <th />
                <th>{labels.name}</th>
                {columns.map((column) => (
                  <th key={column.label}>{column.label}</th>
                ))}
                <th colSpan={3} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.oid}>
                  <td>
                    <input type="checkbox" className="checkall" checked={checked.has(row.oid)} onChange={(e) => toggle(row.oid, e.target.checked)} aria-label={row.name} />
                  </td>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  {columns.map((column) => (
                    <td key={column.label}>{column.render(row)}</td>
                  ))}
                  <td>
                    {(canEdit?.(row) ?? true) && (
                      <a
                        className="ajax edit_anchor"
                        href="#edit"
                        onClick={(e) => {
                          e.preventDefault()
                          onEdit(row)
                        }}
                      >
                        <Icon name="b_edit" /> {labels.edit}
                      </a>
                    )}
                  </td>
                  <td>
                    <a
                      className="ajax export_anchor"
                      href="#export"
                      onClick={(e) => {
                        e.preventDefault()
                        onExport([row])
                      }}
                    >
                      <Icon name="b_export" /> {labels.export}
                    </a>
                  </td>
                  <td>
                    <a
                      className="ajax drop_anchor"
                      href="#drop"
                      onClick={(e) => {
                        e.preventDefault()
                        onDrop([row])
                      }}
                    >
                      <Icon name="b_drop" /> {labels.drop}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>
    </div>
  )
}
