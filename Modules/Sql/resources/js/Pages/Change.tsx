import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { urls, useLevel, type RelationKind } from '@/level'
import { fetchRow, previewRows, relationColumns, saveRows, ROW_FUNCTIONS, type CellValue, type RelationColumn, type RowChanges, type RowKeys } from '../api'
import DateTimeInput from '../fields/DateTimeInput'
import ForeignSelect from '../fields/ForeignSelect'
import {
  byteaLength,
  charInTextarea,
  charLength,
  defaultText,
  enumAsSelect,
  fieldKind,
  fieldSize,
  fileAsBytea,
  fractionDigits,
  hasTimeZone,
  inputDataType,
  integerRange,
  padFraction,
  validationError,
  type DateKind,
} from '../fields/kinds'

/** How many blank rows the Insert page offers: phpMyAdmin's InsertRows. */
const INSERT_ROWS = 2

/** phpMyAdmin's TextareaRows / TextareaCols for a text column, CharTextareaRows / CharTextareaCols for a long character one. */
const TEXTAREA_ROWS = 15
const TEXTAREA_COLS = 40
const CHAR_TEXTAREA_ROWS = 7
const CHAR_TEXTAREA_COLS = 40

interface Field {
  value: string
  isNull: boolean
  func: string
  /** Whether the user changed the field; an untouched field is left to the server (its default, or its current value). */
  touched: boolean
  /** What phpMyAdmin's client-side rules object to, shown after the field. */
  error: string | null
}

interface FormRow {
  /** The row's primary key when editing; null for a new row. */
  keys: RowKeys | null
  fields: Record<string, Field>
  /** phpMyAdmin's "Ignore" box over the extra insert rows: checked until something is typed in the row. */
  ignore: boolean
}

type SubmitType = 'save' | 'insert' | 'insertignore' | 'showinsert'
type AfterInsert = 'back' | 'new_insert' | 'same_insert'

/**
 * phpMyAdmin's insert/edit form (table/insert/*.twig): one table per row with Column, Type,
 * Function, Null and Value, the actions panel ("Insert as new row" and then "Go back to
 * previous page"), Preview SQL, Reset and Go, and "Continue insertion with N rows". It edits
 * the rows named by ?keys=[…] (copies them with &copy=1) and inserts blank rows otherwise, as
 * the Insert tab. Each column gets the control its type gets in phpMyAdmin: a date picker, an
 * enum's radios or select, a foreign key's dropdown, a protected binary with an upload.
 */
export default function Change() {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const kind: RelationKind = useLevel().kind ?? 'table'
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const keyList = useMemo<RowKeys[]>(() => {
    try {
      const parsed = JSON.parse(search.get('keys') ?? '[]') as unknown

      return Array.isArray(parsed) ? (parsed as RowKeys[]) : []
    } catch {
      return []
    }
  }, [search])
  const copy = search.get('copy') === '1'
  const editing = keyList.length > 0 && !copy

  const { data, error } = useRequest(async () => {
    if (keyList.length === 0) {
      const info = await relationColumns(db, schema, table)

      return { columns: info.columns, maxUpload: info.max_upload_bytes, rows: Array.from({ length: INSERT_ROWS }, (_, i) => emptyRow(info.columns, i > 0)) }
    }
    const loaded = await Promise.all(keyList.map((keys) => fetchRow(db, schema, table, keys)))

    return {
      columns: loaded[0].columns,
      maxUpload: loaded[0].max_upload_bytes,
      rows: loaded.map((r) => (copy ? copyOf(r.columns, r.row) : rowFrom(r.columns, r.row, keyOf(r.primary_keys, r.row)))),
    }
  }, [db, schema, table, search.get('keys'), copy])

  const [rows, setRows] = useState<FormRow[]>([])
  const [submitType, setSubmitType] = useState<SubmitType>(editing ? 'save' : 'insert')
  const [afterInsert, setAfterInsert] = useState<AfterInsert>('back')
  const [continueRows, setContinueRows] = useState(INSERT_ROWS)
  const [preview, setPreview] = useState<{ sql: string[] | null; error: string | null } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setRows(data.rows)
  }, [data])

  useEffect(() => {
    setSubmitType(editing ? 'save' : 'insert')
  }, [editing])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const columns = data.columns
  const browseUrl = `${urls.relation(db, schema, table, kind)}/browse`
  const insertUrl = `${urls.relation(db, schema, table, kind)}/insert`

  /** A change to a field: typing unchecks the row's Ignore box and re-runs the rules, as phpMyAdmin's verificationsAfterFieldChange does. */
  function setField(rowIndex: number, column: RelationColumn, patch: Partial<Field>) {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== rowIndex) return row
        const field = { ...row.fields[column.name], ...patch, touched: true }
        if (!('error' in patch)) {
          const problem = field.isNull || field.func !== '' ? null : validationError(column, field.value)
          field.error = problem ? t(`fields.${problem.key}`, problem.params) : null
        }

        return { ...row, ignore: false, fields: { ...row.fields, [column.name]: field } }
      }),
    )
  }

  /** The changes the form stands for: an UPDATE per edited row, an INSERT per new one; an ignored row is skipped. */
  function changes(asInsert: boolean): RowChanges {
    const result: RowChanges = {}
    for (const row of rows) {
      if (row.ignore) continue
      const values: Record<string, CellValue> = {}
      for (const column of columns) {
        if (column.is_generated) continue
        const field = row.fields[column.name]
        // A field left alone is not sent: a new row then takes the column's default, an
        // edited row keeps its value.
        if (!field.touched) continue
        values[column.name] = cellValue(field, column)
      }
      if (!asInsert && row.keys !== null) {
        if (Object.keys(values).length > 0) (result.updated ??= []).push({ keys: row.keys, values })
      } else {
        ;(result.added ??= []).push({ values })
      }
    }

    return result
  }

  function showPreview(which: RowChanges) {
    setPreview({ sql: null, error: null })
    previewRows(db, schema, table, which).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  function firstInvalid(): string | null {
    for (const [rowIndex, row] of rows.entries()) {
      if (row.ignore) continue
      for (const [columnIndex, column] of columns.entries()) {
        if (row.fields[column.name].error) return `field_${rowIndex}_${columnIndex}_3`
      }
    }

    return null
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    const invalid = firstInvalid()
    if (invalid) {
      document.getElementById(invalid)?.focus()

      return
    }
    const asInsert = submitType !== 'save'
    const which = { ...changes(asInsert), ignore: submitType === 'insertignore' }

    if (submitType === 'showinsert') {
      showPreview({ ...changes(true), ignore: false })

      return
    }
    if (!which.added?.length && !which.updated?.length) {
      notifySuccess(t('change.nothing_changed'))

      return
    }

    setSaving(true)
    try {
      const outcome = await saveRows(db, schema, table, which)
      const message = asInsert ? t('message.inserted', { count: outcome.added.length }) : t('message.affected', { count: outcome.updated.length })
      switch (afterInsert) {
        case 'new_insert':
          notifySuccess(message)
          navigate(insertUrl, { state: { flash: { message, sql: outcome.sql } } })
          break
        case 'same_insert':
          notifySuccess(message)
          if (asInsert) navigate(insertUrl)
          else setRows((current) => current.map((row) => ({ ...row, fields: Object.fromEntries(Object.entries(row.fields).map(([k, f]) => [k, { ...f, touched: false }])) })))
          break
        default:
          navigate((location.state as { from?: string } | null)?.from ?? browseUrl, { state: { flash: { message, sql: outcome.sql } } })
      }
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setRows(data!.rows)
  }

  return (
    <>
      <form id="insertForm" className="lock-page" name="insertForm" onSubmit={(e) => void submit(e)}>
        {rows.map((row, rowIndex) => (
          <div key={rowIndex}>
            {rowIndex > 0 && !editing && (
              <>
                <input
                  type="checkbox"
                  checked={row.ignore}
                  name={`insert_ignore_${rowIndex}`}
                  id={`insert_ignore_${rowIndex}`}
                  onChange={(e) => setRows((current) => current.map((r, i) => (i === rowIndex ? { ...r, ignore: e.target.checked } : r)))}
                />
                <label htmlFor={`insert_ignore_${rowIndex}`}>{t('fields.ignore')}</label>
                <br />
              </>
            )}
            <div className="table-responsive-lg">
              <table className="table table-striped align-middle my-3 insertRowTable w-auto">
                <thead>
                  <tr>
                    <th>{t('change.column')}</th>
                    <th>{t('change.type')}</th>
                    <th>{t('change.function')}</th>
                    <th>{t('change.null')}</th>
                    <th className="w-50">{t('change.value')}</th>
                  </tr>
                </thead>
                <tfoot>
                  <tr>
                    <th colSpan={5} className="tblFooters text-end">
                      <input className="btn btn-primary" type="submit" value={tApp('go')} />
                    </th>
                  </tr>
                </tfoot>
                <tbody>
                  {columns.map((column, columnIndex) => {
                    const field = row.fields[column.name]
                    const id = `field_${rowIndex}_${columnIndex}`
                    const isEnum = fieldKind(column) === 'enum'

                    return (
                      <tr key={column.name} className="noclick">
                        <td className="text-center">
                          {column.comment ? (
                            <span className="commented_column" title={column.comment}>
                              {column.name}
                            </span>
                          ) : (
                            column.name
                          )}
                        </td>
                        <td className={`text-center${isEnum ? '' : ' text-nowrap'}`}>
                          <span className="column_type" dir="ltr">
                            {column.type}
                          </span>
                        </td>
                        {isEnum ? (
                          <td className="text-center">--</td>
                        ) : (
                          <td>
                            {!column.is_generated && (
                              <select name={`funcs[${rowIndex}][${column.name}]`} id={`${id}_1`} value={field.func} onChange={(e) => setField(rowIndex, column, { func: e.target.value })} aria-label={t('change.function')}>
                                <option value="" />
                                {ROW_FUNCTIONS.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        )}
                        <td>
                          {column.nullable && !column.is_generated && (
                            <input
                              type="checkbox"
                              className="checkbox_null"
                              name={`fields_null[${rowIndex}][${column.name}]`}
                              id={`${id}_2`}
                              aria-label={t('change.use_null')}
                              checked={field.isNull}
                              onChange={(e) => setField(rowIndex, column, { isNull: e.target.checked, value: e.target.checked ? '' : field.value })}
                            />
                          )}
                        </td>
                        <td data-type={column.type_name} data-decimals={fractionDigits(column)}>
                          {column.is_generated ? (
                            <span className="text-muted">{field.value}</span>
                          ) : (
                            <ValueControl db={db} column={column} field={field} id={`${id}_3`} name={`fields[${rowIndex}][${column.name}]`} maxUpload={data.maxUpload} onChange={(patch) => setField(rowIndex, column, patch)} />
                          )}
                          {field.error && (
                            <label className="error" htmlFor={`${id}_3`}>
                              {field.error}
                            </label>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="card">
          <fieldset className="card-body" id="actions_panel">
            <table className="table table-borderless w-auto tdblock">
              <tbody>
                <tr>
                  <td className="text-nowrap align-middle">
                    <select name="submit_type" className="control_at_footer" value={submitType} onChange={(e) => setSubmitType(e.target.value as SubmitType)} aria-label={t('change.submit_type')}>
                      {editing && <option value="save">{t('change.save')}</option>}
                      <option value="insert">{t('change.insert')}</option>
                      <option value="insertignore">{t('change.insert_ignore')}</option>
                      <option value="showinsert">{t('change.show_insert')}</option>
                    </select>
                  </td>
                  <td className="align-middle">
                    <strong>{t('change.and_then')}</strong>
                  </td>
                  <td className="text-nowrap align-middle">
                    <select name="after_insert" className="control_at_footer" value={afterInsert} onChange={(e) => setAfterInsert(e.target.value as AfterInsert)} aria-label={t('change.and_then')}>
                      <option value="back">{t('change.back')}</option>
                      <option value="new_insert">{t('change.new_insert')}</option>
                      {editing && <option value="same_insert">{t('change.same_insert')}</option>}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td>
                    <Icon name="b_help" title={t('change.hint')} />
                  </td>
                  <td colSpan={3} className="text-end align-middle pb-2">
                    <input type="button" className="btn btn-secondary preview_sql control_at_footer" value={tApp('preview_sql')} onClick={() => showPreview({ ...changes(submitType !== 'save'), ignore: submitType === 'insertignore' })} />
                    <input type="reset" className="btn btn-secondary control_at_footer" value={t('change.reset')} onClick={reset} />
                    <input type="submit" className="btn btn-primary control_at_footer" value={tApp('go')} id="buttonYes" disabled={saving} />
                  </td>
                </tr>
              </tbody>
            </table>
          </fieldset>
        </div>
      </form>

      <form
        id="continueForm"
        name="continueForm"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(`${insertUrl}?rows=${continueRows}`)
          setRows((current) => [...current, ...Array.from({ length: Math.max(0, continueRows - current.length) }, () => emptyRow(columns, true))].slice(0, Math.max(continueRows, 1)))
        }}
      >
        {t('change.continue_before')}{' '}
        <input type="number" name="insert_rows" id="insert_rows" value={continueRows} min={1} onChange={(e) => setContinueRows(Math.max(1, Number(e.target.value) || 1))} />{' '}
        {t('change.continue_after')}
      </form>

      <PreviewSql show={preview !== null} sql={preview?.sql ? preview.sql.map((s) => `${s};`).join('\n') : null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}

interface ValueControlProps {
  db: string
  column: RelationColumn
  field: Field
  id: string
  name: string
  maxUpload: number | undefined
  onChange: (patch: Partial<Field>) => void
}

/**
 * The Value cell's control, as phpMyAdmin's column_row.twig picks it: a foreign key's dropdown,
 * a text or JSON column's textarea, an enum's radios (or a select once its definition is long),
 * a binary's "do not edit" notice with an upload, a date or time field with its picker, and a
 * sized text input for everything else.
 */
function ValueControl({ db, column, field, id, name, maxUpload, onChange }: ValueControlProps) {
  const { t } = useTranslation('sql')
  const kind = fieldKind(column)
  const setValue = (value: string) => onChange({ value, isNull: false })

  if (column.foreign_key) {
    return <ForeignSelect db={db} foreignKey={column.foreign_key} id={id} name={name} className="textfield" label={column.name} value={field.value} onChange={setValue} />
  }

  if (kind === 'enum') {
    const values = column.enum_values ?? []
    if (enumAsSelect(values)) {
      return (
        <select name={name} className="textfield" id={id} value={field.value} onChange={(e) => setValue(e.target.value)} aria-label={column.name}>
          <option value="" />
          {values.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      )
    }

    return (
      <>
        {values.map((value, i) => (
          <span key={value}>
            <input type="radio" name={name} value={value} className="textfield" id={`${id}_${i}`} checked={field.value === value} onChange={() => setValue(value)} />
            <label htmlFor={`${id}_${i}`}>{value}</label>
          </span>
        ))}
      </>
    )
  }

  if (kind === 'binary') {
    return (
      <>
        {t('fields.binary_do_not_edit')} ({formatBytes(field.isNull ? 0 : byteaLength(field.value))})
        <br />
        <input
          type="file"
          name={`fields_upload${name.slice('fields'.length)}`}
          className="textfield noDragDrop"
          id={id}
          size={10}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            if (maxUpload !== undefined && file.size > maxUpload) {
              onChange({ error: t('fields.max_upload', { size: formatBytes(maxUpload) }) })

              return
            }
            void fileAsBytea(file).then((hex) => onChange({ value: hex, isNull: false }))
          }}
        />{' '}
        {maxUpload !== undefined && t('fields.max_upload', { size: formatBytes(maxUpload) })}
      </>
    )
  }

  const dataType = inputDataType(column)

  if (kind === 'text' || kind === 'json' || charInTextarea(column) || field.value.includes('\n')) {
    const isChar = kind === 'char'
    const length = charLength(column)

    return (
      <textarea
        name={name}
        id={id}
        className={isChar ? 'charField' : undefined}
        data-type={dataType}
        data-maxlength={length ?? undefined}
        dir="ltr"
        rows={isChar ? CHAR_TEXTAREA_ROWS : TEXTAREA_ROWS}
        cols={isChar ? CHAR_TEXTAREA_COLS : TEXTAREA_COLS}
        value={field.value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={column.name}
      />
    )
  }

  if (kind === 'date' || kind === 'time' || kind === 'datetime') {
    return (
      <DateTimeInput
        kind={kind as DateKind}
        decimals={fractionDigits(column)}
        withTimeZone={hasTimeZone(column)}
        name={name}
        id={id}
        size={fieldSize(column)}
        data-type={dataType}
        value={field.value}
        onValueChange={setValue}
        aria-label={column.name}
      />
    )
  }

  const range = kind === 'int' ? integerRange(column.type_name) : null
  const length = charLength(column)

  return (
    <input
      type="text"
      name={name}
      id={id}
      className="textfield"
      data-type={dataType}
      data-maxlength={length ?? undefined}
      size={fieldSize(column)}
      min={range?.[0]}
      max={range?.[1]}
      inputMode={kind === 'int' ? 'numeric' : kind === 'float' ? 'decimal' : undefined}
      value={field.value}
      onChange={(e) => setValue(e.target.value)}
      aria-label={column.name}
    />
  )
}

/** The name of the first timestamp column: phpMyAdmin preselects NOW() for it when it has to be filled. */
function firstTimestamp(columns: RelationColumn[]): string | null {
  return columns.find((c) => fieldKind(c) === 'datetime')?.name ?? null
}

/**
 * phpMyAdmin's default function for a column (Generator::getDefaultFunctionForField): NOW for
 * the first timestamp when it is NOT NULL, has no default and no value; the UUID generator for
 * a uuid primary key without a default when inserting.
 */
function defaultFunction(column: RelationColumn, first: string | null, value: string, inserting: boolean): string {
  if (fieldKind(column) === 'datetime' && column.name === first && !column.nullable && !column.has_default && value === '') return 'NOW'
  if (inserting && fieldKind(column) === 'uuid' && column.pk && !column.has_default) return 'GEN_RANDOM_UUID'

  return ''
}

function newField(value: string, isNull: boolean, func: string, touched: boolean): Field {
  return { value, isNull, func, touched: touched || func !== '', error: null }
}

/**
 * A blank row of the insert form: each column starts at its default, NULL checked where that is
 * the default; every row after the first is ignored until something is typed in it.
 */
function emptyRow(columns: RelationColumn[], ignored = false): FormRow {
  const first = firstTimestamp(columns)

  return {
    keys: null,
    ignore: ignored,
    fields: Object.fromEntries(
      columns.map((c) => {
        const value = defaultText(c) ?? ''

        return [c.name, newField(value, c.nullable && !c.is_generated && value === '' && c.default === null, defaultFunction(c, first, value, true), false)]
      }),
    ),
  }
}

/** A row as the edit form shows it, fractional seconds padded to the column's precision. */
function rowFrom(columns: RelationColumn[], row: Record<string, string | null>, keys: RowKeys | null): FormRow {
  const first = firstTimestamp(columns)

  return {
    keys,
    ignore: false,
    fields: Object.fromEntries(
      columns.map((c) => {
        const value = row[c.name] === null ? '' : padFraction(row[c.name] ?? '', fractionDigits(c))

        return [c.name, newField(value, row[c.name] === null, defaultFunction(c, first, value, false), false)]
      }),
    ),
  }
}

/**
 * A copy of a row: every value counts as entered so the new row repeats it, except what the
 * server numbers (a serial key, any identity column, as pgAdmin pastes a row without its
 * serial and identity values) and a generated column, which are left to the server.
 */
function copyOf(columns: RelationColumn[], row: Record<string, string | null>): FormRow {
  return {
    keys: null,
    ignore: false,
    fields: Object.fromEntries(
      columns.map((c) => {
        const generatedKey = (c.pk && c.has_default) || c.is_identity
        const value = generatedKey || row[c.name] === null ? '' : padFraction(row[c.name] ?? '', fractionDigits(c))

        return [c.name, newField(value, !generatedKey && row[c.name] === null, '', !generatedKey && !c.is_generated)]
      }),
    ),
  }
}

function keyOf(primaryKeys: string[], row: Record<string, string | null>): RowKeys {
  return Object.fromEntries(primaryKeys.map((name) => [name, row[name] ?? null]))
}

/**
 * What a field sends: its function around the value, NULL, the column's default when the text
 * still reads as the default phpMyAdmin filled in, or the text.
 */
function cellValue(field: Field, column: RelationColumn): CellValue {
  if (field.func !== '') return { func: field.func, value: field.isNull ? null : field.value }
  if (field.isNull) return null
  const shownDefault = defaultText(column)
  if (shownDefault !== null && field.value === shownDefault) return { default: true }

  return field.value
}

/** Bytes as phpMyAdmin's formatByteDown prints an upload limit: "64KiB", "8MiB". */
function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${Number.isInteger(value) ? value : value.toFixed(1)}${unit === 0 ? ' ' : ''}${units[unit]}`
}
