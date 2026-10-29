import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { treeState } from '@/layout/tree/treeState'
import { notifyError } from '@/notify'
import { dismissProcess, getProcess, stopProcess, type BackgroundProcess } from './api'

/** Output kept on the page at most; the start of a longer one is cut. */
const OUTPUT_LIMIT = 1048576

/**
 * One background process (an import, or a maintenance command), followed while it runs: its
 * state and progress, and its output, read a piece at a time from where the last read ended.
 * Stop asks the runner to cancel it; Dismiss removes it once it has ended. A process's messages
 * are the import's, or those of its type (process.<type>_*).
 */
export default function ProcessView({ initial, onDismiss }: { initial: BackgroundProcess; onDismiss: () => void }) {
  const { t } = useTranslation('import')
  const [process, setProcess] = useState(initial)
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let offset = 0
    let timer: number | undefined
    let stopped = false
    let wasRunning = initial.state === 'running'

    const poll = () => {
      getProcess(initial.id, offset).then(
        ({ process: next, output: chunk }) => {
          if (stopped) return
          setProcess(next)
          if (chunk.text !== '') {
            setOutput((text) => {
              const joined = text + chunk.text

              return joined.length > OUTPUT_LIMIT ? `…\n${joined.slice(joined.indexOf('\n', joined.length - OUTPUT_LIMIT) + 1)}` : joined
            })
          }
          offset = chunk.offset
          if (wasRunning && next.state !== 'running') {
            // What the import made shows in the navigation panel.
            treeState.refresh()
          }
          wasRunning = next.state === 'running'
          // An ended process is read on until its output is all in.
          if (next.state === 'running' || chunk.offset < chunk.size) timer = window.setTimeout(poll, chunk.offset < chunk.size ? 0 : 1000)
        },
        () => {
          if (!stopped) timer = window.setTimeout(poll, 3000)
        },
      )
    }
    poll()

    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [initial.id, initial.state])

  useEffect(() => {
    const pre = outputRef.current
    if (pre) pre.scrollTop = pre.scrollHeight
  }, [output])

  const running = process.state === 'running'
  const percent = process.size ? Math.min(100, Math.round((process.read / process.size) * 100)) : null
  const file = process.description
  const key = (name: string) => (process.type === 'import' ? `process.${name}` : `process.${process.type}_${name}`)
  const [alert, icon, message] = {
    running: ['alert-primary', 's_notice', t(key('running'), { file })],
    finished: process.errors > 0 ? ['alert-warning', 's_notice', t(key('finished_errors'), { file, errors: process.errors })] : ['alert-success', 's_success', t(key('finished'), { file })],
    failed: ['alert-danger', 's_error', process.errors > 0 ? t(key('failed_errors'), { file, code: process.exit_code, errors: process.errors }) : t(key('failed'), { file, code: process.exit_code })],
    killed: ['alert-warning', 's_notice', t(key('killed'), { file })],
    lost: ['alert-danger', 's_error', t(key('lost'), { file })],
  }[process.state]

  async function stop() {
    setBusy(true)
    try {
      setProcess(await stopProcess(process.id))
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    try {
      await dismissProcess(process.id)
      onDismiss()
    } catch (err) {
      setBusy(false)
      notifyError(errorMessage(err))
    }
  }

  return (
    <div className="card mb-3" id={`${process.type}_process_${process.id}`}>
      <div className="card-header">{t(key('title'), { file, target: process.table ?? process.schema ?? process.database ?? t('process.server') })}</div>
      <div className="card-body">
        <div className={`alert ${alert}`} role="alert">
          <Icon name={icon} /> {message}
        </div>
        {running && percent !== null && (
          <div className="progress mb-3" role="progressbar" aria-label={t('process.progress')} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar progress-bar-striped progress-bar-animated" style={{ width: `${percent}%` }}>
              {percent}%
            </div>
          </div>
        )}
        <p className="card-text">
          <code>{process.command.join(' ')}</code>
        </p>
        {output !== '' && (
          <pre ref={outputRef} className="border rounded p-2 mb-3 overflow-auto" style={{ maxHeight: '20rem' }}>
            {output}
          </pre>
        )}
        {running ? (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void stop()}>
            {t('process.stop')}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void dismiss()}>
            {t('process.dismiss')}
          </button>
        )}
      </div>
    </div>
  )
}
