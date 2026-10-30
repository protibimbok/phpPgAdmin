import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { systemStats, type SystemSection, type SystemView } from '../api'
import LineChart, { type ChartPoint } from '../LineChart'
import StatTable from '../StatTable'
import StatusNav, { AutoRefresh } from '../StatusNav'

const SECTIONS: SystemSection[] = ['summary', 'cpu', 'memory', 'storage']

/** The samples a chart keeps, as the Monitor page keeps them. */
const KEPT = 60

/**
 * The charts of a tab: pgAdmin's CPU usage, load average, memory and swap graphs, each a series
 * of columns of one system_stats function (Linux's names; another platform's columns are not
 * charted, only listed).
 */
const CHARTS: Record<SystemSection, { key: string; view: string; columns: string[]; percent?: boolean; bytes?: boolean }[]> = {
  summary: [{ key: 'processes', view: 'pg_sys_os_info()', columns: ['process_count', 'handle_count'] }],
  cpu: [
    { key: 'cpu', view: 'pg_sys_cpu_usage_info()', columns: ['usermode_normal_process_percent', 'kernelmode_process_percent', 'io_completion_percent'], percent: true },
    { key: 'load', view: 'pg_sys_load_avg_info()', columns: ['load_avg_one_minute', 'load_avg_five_minutes', 'load_avg_fifteen_minutes'] },
  ],
  memory: [
    { key: 'memory', view: 'pg_sys_memory_info()', columns: ['total_memory', 'used_memory', 'free_memory'], bytes: true },
    { key: 'swap', view: 'pg_sys_memory_info()', columns: ['swap_total', 'swap_used', 'swap_free'], bytes: true },
  ],
  storage: [],
}

/** Short enough for the chart's axis: "14.9G". */
function bytes(value: number): string {
  const units = ['', 'K', 'M', 'G', 'T']
  let v = value
  let i = 0
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 || v >= 100 ? 0 : 1)}${units[i]}`
}

/**
 * pgAdmin's System Statistics dashboard as a Status page (server/status/system), from the
 * system_stats extension: the Summary, CPU, Memory and Storage tabs, each the rows of its
 * system_stats functions, with pgAdmin's graphs drawn from the samples taken while the page
 * refreshes (the Monitor page's charts). The Status pills offer it only where system_stats is
 * installed in the database the login landed in.
 */
export default function SystemStats() {
  const { t } = useTranslation('status')
  const [search, setSearch] = useSearchParams()
  const section = (SECTIONS as string[]).includes(search.get('tab') ?? '') ? (search.get('tab') as SystemSection) : 'summary'
  const [views, setViews] = useState<SystemView[] | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<Record<string, ChartPoint[]>>({})

  // The tab shown: an answer for another (asked before the tab changed) is dropped.
  const shown = useRef(section)
  shown.current = section

  const load = useCallback(() => {
    systemStats(section).then(
      (r) => {
        if (shown.current !== section) return
        setAvailable(r.available)
        setError(null)
        const next = r.views ?? []
        setViews(next)
        const time = Date.now() / 1000
        setSamples((current) => {
          const out = { ...current }
          for (const chart of CHARTS[section]) {
            const view = next.find((v) => v.view === chart.view)
            const indexes = chart.columns.map((c) => view?.columns.indexOf(c) ?? -1)
            if (!view || view.rows.length === 0 || indexes.some((i) => i < 0)) continue
            const values = indexes.map((i) => Number(view.rows[0][i] ?? 0))
            out[chart.key] = [...(out[chart.key] ?? []), { time, values }].slice(-KEPT)
          }
          return out
        })
      },
      (e: unknown) => {
        if (shown.current === section) setError(errorMessage(e))
      },
    )
  }, [section])

  useEffect(() => {
    setViews(null)
    load()
  }, [load])

  return (
    <div className="container-fluid">
      <StatusNav />
      <h2>
        <Icon name="s_status" /> {t('system.title')}
      </h2>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}
      {available === false && (
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {t('system.unavailable')}
        </div>
      )}
      {available && (
        <>
          <ul className="nav nav-tabs mb-3" id="system_stats_tabs">
            {SECTIONS.map((s) => (
              <li className="nav-item" key={s}>
                <a
                  href={`?tab=${s}`}
                  className={`nav-link${s === section ? ' active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    setSearch({ tab: s })
                  }}
                >
                  {t(`system.tabs.${s}`)}
                </a>
              </li>
            ))}
          </ul>
          <AutoRefresh reload={load} />
          {CHARTS[section].some((chart) => samples[chart.key]) && (
            <table className="clearfloat tdblock my-3" id="chartGrid">
              <tbody>
                <tr>
                  {CHARTS[section].map((chart) =>
                    samples[chart.key] ? (
                      <td key={chart.key}>
                        <LineChart
                          title={t(`system.charts.${chart.key}`)}
                          series={chart.columns.map((c) => c.replaceAll('_', ' '))}
                          points={samples[chart.key]}
                          format={chart.bytes ? bytes : chart.percent ? (v) => `${v.toFixed(1)}%` : (v) => String(Math.round(v * 100) / 100)}
                        />
                      </td>
                    ) : null,
                  )}
                </tr>
              </tbody>
            </table>
          )}
          {views === null
            ? null
            : views.map((view) =>
                view.error ? (
                  <div className="card mb-3" key={view.view}>
                    <div className="card-header">
                      <code>{view.view}</code>
                    </div>
                    <div className="card-body">{t('system.not_provided', { message: view.error })}</div>
                  </div>
                ) : (
                  <StatTable key={view.view} id={`system_${view.view.replace(/\W/g, '')}`} data={view} />
                ),
              )}
        </>
      )}
    </div>
  )
}
