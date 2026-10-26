/**
 * How a column's type decides the control it gets, after phpMyAdmin's type classes
 * (Types::getTypeClass) and the attributes its insert form and search page put on each input:
 * the size, the data-type, the integer range, the fractional seconds, and what counts as a
 * valid value before the form is sent.
 */

import type { ForeignKey } from '../api'

/** What a column's control looks like: phpMyAdmin's type class, split where its template differs. */
export type FieldKind = 'date' | 'time' | 'datetime' | 'int' | 'float' | 'bool' | 'char' | 'text' | 'json' | 'binary' | 'enum' | 'uuid' | 'other'

/** The part of a column description the field helpers read; both RelationColumn and ResultColumn have it. */
export interface FieldColumn {
  type_name: string
  /** The type with its modifiers; null for a result column that is not a table's own. */
  type?: string | null
  enum_values?: string[] | null
  foreign_key?: ForeignKey | null
}

const INT_TYPES = new Set(['int2', 'int4', 'int8', 'oid'])
const FLOAT_TYPES = new Set(['float4', 'float8', 'numeric', 'money'])
const CHAR_TYPES = new Set(['varchar', 'bpchar', 'char', 'name', 'citext'])
const TEXT_TYPES = new Set(['text', 'xml'])
const JSON_TYPES = new Set(['json', 'jsonb'])

export function fieldKind(column: FieldColumn): FieldKind {
  if (column.enum_values && column.enum_values.length > 0) return 'enum'
  const name = column.type_name
  if (name === 'date') return 'date'
  if (name === 'time' || name === 'timetz') return 'time'
  if (name === 'timestamp' || name === 'timestamptz') return 'datetime'
  if (INT_TYPES.has(name)) return 'int'
  if (FLOAT_TYPES.has(name)) return 'float'
  if (name === 'bool') return 'bool'
  if (CHAR_TYPES.has(name)) return 'char'
  if (TEXT_TYPES.has(name)) return 'text'
  if (JSON_TYPES.has(name)) return 'json'
  if (name === 'bytea') return 'binary'
  if (name === 'uuid') return 'uuid'

  return 'other'
}

export type DateKind = 'date' | 'time' | 'datetime'

/** The picker a column gets, or null for one that is not a date or time. */
export function dateKind(column: FieldColumn): DateKind | null {
  const kind = fieldKind(column)

  return kind === 'date' || kind === 'time' || kind === 'datetime' ? kind : null
}

/** phpMyAdmin's class on the input and the cell: datefield, timefield or datetimefield. */
export function dateFieldClass(column: FieldColumn): string {
  const kind = dateKind(column)

  return kind === null ? '' : `${kind}field`
}

/** Whether the type carries a time zone, so its text ends in an offset. */
export function hasTimeZone(column: FieldColumn): boolean {
  return column.type_name === 'timetz' || column.type_name === 'timestamptz'
}

/** The modifier in brackets, "(3)" of time(3), "(10,2)" of numeric(10,2); null without one. */
function modifier(column: FieldColumn): string | null {
  const match = /\(([^)]*)\)/.exec(column.type ?? '')

  return match ? match[1] : null
}

/**
 * The digits of fractional seconds a time or timestamp column keeps (phpMyAdmin's
 * data-decimals): the declared precision, PostgreSQL's six without one, none for a date.
 */
export function fractionDigits(column: FieldColumn): number {
  const kind = dateKind(column)
  if (kind === null || kind === 'date') return 0
  const declared = modifier(column)

  return declared === null ? 6 : Math.min(6, Math.max(0, Number(declared) || 0))
}

/** The declared length of a character column, null when it has none. */
export function charLength(column: FieldColumn): number | null {
  if (fieldKind(column) !== 'char') return null
  const declared = modifier(column)

  return declared === null ? null : Number(declared) || null
}

/** The range an integer type holds, as phpMyAdmin puts it on the input's min and max. */
export function integerRange(typeName: string): [string, string] | null {
  switch (typeName) {
    case 'int2':
      return ['-32768', '32767']
    case 'int4':
      return ['-2147483648', '2147483647']
    case 'int8':
      return ['-9223372036854775808', '9223372036854775807']
    case 'oid':
      return ['0', '4294967295']
    default:
      return null
  }
}

/** phpMyAdmin's MinSizeForInputField and MaxSizeForInputField. */
export const MIN_INPUT_SIZE = 4
export const MAX_INPUT_SIZE = 60

/** The width a type's values need, standing in for the column length MySQL reports to phpMyAdmin. */
const TYPE_SIZES: Record<string, number> = {
  int2: 6,
  int4: 11,
  int8: 20,
  oid: 10,
  float4: 12,
  float8: 22,
  money: 20,
  bool: 5,
  date: 10,
  time: 10,
  timetz: 13,
  timestamp: 19,
  timestamptz: 22,
  interval: 20,
  uuid: 36,
  inet: 43,
  cidr: 43,
  macaddr: 17,
}

/**
 * phpMyAdmin's input size (InsertEdit::getColumnSize): the declared length of a character
 * column, the type's width otherwise, fractional seconds added for a time, between 4 and 60.
 */
export function fieldSize(column: FieldColumn): number {
  let size: number
  const length = charLength(column)
  if (length !== null) {
    size = length
  } else if (column.type_name === 'numeric') {
    const [precision] = (modifier(column) ?? '').split(',')
    size = (Number(precision) || 10) + 2
  } else {
    size = TYPE_SIZES[column.type_name] ?? 30
    const digits = fractionDigits(column)
    if (digits > 0) size += digits + 1
  }

  return Math.min(Math.max(size, MIN_INPUT_SIZE), MAX_INPUT_SIZE)
}

/** Whether a character column is too long for an input, so phpMyAdmin edits it in a textarea instead. */
export function charInTextarea(column: FieldColumn): boolean {
  const length = charLength(column)

  return length !== null && length > MAX_INPUT_SIZE
}

/** The data-type phpMyAdmin puts on an input, which its scripts read to pick the validation. */
export function inputDataType(column: FieldColumn): string {
  switch (fieldKind(column)) {
    case 'int':
      return 'INT'
    case 'float':
      return 'NUMBER'
    case 'char':
    case 'text':
    case 'json':
    case 'uuid':
      return 'CHAR'
    case 'date':
    case 'time':
    case 'datetime':
      return 'DATE'
    case 'binary':
      return 'HEX'
    default:
      return ''
  }
}

/**
 * phpMyAdmin's rule for an enum: radio buttons while the type definition is short, a select
 * once "enum('a','b',…)" runs past 20 characters.
 */
export function enumAsSelect(values: string[]): boolean {
  return `enum(${values.map((v) => `'${v}'`).join(',')})`.length > 20
}

/** The expressions a date or time column may hold verbatim, as phpMyAdmin lets CURRENT_TIMESTAMP through. */
const DATE_EXPRESSIONS = /^(current_timestamp|current_date|current_time|localtimestamp|localtime|now|clock_timestamp|statement_timestamp|transaction_timestamp)(\(\))?$/i

/**
 * The text an insert form starts a column with, as phpMyAdmin fills in the column default: a
 * literal unwrapped from its cast ('ok'::mood → ok), any other expression as written (now(),
 * CURRENT_TIMESTAMP, gen_random_uuid()); nothing for a serial, an identity column or a
 * generated one, which the server numbers or computes when the column is left alone.
 */
export function defaultText(column: { default: string | null; is_identity?: boolean; is_generated?: boolean }): string | null {
  const expression = column.default
  if (expression === null || column.is_identity || column.is_generated) return null
  if (/^nextval\(/i.test(expression)) return null

  const literal = /^'((?:[^']|'')*)'(?:::[\w\s"\[\]().,]+)?$/.exec(expression)
  if (literal) return literal[1].replace(/''/g, "'")
  if (/^NULL(::.+)?$/i.test(expression)) return null

  return expression
}

/**
 * Fractional seconds padded to the column's digits, as phpMyAdmin pads a value with a decimal
 * point to the full microseconds before editing it ("13:14:15.5" → "13:14:15.500" for time(3)).
 */
export function padFraction(value: string, digits: number): string {
  if (digits === 0 || !value.includes('.')) return value

  return value.replace(/\.(\d*)/, (_, fraction: string) => `.${fraction.padEnd(digits, '0').slice(0, digits)}`)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** phpMyAdmin's isDate: a year-month-day with "-", "/" or "." between, the day within its month. */
export function isValidDate(value: string): boolean {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value.trim())
  if (!match) return false
  const [, year, month, day] = match.map(Number)

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/** phpMyAdmin's isTime, with PostgreSQL's range: hours to 24, optional seconds, up to six decimals, an optional offset. */
export function isValidTime(value: string, withTimeZone = false): boolean {
  const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,6}))?)?(\s*[+-]\d{1,2}(?::?\d{2})?|\s*Z)?$/i.exec(value.trim())
  if (!match) return false
  const [, hours, minutes, seconds] = match
  if (match[5] && !withTimeZone) return false

  return Number(hours) <= 24 && Number(minutes) <= 59 && (seconds === undefined || Number(seconds) <= 59)
}

/** Whether the text is a value the column's picker kind accepts, or one of the expressions phpMyAdmin lets through. */
export function isValidDateTime(kind: DateKind, value: string, withTimeZone = false): boolean {
  const text = value.trim()
  if (DATE_EXPRESSIONS.test(text) || /^(infinity|-infinity|epoch|today|tomorrow|yesterday|allballs)$/i.test(text)) return true
  if (kind === 'date') return isValidDate(text)
  if (kind === 'time') return isValidTime(text, withTimeZone)
  const at = text.search(/[ T]/)
  if (at === -1) return isValidDate(text)

  return isValidDate(text.slice(0, at)) && isValidTime(text.slice(at + 1), withTimeZone)
}

/** Why a value fails phpMyAdmin's client-side rules, as a message key under fields.*, or null when it passes. */
export function validationError(column: FieldColumn, value: string): { key: string; params?: Record<string, string | number> } | null {
  if (value === '') return null
  switch (fieldKind(column)) {
    case 'int': {
      if (!/^[+-]?\d+$/.test(value.trim())) return { key: 'valid_number' }
      const range = integerRange(column.type_name)
      if (range && compareIntegers(value.trim(), range[0]) < 0) return { key: 'valid_min', params: { value: range[0] } }
      if (range && compareIntegers(value.trim(), range[1]) > 0) return { key: 'valid_max', params: { value: range[1] } }

      return null
    }
    case 'float':
      return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value.trim()) ? null : { key: 'valid_number' }
    case 'char': {
      const length = charLength(column)

      return length !== null && [...value].length > length ? { key: 'valid_length', params: { count: length } } : null
    }
    case 'date':
    case 'time':
    case 'datetime':
      return isValidDateTime(fieldKind(column) as DateKind, value, hasTimeZone(column)) ? null : { key: 'valid_date_time' }
    default:
      return null
  }
}

/** Compare two integers written as text, which may exceed what a number holds. */
function compareIntegers(a: string, b: string): number {
  const big = (text: string) => BigInt(text.replace(/^\+/, ''))
  const x = big(a)
  const y = big(b)

  return x < y ? -1 : x > y ? 1 : 0
}

/** The length of a bytea value in its hex text form, "\x00ff" → 2. */
export function byteaLength(value: string): number {
  return value.startsWith('\\x') ? Math.ceil((value.length - 2) / 2) : value.length
}

/** A file's bytes as the hex text PostgreSQL reads into a bytea column. */
export async function fileAsBytea(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let hex = '\\x'
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')

  return hex
}
