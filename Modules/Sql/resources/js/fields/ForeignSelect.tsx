import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { notAvailable } from '@/unbuilt'
import { foreignValues, type ForeignKey, type ForeignValues } from '../api'

export interface ForeignSelectProps {
  db: string
  foreignKey: ForeignKey
  value: string
  onChange: (value: string) => void
  id?: string
  name?: string
  /** The class of the control: "textfield" on the insert form, none on the search page. */
  className?: string
  tabIndex?: number
  /** What the control is read out as: the column's name. */
  label?: string
}

/** phpMyAdmin's LimitChars: how much of a long description an option shows. */
const LIMIT_CHARS = 50

export function useForeignValues(db: string, key: ForeignKey | null | undefined): ForeignValues | undefined {
  const { data } = useRequest(() => (key ? foreignValues(db, key) : Promise.resolve(undefined)), [db, key?.schema, key?.table, key?.column])

  return data
}

/**
 * The control phpMyAdmin gives a foreign key column: a dropdown of the referenced column's
 * values while there are no more than ForeignKeyMaxLimit of them, each listed twice as
 * "description - key" and then "key - description" (ForeignKeyDropdownOrder), a text field
 * with the "Browse foreign values" link beyond that.
 */
export default function ForeignSelect({ db, foreignKey, value, onChange, id, name, className, tabIndex, label }: ForeignSelectProps) {
  const { t } = useTranslation('sql')
  const data = useForeignValues(db, foreignKey)

  if (data?.truncated) {
    return (
      <>
        <input type="text" id={id} name={name} className="textfield" tabIndex={tabIndex} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? name} />
        <a className="ajax browse_foreign" href="#browse-foreign" onClick={notAvailable}>
          <Icon name="b_browse" title={t('fields.browse_foreign')} />
        </a>
      </>
    )
  }

  return (
    <select id={id} name={name} className={className} tabIndex={tabIndex} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label ?? name}>
      {foreignOptions(data)}
    </select>
  )
}

/** The options as Relation::foreignDropdown lists them; the data may still be on its way. */
export function foreignOptions(data: ForeignValues | undefined) {
  const options = [
    <option key="empty-top" value="">
      {' '}
    </option>,
  ]
  if (!data) return options
  const shown = (text: string | null) => (text === null ? '' : text.length > LIMIT_CHARS ? `${text.slice(0, LIMIT_CHARS)}...` : text)
  const nbsp = ' '

  for (const [i, { key, display }] of data.values.entries()) {
    options.push(
      <option key={`top-${i}`} value={key ?? ''}>
        {data.display_column === null ? (key ?? '') : `${shown(display)}${nbsp}-${nbsp}${key ?? ''}`}
      </option>,
    )
  }
  if (data.display_column !== null) {
    options.push(
      <option key="empty-bottom" value="">
        {nbsp}
      </option>,
    )
    for (const [i, { key, display }] of data.values.entries()) {
      options.push(
        <option key={`bottom-${i}`} value={key ?? ''}>
          {`${key ?? ''}${nbsp}-${nbsp}${shown(display)}`}
        </option>,
      )
    }
  }

  return options
}
