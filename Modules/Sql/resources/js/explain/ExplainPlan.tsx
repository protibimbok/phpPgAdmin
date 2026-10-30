import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { notifyError } from '@/notify'
import { useSession } from '@/session'
import Analysis from './Analysis'
import Graphical from './Graphical'
import Statistics from './Statistics'
import { explainSql, loadOptions, majorVersion, mayAnalyze, saveOptions, stripExplain, supported, type ExplainOptions } from './options'
import { analyse, type RawExplain } from './plan'
import { planText } from './text'
import '../../scss/explain.scss'

export interface ExplainPlanProps {
  plan: RawExplain
  /** The EXPLAIN statement that gave the plan. */
  sql: string
  /** Runs another EXPLAIN of the statement, with the options of the footer. */
  onExplain?: (sql: string) => void
}

type View = 'graphical' | 'analysis' | 'statistics' | 'text'

const VIEWS: View[] = ['graphical', 'analysis', 'statistics', 'text']

/** The checkboxes of pgAdmin's Explain Settings menu, in its order, and when each applies. */
const CHECKS: { key: Exclude<keyof ExplainOptions, 'serialize'>; analyzeOnly?: boolean; plainOnly?: boolean }[] = [
  { key: 'buffers', analyzeOnly: true },
  { key: 'costs' },
  { key: 'generic_plan', plainOnly: true },
  { key: 'memory' },
  { key: 'settings' },
  { key: 'summary' },
  { key: 'timing', analyzeOnly: true },
  { key: 'verbose' },
  { key: 'wal', analyzeOnly: true },
]

/**
 * An EXPLAIN (FORMAT JSON) result as pgAdmin's explain panel shows it, in a card under the
 * statement's message: the Graphical, Analysis and Statistics tabs as pills, with a Text pill
 * for the plan the way the text format writes it. The footer holds pgAdmin's Explain Settings
 * and its Explain and Explain analyze buttons, which run the statement again with them.
 */
export default function ExplainPlan({ plan, sql, onExplain }: ExplainPlanProps) {
  const { t } = useTranslation('sql')
  const { user } = useSession()
  const major = majorVersion(user.server.version)
  const can = supported(major)
  const [view, setView] = useState<View>('graphical')
  const [options, setOptions] = useState<ExplainOptions>(loadOptions)
  const analysis = useMemo(() => analyse(plan), [plan])
  const text = useMemo(() => planText(plan), [plan])
  const statement = stripExplain(sql)
  const stamp = () => new Date().getTime()

  function change(next: ExplainOptions) {
    setOptions(next)
    saveOptions(next)
  }

  function download(kind: 'svg' | 'png' | 'json', svg: SVGSVGElement | null) {
    const name = `explain_plan_${stamp()}`
    if (kind === 'json') return save(new Blob([JSON.stringify([plan], null, 2)], { type: 'application/json' }), `${name}.json`)
    if (!svg) return
    const markup = standalone(svg)
    if (kind === 'svg') return save(new Blob([markup], { type: 'image/svg+xml' }), `${name}.svg`)

    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = svg.width.baseVal.value
      canvas.height = svg.height.baseVal.value
      canvas.getContext('2d')?.drawImage(image, 0, 0)
      canvas.toBlob((blob) => (blob ? save(blob, `${name}.png`) : notifyError(t('explain.save_failed'))), 'image/png')
    }
    image.onerror = () => notifyError(t('explain.save_failed'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  }

  return (
    <div className="card mb-3 explain-plan" id="explain_plan">
      <div className="card-header">{t('explain.title')}</div>
      <div className="card-body">
        <ul className="nav nav-pills mb-3" role="tablist">
          {VIEWS.map((v) => (
            <li key={v} className="nav-item" role="presentation">
              <a
                href={`#explain-${v}`}
                className={`nav-link${view === v ? ' active' : ''}`}
                role="tab"
                aria-selected={view === v}
                onClick={(e) => {
                  e.preventDefault()
                  setView(v)
                }}
              >
                {t(`explain.${v}`)}
              </a>
            </li>
          ))}
        </ul>
        <div className="tab-content">
          {view === 'graphical' && <Graphical analysis={analysis} onDownload={download} />}
          {view === 'analysis' && <Analysis analysis={analysis} />}
          {view === 'statistics' && <Statistics analysis={analysis} />}
          {view === 'text' && (
            <pre className="explain-text mb-0" dir="ltr">
              {text}
            </pre>
          )}
        </div>
      </div>
      {onExplain && (
        <div className="card-footer">
          <div className="row row-cols-lg-auto g-3 align-items-center">
            {CHECKS.filter(({ key }) => (key === 'generic_plan' ? can.generic_plan : key === 'memory' ? can.memory : true)).map(({ key, analyzeOnly, plainOnly }) => (
              <div key={key} className="col-12">
                <div className="form-check form-check-inline" title={analyzeOnly ? t('explain.analyze_only') : plainOnly ? t('explain.plain_only') : undefined}>
                  <input className="form-check-input" type="checkbox" id={`explain_${key}`} checked={options[key]} onChange={(e) => change({ ...options, [key]: e.target.checked })} />
                  <label className="form-check-label" htmlFor={`explain_${key}`}>
                    {t(`explain.options.${key}`)}
                  </label>
                </div>
              </div>
            ))}
            {can.serialize && (
              <div className="col-12">
                <div className="input-group">
                  <label className="input-group-text" htmlFor="explain_serialize">
                    {t('explain.options.serialize')}
                  </label>
                  <select className="form-select" id="explain_serialize" value={options.serialize} title={t('explain.analyze_only')} onChange={(e) => change({ ...options, serialize: e.target.value as ExplainOptions['serialize'] })}>
                    <option value="none">{t('explain.options.serialize_none')}</option>
                    <option value="text">{t('explain.options.serialize_text')}</option>
                    <option value="binary">{t('explain.options.serialize_binary')}</option>
                  </select>
                </div>
              </div>
            )}
            <div className="col-12">
              <input className="btn btn-secondary" type="button" id="explain_run" value={t('explain.explain')} onClick={() => onExplain(explainSql(statement, options, false, major))} />
              {mayAnalyze(statement) && (
                <input className="btn btn-primary ms-1" type="button" id="explain_run_analyze" value={t('explain.explain_analyze')} onClick={() => onExplain(explainSql(statement, options, true, major))} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** The drawing as a standalone SVG document: its colours, set by the stylesheet, written onto each element. */
function standalone(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  const originals = svg.querySelectorAll('*')
  copy.querySelectorAll('*').forEach((node, i) => {
    const style = getComputedStyle(originals[i])
    const props = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'font-size', 'font-family', 'opacity']
    ;(node as SVGElement).setAttribute('style', props.map((p) => `${p}:${style.getPropertyValue(p)}`).join(';'))
  })

  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`
}

/** Hand a file to the browser to save. */
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  // Some browsers download only from a link that is in the document.
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
