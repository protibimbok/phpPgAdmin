import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { DateKind } from './kinds'

export interface DateTimePickerProps {
  kind: DateKind
  /** Digits of fractional seconds: none, up to three (a millisecond slider), more (a microsecond slider too). */
  decimals: number
  /** The value carries an offset, which the Time Zone select then sets. */
  withTimeZone?: boolean
  value: string
  onChange: (value: string) => void
  onClose: () => void
  /** The field the popup hangs under; left out, the picker is drawn in the flow (the grid's cell editor). */
  anchor?: HTMLElement | null
  /** phpMyAdmin's note under a date or time picker about values the picker cannot pick. */
  note?: string
}

interface DateParts {
  year: number
  month: number
  day: number
}

interface TimeParts {
  hour: number
  minute: number
  second: number
  millisecond: number
  microsecond: number
}

/** phpMyAdmin's FirstDayOfCalendar: Sunday. */
const FIRST_DAY = 0

/** The offsets the timepicker addon lists, in minutes. */
const TIMEZONES = [-720, -660, -600, -570, -540, -480, -420, -360, -300, -270, -240, -210, -180, -120, -60, 0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570, 600, 630, 660, 690, 720, 765, 780, 840]

const UNITS = [
  { name: 'hour', label: 'hour', max: 23 },
  { name: 'minute', label: 'minute', max: 59 },
  { name: 'second', label: 'second', max: 59 },
  { name: 'millisecond', label: 'millisecond', max: 999, slider: 'millisec' },
  { name: 'microsecond', label: 'microsecond', max: 999, slider: 'microsec' },
] as const

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function formatTimezone(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)

  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
}

/** The offset as PostgreSQL writes it after a time, "+06", "+05:30". */
function sqlTimezone(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)

  return abs % 60 === 0 ? `${sign}${pad(abs / 60)}` : `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function parseDate(text: string): DateParts | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null

  return { year, month, day }
}

function parseTime(text: string): { time: TimeParts; timezone: number | null } | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:\s*([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(text)
  if (!match) return null
  const fraction = (match[4] ?? '').padEnd(6, '0')
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? 0)
  if (hour > 24 || minute > 59 || second > 59) return null
  const timezone = match[5] ? (match[5] === '-' ? -1 : 1) * (Number(match[6]) * 60 + Number(match[7] ?? 0)) : null

  return {
    time: { hour: Math.min(hour, 23), minute, second, millisecond: Number(fraction.slice(0, 3)), microsecond: Number(fraction.slice(3, 6)) },
    timezone,
  }
}

function parseValue(kind: DateKind, value: string): { date: DateParts | null; time: TimeParts | null; timezone: number | null } {
  const text = value.trim()
  if (kind === 'date') return { date: parseDate(text), time: null, timezone: null }
  if (kind === 'time') {
    const parsed = parseTime(text)

    return { date: null, time: parsed?.time ?? null, timezone: parsed?.timezone ?? null }
  }
  const at = text.search(/[ T]/)
  if (at === -1) return { date: parseDate(text), time: null, timezone: null }
  const parsed = parseTime(text.slice(at + 1).trim())

  return { date: parseDate(text.slice(0, at)), time: parsed?.time ?? null, timezone: parsed?.timezone ?? null }
}

function now(): { date: DateParts; time: TimeParts } {
  const d = new Date()

  return {
    date: { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() },
    time: { hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(), millisecond: 0, microsecond: 0 },
  }
}

function formatDate(date: DateParts): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

/** The time as the picker's format writes it: HH:mm:ss, then .l (milliseconds) or .lc (microseconds too). */
function formatTime(time: TimeParts, decimals: number): string {
  let text = `${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`
  if (decimals > 3) text += `.${pad(time.millisecond, 3)}${pad(time.microsecond, 3)}`
  else if (decimals > 0) text += `.${pad(time.millisecond, 3)}`

  return text
}

/**
 * phpMyAdmin's date and time picker: jQuery UI's datepicker with the timepicker addon, as its
 * addDatepicker() sets them up. A date gets the calendar with a year select and closes on a
 * pick; a time gets the "Choose Time" sliders; a timestamp gets both, every change written to
 * the field at once. Seconds always show, and the fraction sliders follow the column's
 * precision. There is no button pane (showButtonPanel is off) and no animation.
 */
export default function DateTimePicker({ kind, decimals, withTimeZone = false, value, onChange, onClose, anchor, note }: DateTimePickerProps) {
  const { t } = useTranslation('sql')
  const root = useRef<HTMLDivElement>(null)
  const current = useMemo(now, [])
  const parsed = useMemo(() => parseValue(kind, value), [kind, value])
  const [selected, setSelected] = useState<DateParts | null>(parsed.date)
  const [view, setView] = useState<{ year: number; month: number }>({ year: (parsed.date ?? current.date).year, month: (parsed.date ?? current.date).month })
  const [time, setTime] = useState<TimeParts>(parsed.time ?? current.time)
  const [timezone, setTimezone] = useState<number>(parsed.timezone ?? -new Date().getTimezoneOffset())
  const [timeText, setTimeText] = useState(() => formatTime(parsed.time ?? current.time, decimals))
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'

  const months = t('calendar.months', { returnObjects: true }) as string[]
  const dayNames = t('calendar.days', { returnObjects: true }) as string[]
  const dayNamesMin = t('calendar.days_min', { returnObjects: true }) as string[]

  // What the user types in the field moves the picker, as jQuery UI re-reads the field on keyup.
  useEffect(() => {
    if (parsed.date) {
      setSelected(parsed.date)
      setView({ year: parsed.date.year, month: parsed.date.month })
    }
    if (parsed.time) {
      setTime(parsed.time)
      setTimeText(formatTime(parsed.time, decimals))
    }
    if (parsed.timezone !== null) setTimezone(parsed.timezone)
  }, [parsed, decimals])

  // Under the field, flipped above it when the page ends too soon (jQuery UI's _checkOffset).
  useLayoutEffect(() => {
    if (!anchor || !root.current) return
    const place = () => {
      if (!anchor || !root.current) return
      const input = anchor.getBoundingClientRect()
      const box = root.current.getBoundingClientRect()
      const viewportHeight = document.documentElement.clientHeight
      let top = input.bottom + window.scrollY
      if (input.bottom + box.height > viewportHeight && input.top - box.height > 0) top = input.top + window.scrollY - box.height
      let left = input.left + window.scrollX
      if (rtl) left = input.right + window.scrollX - box.width
      left = Math.max(window.scrollX, Math.min(left, window.scrollX + document.documentElement.clientWidth - box.width))
      setPosition({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)

    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, rtl, kind, decimals])

  // Escape and a click anywhere else close the popup (jQuery UI's _doKeyDown and _checkExternalClick).
  useEffect(() => {
    if (!anchor) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null
      if (!target || root.current?.contains(target) || target === anchor || target.classList.contains('ui-datepicker-trigger')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [anchor, onClose])

  function emit(date: DateParts | null, nextTime: TimeParts, nextZone: number) {
    const zone = withTimeZone ? sqlTimezone(nextZone) : ''
    if (kind === 'date') {
      if (date) onChange(formatDate(date))
    } else if (kind === 'time') {
      onChange(formatTime(nextTime, decimals) + zone)
    } else {
      // The addon fills in today when no day was picked yet, so a time alone still makes a value.
      onChange(`${formatDate(date ?? current.date)} ${formatTime(nextTime, decimals)}${zone}`)
    }
  }

  function selectDay(day: DateParts) {
    setSelected(day)
    setView({ year: day.year, month: day.month })
    emit(day, time, timezone)
    if (kind === 'date') onClose()
  }

  function changeTime(patch: Partial<TimeParts>) {
    const next = { ...time, ...patch }
    setTime(next)
    setTimeText(formatTime(next, decimals))
    if (kind === 'datetime' && !selected) setSelected(current.date)
    emit(selected, next, timezone)
  }

  function commitTimeText(text: string) {
    const parsedTime = parseTime(text.trim())
    if (!parsedTime) return
    setTime(parsedTime.time)
    if (kind === 'datetime' && !selected) setSelected(current.date)
    emit(selected, parsedTime.time, timezone)
  }

  function changeTimezone(minutes: number) {
    setTimezone(minutes)
    emit(selected, time, minutes)
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const month = v.month + delta

      return month < 1 ? { year: v.year - 1, month: 12 } : month > 12 ? { year: v.year + 1, month: 1 } : { ...v, month }
    })
  }

  // The calendar: as many rows as the month needs, days of other months blank (showOtherMonths is off).
  const weeks = useMemo(() => {
    const first = new Date(view.year, view.month - 1, 1)
    const lead = (first.getDay() - FIRST_DAY + 7) % 7
    const days = new Date(view.year, view.month, 0).getDate()
    const rows = Math.ceil((lead + days) / 7)
    const cells: (number | null)[][] = []
    let day = 1 - lead
    for (let r = 0; r < rows; r++) {
      const row: (number | null)[] = []
      for (let c = 0; c < 7; c++, day++) row.push(day >= 1 && day <= days ? day : null)
      cells.push(row)
    }

    return cells
  }, [view])

  const years = useMemo(() => Array.from({ length: 21 }, (_, i) => view.year - 10 + i), [view.year])
  const zones = useMemo(() => (TIMEZONES.includes(timezone) ? TIMEZONES : [...TIMEZONES, timezone].sort((a, b) => a - b)), [timezone])
  const showMillisec = decimals > 0
  const showMicrosec = decimals > 3

  const picker = (
    <div
      id="ui-datepicker-div"
      ref={root}
      className={`ui-datepicker ui-widget ui-widget-content ui-helper-clearfix ui-corner-all${rtl ? ' ui-datepicker-rtl' : ''}`}
      style={anchor ? { position: 'absolute', top: position?.top ?? -9999, left: position?.left ?? -9999, zIndex: 9999, display: 'block' } : { position: 'relative', top: 0, left: 0, zIndex: 10, display: 'block' }}
      onMouseDown={(e) => {
        // Clicking the picker's chrome must not take the focus (and so the editor) away from the field.
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) e.preventDefault()
      }}
    >
      {kind !== 'time' && (
        <>
          <div className="ui-datepicker-header ui-widget-header ui-helper-clearfix ui-corner-all">
            <HeaderArrow direction="prev" title={t('calendar.prev')} onClick={() => shiftMonth(-1)} />
            <HeaderArrow direction="next" title={t('calendar.next')} onClick={() => shiftMonth(1)} />
            <div className="ui-datepicker-title">
              <span className="ui-datepicker-month">{months[view.month - 1]}</span>&nbsp;
              <select className="ui-datepicker-year" aria-label={t('calendar.select_year')} value={view.year} onChange={(e) => setView((v) => ({ ...v, year: Number(e.target.value) }))}>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <table className="ui-datepicker-calendar">
            <thead>
              <tr>
                {Array.from({ length: 7 }, (_, i) => (i + FIRST_DAY) % 7).map((weekday) => (
                  <th key={weekday} scope="col" className={weekday === 0 || weekday === 6 ? 'ui-datepicker-week-end' : undefined}>
                    <span title={dayNames[weekday]}>{dayNamesMin[weekday]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, r) => (
                <tr key={r}>
                  {week.map((day, c) => {
                    const weekday = (c + FIRST_DAY) % 7
                    const weekend = weekday === 0 || weekday === 6 ? ' ui-datepicker-week-end' : ''
                    if (day === null) {
                      return <td key={c} className={`${weekend} ui-datepicker-other-month ui-datepicker-unselectable ui-state-disabled`}>&nbsp;</td>
                    }
                    const isToday = current.date.year === view.year && current.date.month === view.month && current.date.day === day
                    const isSelected = selected !== null && selected.year === view.year && selected.month === view.month && selected.day === day

                    return (
                      <td key={c} className={`${weekend}${isSelected ? ' ui-datepicker-current-day' : ''}${isToday ? ' ui-datepicker-today' : ''}`} data-handler="selectDay" data-event="click" data-month={view.month - 1} data-year={view.year}>
                        <a
                          className={`ui-state-default${isToday ? ' ui-state-highlight' : ''}${isSelected ? ' ui-state-active' : ''}`}
                          href="#"
                          aria-current={isSelected ? 'date' : undefined}
                          data-date={day}
                          onClick={(e) => {
                            e.preventDefault()
                            selectDay({ year: view.year, month: view.month, day })
                          }}
                        >
                          {day}
                        </a>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {kind !== 'date' && (
        <div className={`ui-timepicker-div${rtl ? ' ui-timepicker-rtl' : ''}`}>
          {kind === 'time' && (
            <div className="ui-widget-header ui-helper-clearfix ui-corner-all">
              <div className="ui-datepicker-title">{t('calendar.choose_time')}</div>
            </div>
          )}
          <dl>
            <dt className="ui_tpicker_time_label">{t('calendar.time')}</dt>
            <dd className="ui_tpicker_time">
              <input
                className="ui_tpicker_time_input"
                value={timeText}
                aria-label={t('calendar.time')}
                onChange={(e) => setTimeText(e.target.value)}
                onBlur={(e) => commitTimeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitTimeText(e.currentTarget.value)
                  }
                }}
              />
            </dd>
            {UNITS.map((unit) => {
              const hidden = (unit.name === 'millisecond' && !showMillisec) || (unit.name === 'microsecond' && !showMicrosec)
              const slider = 'slider' in unit ? unit.slider : unit.name
              const hide = hidden ? ' ui_tpicker_unit_hide' : ''

              return [
                <dt key={`${unit.name}-label`} className={`ui_tpicker_${slider}_label${hide}`}>
                  {t(`calendar.${unit.label}`)}
                </dt>,
                <dd key={unit.name} className={`ui_tpicker_${slider}${hide}`}>
                  <Slider className={`ui_tpicker_${slider}_slider${hide}`} max={unit.max} value={time[unit.name]} label={t(`calendar.${unit.label}`)} onChange={(v) => changeTime({ [unit.name]: v })} />
                </dd>,
              ]
            })}
            <dt className="ui_tpicker_timezone_label">{t('calendar.time_zone')}</dt>
            <dd className="ui_tpicker_timezone">
              <select value={timezone} aria-label={t('calendar.time_zone')} onChange={(e) => changeTimezone(Number(e.target.value))}>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {formatTimezone(zone)}
                  </option>
                ))}
              </select>
            </dd>
          </dl>
        </div>
      )}
      {note && <p className="note">{note}</p>}
    </div>
  )

  return anchor ? createPortal(picker, document.body) : picker
}

function HeaderArrow({ direction, title, onClick }: { direction: 'prev' | 'next'; title: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  const arrow = direction === 'prev' ? 'w' : 'e'

  return (
    <a
      className={`ui-datepicker-${direction} ui-corner-all${hover ? ` ui-state-hover ui-datepicker-${direction}-hover` : ''}`}
      data-handler={direction}
      data-event="click"
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.preventDefault()
        onClick()
      }}
    >
      <span className={`ui-icon ui-icon-circle-triangle-${arrow}`}>{title}</span>
    </a>
  )
}

interface SliderProps {
  className: string
  max: number
  value: number
  label: string
  onChange: (value: number) => void
}

/** jQuery UI's horizontal slider as the timepicker addon draws one per unit: a track and one handle. */
function Slider({ className, max, value, label, onChange }: SliderProps) {
  const track = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)

  function fromPointer(e: PointerEvent) {
    if (!track.current) return
    const rect = track.current.getBoundingClientRect()
    const fraction = (e.clientX - rect.left) / rect.width
    onChange(Math.round(Math.min(1, Math.max(0, fraction)) * max))
  }

  function onKeyDown(e: KeyboardEvent<HTMLSpanElement>) {
    const step = e.key === 'PageUp' || e.key === 'PageDown' ? Math.max(1, Math.round(max / 10)) : 1
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') next = value + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') next = value - step
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = max
    if (next === null) return
    e.preventDefault()
    onChange(Math.min(max, Math.max(0, next)))
  }

  return (
    <div
      ref={track}
      className={`${className} ui-slider ui-corner-all ui-slider-horizontal ui-widget ui-widget-content`}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        setDragging(true)
        fromPointer(e)
      }}
      onPointerMove={(e) => dragging && fromPointer(e)}
      onPointerUp={(e) => {
        setDragging(false)
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => setDragging(false)}
    >
      <span
        tabIndex={0}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className={`ui-slider-handle ui-corner-all ui-state-default${hover ? ' ui-state-hover' : ''}${dragging ? ' ui-state-active' : ''}`}
        style={{ left: `${(value / max) * 100}%` }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
