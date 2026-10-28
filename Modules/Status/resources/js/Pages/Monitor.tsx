import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { listDatabases } from '@databases/js/api'
import { chartSample, REFRESH_RATES, type ChartName, type ChartSample } from '../api'
import LineChart, { type ChartPoint } from '../LineChart'
import StatusNav, { rateLabel } from '../StatusNav'

/** pgAdmin's dashboard charts: the series each one plots, and whether they are counters shown per second. */
const CHARTS: { name: ChartName; series: string[]; rate: boolean }[] = [
  { name: 'session_stats', series: ['Total', 'Active', 'Idle'], rate: false },
  { name: 'tps_stats', series: ['Transactions', 'Commits', 'Rollbacks'], rate: true },
  { name: 'ti_stats', series: ['Inserts', 'Updates', 'Deletes'], rate: true },
  { name: 'to_stats', series: ['Fetched', 'Returned'], rate: true },
  { name: 'bio_stats', series: ['Reads', 'Hits'], rate: true },
]

/** Samples kept: a sixty-sample window, so the plot reads 5 minutes at the default rate. */
const WINDOW = 61

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const formatValue = (value: number) => (Math.abs(value) >= 10000 ? compact.format(value) : number.format(value))

/**
 * phpMyAdmin's Status » Monitor with pgAdmin's dashboard charts: sessions, transactions per
 * second, tuples in and out and block I/O, sampled from pg_stat_activity and pg_stat_database
 * at the refresh rate and plotted in a grid. "Pause monitor" stops sampling; "Settings" holds
 * the refresh rate, the number of chart columns and the database the charts are limited to.
 */
export default function Monitor() {
  const { t } = useTranslation('status')
  const { data: databases } = useRequest(() => listDatabases(), [])
  const [running, setRunning] = useState(true)
  const [settings, setSettings] = useState(false)
  const [rate, setRate] = useState(5)
  const [columns, setColumns] = useState(3)
  const [database, setDatabase] = useState('')
  const [samples, setSamples] = useState<ChartSample[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setSamples([]), [database])

  useEffect(() => {
    if (!running) return
    let cancelled = false
    const sample = () =>
      chartSample(CHARTS.map((chart) => chart.name), database || undefined).then(
        (next) => {
          if (cancelled) return
          setError(null)
          setSamples((current) => [...current, next].slice(-WINDOW))
        },
        (e: unknown) => !cancelled && setError(errorMessage(e)),
      )
    void sample()
    const timer = window.setInterval(sample, rate * 1000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [running, rate, database])

  const points = useMemo(() => Object.fromEntries(CHARTS.map((chart) => [chart.name, toPoints(chart, samples)])), [samples])
  const rows = Array.from({ length: Math.ceil(CHARTS.length / columns) }, (_, i) => CHARTS.slice(i * columns, (i + 1) * columns))

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="tabLinks row">
        <a href="#pauseCharts" onClick={(e) => { e.preventDefault(); setRunning((r) => !r) }}>
          <Icon name={running ? 'pause' : 'play'} />
          {running ? t('monitor.pause') : t('monitor.resume')}
        </a>
        <a href="#settingsPopup" className="popupLink" onClick={(e) => { e.preventDefault(); setSettings((s) => !s) }}>
          <Icon name="s_cog" />
          {t('monitor.settings')}
        </a>
      </div>

      <div className="clearfloat" />

      {settings && (
        <div className="popupContent settingsPopup">
          <div className="float-start">
            <label htmlFor="id_gridChartRefresh">{t('rate.label')}</label>
            <br />
            <select id="id_gridChartRefresh" className="refreshRate" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {REFRESH_RATES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {rateLabel(t, seconds)}
                </option>
              ))}
            </select>
          </div>
          <div className="float-start">
            <label htmlFor="chartColumns">{t('monitor.columns')}</label>
            <br />
            <select id="chartColumns" value={columns} onChange={(e) => setColumns(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="float-start">
            <label htmlFor="monitorDatabase">{t('monitor.database')}</label>
            <br />
            <select id="monitorDatabase" value={database} onChange={(e) => setDatabase(e.target.value)}>
              <option value="">{t('monitor.all_databases')}</option>
              {(databases ?? []).filter((d) => d.datallowconn).map((d) => (
                <option key={d.did} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="clearfloat" />
        </div>
      )}

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <table className="clearfloat tdblock" id="chartGrid">
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((chart) => (
                <td key={chart.name}>
                  <LineChart title={t(`monitor.charts.${chart.name}`)} series={chart.series.map((key) => t(`monitor.series.${key}`))} points={points[chart.name]} format={formatValue} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The chart's points: the values as sampled, or for counters the change per second between samples. */
function toPoints(chart: (typeof CHARTS)[number], samples: ChartSample[]): ChartPoint[] {
  const values = (sample: ChartSample) => chart.series.map((key) => sample.charts[chart.name]?.[key] ?? 0)
  if (!chart.rate) return samples.map((sample) => ({ time: sample.time, values: values(sample) }))

  return samples.slice(1).map((sample, i) => {
    const before = samples[i]
    const seconds = Math.max(sample.time - before.time, 0.001)
    const was = values(before)

    // A counter that went down was reset; the rate starts again from zero.
    return { time: sample.time, values: values(sample).map((value, s) => Math.max(0, (value - was[s]) / seconds)) }
  })
}
