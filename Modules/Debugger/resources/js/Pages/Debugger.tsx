import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { notifyError } from '@/notify'
import { debugCommand, debugHeartbeat, debugTarget, startDebugging, stopDebugging, stopDebuggingOnLeave, type ArgumentValue, type DebugState, type DebugTarget } from '../api'

type Tab = 'parameters' | 'locals' | 'messages' | 'results' | 'stack'

/** How often a page waiting in-context asks whether a session has reached the breakpoint. */
const WAIT_POLL_MS = 1000

/** How often an open page tells its session it is still there (the session gives up after three minutes of silence). */
const HEARTBEAT_MS = 30000

/**
 * pgAdmin's debugger for a PL/pgSQL function or procedure, direct debugging: the arguments
 * dialog (each argument's value, or NULL, an expression or its default), then the routine's
 * source with the statement it stopped at, breakpoints toggled in the gutter, the toolbar (step
 * into, step over, continue, clear all breakpoints, stop), and the Parameters, Local variables,
 * Messages, Results and Stack tabs. A variable's value can be changed while paused.
 *
 * With ?mode=indirect, and always for a trigger function, it is pgAdmin's "Set breakpoint"
 * instead: a global breakpoint on the routine, then waiting until another session (an
 * application, a statement that fires the trigger) calls it, which then stops here.
 */
export default function Debugger() {
  const { db = '', schema = '', kind = 'function', oid = '0' } = useParams()
  const { t } = useTranslation('debugger')
  const [params] = useSearchParams()
  const { data, error } = useRequest(() => debugTarget(db, Number(oid)), [db, oid])
  const [session, setSession] = useState<{ id: string; call: string | null; state: DebugState } | null>(null)
  const sessionId = useRef<string | null>(null)

  // A session left behind when the page is left is stopped: on leaving it within the app, and
  // on closing or reloading the tab, where only a beacon still gets through.
  useEffect(() => {
    const leave = () => {
      if (!sessionId.current) return
      stopDebuggingOnLeave(sessionId.current)
      sessionId.current = null
      setSession(null)
    }
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('pagehide', leave)
      if (sessionId.current) void stopDebugging(sessionId.current).catch(() => undefined)
    }
  }, [])

  // While the session lives, the page's heartbeat keeps it.
  const liveId = session?.id
  useEffect(() => {
    if (!liveId) return
    const beat = () => void debugHeartbeat(liveId).catch(() => undefined)
    beat()
    const timer = window.setInterval(beat, HEARTBEAT_MS)
    return () => window.clearInterval(timer)
  }, [liveId])

  if (error) {
    return (
      <div className="alert alert-danger m-3" role="alert">
        {error.message}
      </div>
    )
  }
  if (!data) return null

  const back = `${urls.schema(db, schema)}/routines/${kind}/${oid}/edit`
  const indirect = params.get('mode') === 'indirect' || data.target.trigger
  const started = (s: { id: string; call: string | null; state: DebugState }) => {
    sessionId.current = s.id
    setSession(s)
  }

  return (
    <div className="container-fluid my-3" id="debugger">
      <h2>
        <Icon name="b_routines" /> {t('title', { name: `${data.target.schema}.${data.target.name}(${data.target.signature})` })}
      </h2>
      {data.reason ? (
        <div className="alert alert-warning" role="alert">
          <Icon name="s_attention" /> {data.reason}
        </div>
      ) : session ? (
        <Session
          target={data.target}
          session={session}
          onState={(state) => setSession((s) => (s ? { ...s, state } : s))}
          onStopped={() => {
            sessionId.current = null
            setSession(null)
          }}
        />
      ) : indirect ? (
        <BreakpointForm
          superuser={data.superuser}
          onStart={() =>
            startDebugging(db, data.target.oid, [], 'indirect').then(started, (e: unknown) => {
              notifyError(errorMessage(e))
            })
          }
        />
      ) : (
        <ArgumentsForm
          target={data.target}
          onStart={(args) =>
            startDebugging(db, data.target.oid, args).then(started, (e: unknown) => {
              notifyError(errorMessage(e))
            })
          }
        />
      )}
      <p className="mt-3">
        <Link to={back}>{t('back')}</Link>
      </p>
    </div>
  )
}

/** In-context debugging: what will happen, and the button that sets the global breakpoint. */
function BreakpointForm({ superuser, onStart }: { superuser: boolean; onStart: () => Promise<void> }) {
  const { t } = useTranslation('debugger')
  const [busy, setBusy] = useState(false)
  if (!superuser) {
    return (
      <div className="alert alert-warning" role="alert">
        <Icon name="s_attention" /> {t('indirect.superuser')}
      </div>
    )
  }
  return (
    <div className="card mb-3" id="debugger_breakpoint">
      <div className="card-header">{t('indirect.title')}</div>
      <div className="card-body">
        <p className="card-text">{t('indirect.help')}</p>
      </div>
      <div className="card-footer text-end">
        <button
          type="button"
          className="btn btn-primary"
          id="debug_start"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onStart().finally(() => setBusy(false))
          }}
        >
          {t('indirect.set')}
        </button>
      </div>
    </div>
  )
}

/** pgAdmin's "Debugger" arguments dialog: a row per argument the call takes. */
function ArgumentsForm({ target, onStart }: { target: DebugTarget; onStart: (args: ArgumentValue[]) => Promise<void> }) {
  const { t } = useTranslation('debugger')
  const [values, setValues] = useState<ArgumentValue[]>(() => target.arguments.map((a) => ({ value: '', null: false, expression: false, use_default: a.default !== null })))
  const [busy, setBusy] = useState(false)
  const set = (i: number, patch: Partial<ArgumentValue>) => setValues((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const inputs = target.arguments.map((a, i) => ({ a, i })).filter(({ a }) => a.mode !== 'o' && a.mode !== 't')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        void onStart(values).finally(() => setBusy(false))
      }}
    >
      <div className="card mb-3">
        <div className="card-header">{t('arguments.title')}</div>
        <div className="card-body">
          {inputs.length === 0 ? (
            <p className="card-text">{t('arguments.none')}</p>
          ) : (
            <table className="table table-striped w-auto mb-0" id="debugger_arguments">
              <thead>
                <tr>
                  <th>{t('arguments.name')}</th>
                  <th>{t('arguments.type')}</th>
                  <th>{t('arguments.null')}</th>
                  <th>{t('arguments.expression')}</th>
                  <th>{t('arguments.value')}</th>
                  <th>{t('arguments.use_default')}</th>
                  <th>{t('arguments.default')}</th>
                </tr>
              </thead>
              <tbody>
                {inputs.map(({ a, i }) => (
                  <tr key={i}>
                    <td>
                      {a.name || `$${i + 1}`}
                      {a.mode === 'v' ? ' (VARIADIC)' : a.mode === 'b' ? ' (INOUT)' : ''}
                    </td>
                    <td>
                      <code>{a.type}</code>
                    </td>
                    <td>
                      <input type="checkbox" aria-label={t('arguments.null')} checked={values[i].null} disabled={values[i].use_default} onChange={(e) => set(i, { null: e.target.checked })} />
                    </td>
                    <td>
                      <input type="checkbox" aria-label={t('arguments.expression')} checked={values[i].expression} disabled={values[i].use_default || values[i].null} onChange={(e) => set(i, { expression: e.target.checked })} />
                    </td>
                    <td>
                      <input type="text" name={`arg_${i}`} value={values[i].value} disabled={values[i].use_default || values[i].null} onChange={(e) => set(i, { value: e.target.value })} />
                    </td>
                    <td>{a.default !== null && <input type="checkbox" aria-label={t('arguments.use_default')} checked={values[i].use_default} onChange={(e) => set(i, { use_default: e.target.checked })} />}</td>
                    <td>{a.default !== null && <code>{a.default}</code>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card-footer text-end">
          <input className="btn btn-primary" type="submit" id="debug_start" value={t('debug')} disabled={busy} />
        </div>
      </div>
    </form>
  )
}

/** A running session: the toolbar, the source, the tabs. */
function Session({ target, session, onState, onStopped }: { target: DebugTarget; session: { id: string; call: string | null; state: DebugState }; onState: (s: DebugState) => void; onStopped: () => void }) {
  const { t } = useTranslation('debugger')
  const [tab, setTab] = useState<Tab>('parameters')
  const [busy, setBusy] = useState(false)
  const state = session.state
  const paused = state.status === 'paused'
  const lines = (state.source ?? '').split('\n')
  // The session numbers the lines as the routine editor does.
  const current = state.frame ? state.frame.line : -1
  const func = state.frame?.func ?? target.oid
  const breakpoints = new Set((state.breakpoints ?? []).filter((b) => b.func === func).map((b) => b.line))
  const currentLine = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    currentLine.current?.scrollIntoView({ block: 'nearest' })
  }, [current, func])

  useEffect(() => {
    if (state.status === 'finished') setTab(state.error ? 'messages' : 'results')
  }, [state.status, state.error])

  // In-context, the page asks until a session has reached the breakpoint.
  const waiting = state.status === 'waiting'
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => {
      debugCommand(session.id, 'state').then(onState, () => undefined)
    }, WAIT_POLL_MS)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, session.id])

  async function send(command: string, extra: Record<string, unknown> = {}) {
    setBusy(true)
    try {
      onState(await debugCommand(session.id, command, extra))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await stopDebugging(session.id)
    } catch {
      // A session that ended on its own is stopped already.
    }
    onStopped()
  }

  const tools: { id: string; command: string; label: string; icon: string }[] = [
    { id: 'btn-step-into', command: 'step_into', label: t('toolbar.step_into'), icon: 'b_nextpage' },
    { id: 'btn-step-over', command: 'step_over', label: t('toolbar.step_over'), icon: 'b_undo' },
    { id: 'btn-continue', command: 'continue', label: t('toolbar.continue'), icon: 'play' },
    { id: 'btn-clear-breakpoints', command: 'clear_breakpoints', label: t('toolbar.clear_breakpoints'), icon: 'b_empty' },
  ]
  const variables = (cls: string) => (state.variables ?? []).filter((v) => (cls === 'A' ? v.class === 'A' : v.class !== 'A'))

  return (
    <>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2" id="debugger_toolbar">
        <div className="btn-group">
          {tools.map((tool) => (
            <button key={tool.id} id={tool.id} type="button" className="btn btn-secondary" title={tool.label} disabled={!paused || busy} onClick={() => void send(tool.command)}>
              <Icon name={tool.icon} /> {tool.label}
            </button>
          ))}
          <button id="btn-stop" type="button" className="btn btn-secondary" title={t('toolbar.stop')} disabled={busy} onClick={() => void stop()}>
            <Icon name="s_cancel" /> {state.status === 'finished' ? t('toolbar.close') : t('toolbar.stop')}
          </button>
        </div>
        <span className="ms-2" id="debugger_status">
          {state.status === 'waiting'
            ? t('status.waiting')
            : state.status === 'finished'
              ? state.error
                ? t('status.failed')
                : state.mode === 'indirect' && state.target_pid
                  ? t('status.target_finished', { pid: state.target_pid })
                  : t('status.finished')
              : state.frame
                ? t('status.paused', { line: current, name: state.frame.name }) + (state.target_pid ? ` ${t('status.in_session', { pid: state.target_pid })}` : '')
                : t('status.running')}
        </span>
      </div>
      {session.call && (
        <p>
          <code>{session.call}</code>
        </p>
      )}

      {state.source !== undefined && (
        <div className="card mb-3">
          <div className="card-header">{state.frame?.name}</div>
          <div className="card-body p-0" style={{ maxHeight: '45vh', overflow: 'auto' }}>
            <table className="table table-sm mb-0 font-monospace" id="debugger_source">
              <tbody>
                {lines.map((text, i) => {
                  const line = i + 1
                  return (
                    <tr key={line} ref={line === current ? currentLine : undefined} className={line === current ? 'table-warning' : undefined}>
                      <td
                        className="text-end text-muted user-select-none"
                        style={{ width: '4em', cursor: paused ? 'pointer' : undefined }}
                        title={t('toolbar.toggle_breakpoint')}
                        onClick={() => paused && void send(breakpoints.has(line) ? 'drop_breakpoint' : 'set_breakpoint', { line, func })}
                      >
                        {breakpoints.has(line) ? <span className="text-danger" aria-label={t('breakpoint')}>●</span> : null} {line}
                      </td>
                      <td style={{ whiteSpace: 'pre' }}>{text}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ul className="nav nav-tabs" role="tablist">
        {(['parameters', 'locals', 'messages', 'results', 'stack'] as Tab[]).map((name) => (
          <li className="nav-item" key={name}>
            <a
              href={`#${name}`}
              className={`nav-link${tab === name ? ' active' : ''}`}
              onClick={(e) => {
                e.preventDefault()
                setTab(name)
              }}
            >
              {t(`tabs.${name}`)}
            </a>
          </li>
        ))}
      </ul>
      <div className="card border-top-0 mb-3">
        <div className="card-body" id={`debugger_${tab}`}>
          {(tab === 'parameters' || tab === 'locals') &&
            (!paused ? (
              <span className="text-muted">{t('not_paused')}</span>
            ) : (
              <table className="table table-striped table-sm w-auto mb-0">
                <thead>
                  <tr>
                    <th>{t('vars.name')}</th>
                    <th>{t('vars.type')}</th>
                    <th>{t('vars.value')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {variables(tab === 'parameters' ? 'A' : 'L').map((v) => (
                    <tr key={v.name}>
                      <td>{v.name}</td>
                      <td>
                        <code>{v.type}</code>
                      </td>
                      <td>{v.value === null ? <i>NULL</i> : v.value}</td>
                      <td>
                        {!v.const && (
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault()
                              const value = window.prompt(t('vars.new_value', { name: v.name }), v.value ?? '')
                              if (value !== null) void send('deposit', { name: v.name, value })
                            }}
                          >
                            <Icon name="b_edit" /> {t('vars.edit')}
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          {tab === 'messages' && (
            <pre className="mb-0">
              {[...state.messages, ...(state.error ? [state.error] : [])].join('\n') || t('no_messages')}
            </pre>
          )}
          {tab === 'results' &&
            (state.result ? (
              <table className="table table-striped table-sm w-auto mb-0">
                <thead>
                  <tr>
                    {state.result.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {state.result.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell === null ? <i>NULL</i> : cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="text-muted">{state.error ?? t('no_result')}</span>
            ))}
          {tab === 'stack' &&
            (paused ? (
              <table className="table table-striped table-hover table-sm w-auto mb-0">
                <tbody>
                  {(state.stack ?? []).map((f) => (
                    <tr key={f.level} style={{ cursor: 'pointer' }} onClick={() => void send('select_frame', { level: f.level })}>
                      <td>{f.name}</td>
                      <td>{t('stack.line', { line: f.line })}</td>
                      <td>
                        <code>{f.args}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <span className="text-muted">{t('not_paused')}</span>
            ))}
        </div>
      </div>
      {state.status === 'finished' && (
        <p>
          <a
            href="#"
            id="debug_again"
            onClick={(e) => {
              e.preventDefault()
              void stop()
            }}
          >
            {t('again')}
          </a>
        </p>
      )}
    </>
  )
}
