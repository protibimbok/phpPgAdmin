import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import calendarIcon from '@/img/icons/b_calendar.png'
import DateTimePicker from './DateTimePicker'
import type { DateKind } from './kinds'

export interface DateTimeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  kind: DateKind
  decimals: number
  withTimeZone?: boolean
  value: string
  onValueChange: (value: string) => void
  inputRef?: Ref<HTMLInputElement>
  /** Draw the picker in the flow after the children instead of under the field, and open it at once: the grid's cell editor. */
  inline?: boolean
  /** Rendered between the field and an inline picker: the grid's NULL box. */
  children?: ReactNode
}

/**
 * A date, time or timestamp field as phpMyAdmin's form draws one: the text input with the
 * datefield / timefield / datetimefield class, the calendar button (showOn: 'button' with
 * b_calendar.png) that opens the picker, and, over a date or time field, the tooltip that says
 * the field takes more than the picker can pick.
 */
export default function DateTimeInput({ kind, decimals, withTimeZone, value, onValueChange, inputRef, inline = false, children, className, ...rest }: DateTimeInputProps) {
  const { t } = useTranslation('sql')
  const ownRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(inline)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (inline) setOpen(true)
  }, [inline])

  const note = kind === 'date' ? t('fields.tip_date') : kind === 'time' ? t('fields.tip_time') : undefined
  const classes = ['textfield', `${kind}field`, open ? 'hasDatepicker' : '', className ?? ''].filter(Boolean).join(' ')

  const setRef = (element: HTMLInputElement | null) => {
    ownRef.current = element
    if (typeof inputRef === 'function') inputRef(element)
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = element
  }

  return (
    <>
      <input
        {...rest}
        ref={setRef}
        type="text"
        className={classes}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onMouseEnter={note ? (e) => setTooltip({ x: e.pageX, y: e.pageY }) : undefined}
        onMouseMove={note ? (e) => setTooltip({ x: e.pageX, y: e.pageY }) : undefined}
        onMouseLeave={note ? () => setTooltip(null) : undefined}
      />
      <img className="ui-datepicker-trigger" src={calendarIcon} alt="..." title="..." onClick={() => setOpen(true)} />
      {children}
      {open && (
        <DateTimePicker
          kind={kind}
          decimals={decimals}
          withTimeZone={withTimeZone}
          value={value}
          onChange={onValueChange}
          onClose={close}
          anchor={inline ? null : ownRef.current}
          note={note}
        />
      )}
      {tooltip &&
        note &&
        createPortal(
          <div role="tooltip" className="ui-tooltip ui-corner-all ui-widget-shadow ui-widget ui-widget-content tooltip" style={{ top: tooltip.y + 15, left: tooltip.x + 15 }}>
            <div className="ui-tooltip-content">{note}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
