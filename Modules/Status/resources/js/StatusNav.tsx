import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import Icon from '@/components/Icon'
import { REFRESH_RATES } from './api'

const PAGES = [
  { key: 'server', path: '/server/status' },
  { key: 'processes', path: '/server/status/processes' },
  { key: 'locks', path: '/server/status/locks' },
  { key: 'prepared', path: '/server/status/prepared' },
  { key: 'monitor', path: '/server/status/monitor' },
  { key: 'logs', path: '/server/status/logs' },
] as const

/** The pills above every Status page, as phpMyAdmin's server/status/base.twig lays them out. */
export default function StatusNav() {
  const { t } = useTranslation('status')

  return (
    <div className="row">
      <ul className="nav nav-pills p-2">
        {PAGES.map((page) => (
          <li className="nav-item" key={page.key}>
            <NavLink to={page.path} end className={({ isActive }) => `nav-link${isActive ? ' active' : ''} disableAjax`}>
              {t(`nav.${page.key}`)}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** phpMyAdmin's refresh-rate option text: "5 seconds", "1 minute", "20 minutes". */
export function rateLabel(t: (key: string, options?: Record<string, unknown>) => string, seconds: number): string {
  return seconds < 60 ? t('rate.seconds', { count: seconds }) : t('rate.minutes', { count: seconds / 60 })
}

/**
 * phpMyAdmin's note and refresh-rate links under the process list: the rate select and
 * Start / Stop auto refresh, which calls reload every rate seconds while it runs.
 */
export function AutoRefresh({ reload }: { reload: () => void }) {
  const { t } = useTranslation('status')
  const [rate, setRate] = useState(5)
  const [auto, setAuto] = useState(false)

  useEffect(() => {
    if (!auto) return
    const timer = window.setInterval(reload, rate * 1000)

    return () => window.clearInterval(timer)
  }, [auto, rate, reload])

  return (
    <>
      <div className="row">
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {t('processes.refresh_note')}
        </div>
      </div>

      <div className="tabLinks row">
        <label>
          {t('rate.label')}:{' '}
          <select id="id_refreshRate" className="refreshRate" name="refreshRate" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {REFRESH_RATES.map((s) => (
              <option key={s} value={s}>
                {rateLabel(t, s)}
              </option>
            ))}
          </select>
        </label>
        <a id="toggleRefresh" href="#toggle" onClick={(e) => { e.preventDefault(); setAuto((a) => !a) }}>
          <Icon name={auto ? 'pause' : 'play'} />
          {auto ? t('processes.stop_refresh') : t('processes.start_refresh')}
        </a>
      </div>
    </>
  )
}
