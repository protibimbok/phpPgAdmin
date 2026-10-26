import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { errorMessage } from '@/api/request'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { notAvailable } from '@/unbuilt'
import { previewRows, saveRows, type ResultColumn, type RowKeys, type RowsResult, type Source } from '../api'
import { quoteIdent, quoteLiteral } from '../sql'
import type { CellEditor, ResultsGridProps } from './ResultsGrid'

export interface GridActionsOptions {
  db: string
  source: Source | null
  result: RowsResult | null
  /** Load the rows again after a change. */
  reload: () => void
  /** The insert/edit form of the table the rows come from. */
  changeUrl: string | null
}

export interface GridActions extends Pick<ResultsGridProps, 'rowActions' | 'bulkActions' | 'cellEditor'> {
  /** The confirmation modal for a bulk delete; render it with the grid. */
  modal: ReactNode
}

/**
 * What the Browse grid and the SQL page's grid do with an editable result: Edit and Copy open
 * the form, Delete asks and deletes, the "With selected" bar does the same for several rows,
 * and a double-click on a cell edits it in place and saves on Enter, as phpMyAdmin's grid does.
 */
export function useGridActions({ db, source, result, reload, changeUrl }: GridActionsOptions): GridActions {
  const { t } = useTranslation('sql')
  const navigate = useNavigate()
  const [pending, setPending] = useState<{ sql: string[] | null; error: string | null; keys: RowKeys[] } | null>(null)

  const editable = Boolean(source?.editable && result && changeUrl)
  if (!editable || !source || !result || !changeUrl) {
    return { rowActions: [], bulkActions: [], modal: null }
  }

  const keyIndexes = source.primary_keys.map((name) => result.columns.findIndex((c) => c.name === name && c.attnum !== null))
  const keysOf = (rowIndex: number): RowKeys => Object.fromEntries(source.primary_keys.map((name, i) => [name, result.rows[rowIndex][keyIndexes[i]]]))
  const openForm = (rows: number[], copy: boolean) => {
    const params = new URLSearchParams({ keys: JSON.stringify(rows.map(keysOf)) })
    if (copy) params.set('copy', '1')
    navigate(`${changeUrl}?${params}`)
  }
  const deleteStatement = (keys: RowKeys) =>
    `DELETE FROM ${quoteIdent(source.schema)}.${quoteIdent(source.table)} WHERE ${Object.entries(keys)
      .map(([k, v]) => `${quoteIdent(k)} ${v === null ? 'IS NULL' : `= ${quoteLiteral(v)}`}`)
      .join(' AND ')}`

  async function remove(keys: RowKeys[]) {
    try {
      const outcome = await saveRows(db, source!.schema, source!.table, { deleted: keys.map((k) => ({ keys: k })) })
      notifySuccess(t('message.deleted', { count: outcome.deleted }))
      reload()
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  function confirmBulkDelete(rows: number[]) {
    const keys = rows.map(keysOf)
    setPending({ sql: null, error: null, keys })
    previewRows(db, source!.schema, source!.table, { deleted: keys.map((k) => ({ keys: k })) }).then(
      (sql) => setPending((p) => (p && p.keys === keys ? { ...p, sql } : p)),
      (e: unknown) => setPending((p) => (p && p.keys === keys ? { ...p, error: errorMessage(e) } : p)),
    )
  }

  const cellEditor: CellEditor = {
    canEdit: (column: ResultColumn) => column.editable,
    save: async (rowIndex, column, value) => {
      try {
        await saveRows(db, source!.schema, source!.table, { updated: [{ keys: keysOf(rowIndex), values: { [column.name]: value } }] })
        notifySuccess(t('message.affected', { count: 1 }))
        reload()
      } catch (e) {
        notifyError(errorMessage(e))
        throw e
      }
    },
  }

  return {
    rowActions: [
      { label: t('grid.edit'), icon: 'b_edit', title: t('grid.double_click_hint'), onClick: (row) => openForm([row], false) },
      { label: t('grid.copy'), icon: 'b_insrow', onClick: (row) => openForm([row], true) },
      {
        label: t('grid.delete'),
        icon: 'b_drop',
        className: 'delete_row requireConfirm ajax',
        onClick: (row) => {
          const keys = keysOf(row)
          if (window.confirm(t('grid.do_you_really', { sql: deleteStatement(keys) }))) void remove([keys])
        },
      },
    ],
    bulkActions: [
      { label: t('grid.edit'), icon: 'b_edit', onClick: (rows) => openForm(rows, false) },
      { label: t('grid.copy'), icon: 'b_insrow', onClick: (rows) => openForm(rows, true) },
      { label: t('grid.delete'), icon: 'b_drop', onClick: confirmBulkDelete },
      { label: t('grid.export'), icon: 'b_tblexport', onClick: () => notAvailable() },
    ],
    cellEditor,
    modal: (
      <PreviewSql
        show={pending !== null}
        sql={pending?.sql ? pending.sql.map((s) => `${s};`).join('\n') : null}
        error={pending?.error}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const keys = pending?.keys ?? []
          setPending(null)
          void remove(keys)
        }}
        confirmLabel={t('grid.yes')}
      />
    ),
  }
}
