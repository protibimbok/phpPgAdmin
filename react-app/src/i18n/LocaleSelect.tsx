import { useState, type SelectHTMLAttributes } from 'react'
import { displayName } from './config'
import { useLocale } from './useLocale'

type LocaleSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>

/**
 * The language picker, as phpMyAdmin lays it out: a select of "native - English" names that
 * applies on change. The control itself is pinned to English and left-to-right so the list
 * reads the same whichever language is active.
 */
export default function LocaleSelect({ className, disabled, ...props }: LocaleSelectProps) {
  const { locale, locales, setLocale } = useLocale()
  const [pending, setPending] = useState(false)

  return (
    <select
      {...props}
      className={['form-select', className].filter(Boolean).join(' ')}
      lang="en"
      dir="ltr"
      value={locale.code}
      disabled={disabled || pending}
      onChange={(event) => {
        setPending(true)
        void setLocale(event.target.value).finally(() => setPending(false))
      }}
    >
      {locales.map((option) => (
        <option key={option.code} value={option.code}>
          {displayName(option)}
        </option>
      ))}
    </select>
  )
}
