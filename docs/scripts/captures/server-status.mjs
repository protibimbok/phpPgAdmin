// Server » Status: Server, Processes (cancel / terminate a scratch pg_sleep), Locks (a scratch
// lock wait), Prepared transactions and the Monitor clip.
// Creates and drops the scratch table public.srv_lock in bookshop.
//   node docs/scripts/captures/server-status.mjs

import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, background, notice, clearNotice, confirm, openRetry, recordAs } from './server-lib.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// The process and lock tables are wider than the default viewport.
const WIDE = { viewport: { width: 1720, height: 900 } }

// ---- Server
{
  const { page, close } = await openRetry('/server/status')
  await settle(page, 600)
  await shot(page, 'server/status-server.png', { selector: '.container-fluid' })
  await close()
}

// ---- Processes: a session sleeping in bookshop, cancelled, then another one terminated.
{
  const sleeper = background('SELECT pg_sleep(120) /* srv docs */', 'bookshop', 'srv_docs_sleep')
  await sleep(1500)
  const { page, close } = await openRetry('/server/status/processes', WIDE)
  await settle(page, 600)
  const row = page.locator('#tableprocesslist tbody tr', { hasText: 'srv_docs_sleep' })
  console.log('sleeper rows:', await row.count())
  // Sorting by a column header, twice for descending.
  await page.click('#tableprocesslist a.sortlink:has-text("Time")')
  await page.click('#tableprocesslist a.sortlink:has-text("Time")')
  await settle(page, 200)
  await shot(page, 'server/status-processes.png', { selector: '.container-fluid' })
  await page.click('#tableprocesslist a.sortlink:has-text("PID")')

  // Show only active, then background processes.
  await page.check('#showExecuting')
  await settle(page, 500)
  console.log('active only rows:', await page.locator('#tableprocesslist tbody tr').count(), (await page.locator('#tableprocesslist tbody td:nth-child(8)').allInnerTexts()).join(','))
  await page.uncheck('#showExecuting')
  await page.check('#showBackground')
  await settle(page, 300)
  console.log('backend types:', [...new Set(await page.locator('#tableprocesslist tbody td:nth-child(7)').allInnerTexts())].join(', '))
  await page.uncheck('#showBackground')
  await page.selectOption('#tableFilter select', 'postgres')
  await settle(page, 500)
  console.log('postgres filter dbs:', [...new Set(await page.locator('#tableprocesslist tbody td:nth-child(4)').allInnerTexts())].join(', '))
  await page.selectOption('#tableFilter select', '')
  await settle(page, 500)

  // Own session has no Cancel / Terminate.
  console.log('rows without actions:', await page.locator('#tableprocesslist tbody tr').evaluateAll((rows) => rows.filter((r) => !r.querySelector('.kill_process')).map((r) => r.children[1].textContent + ':' + r.children[5].textContent)))

  await row.locator('a:has-text("Cancel")').click()
  await page.locator('#confirm_dialog').waitFor()
  await shot(page, 'server/status-cancel-confirm.png', { selector: '#confirm_dialog .modal-content' })
  console.log('cancel dialog:', await confirm(page))
  console.log('cancel:', await notice(page))
  await sleep(800)
  console.log('sleeper exit code after cancel:', sleeper.exitCode)
  await clearNotice(page)

  const second = background('SELECT pg_sleep(120) /* srv docs */', 'bookshop', 'srv_docs_sleep')
  await sleep(1500)
  await page.click('#tableFilter input[type=submit]')
  await settle(page, 500)
  await row.locator('a:has-text("Terminate")').click()
  console.log('terminate dialog:', await confirm(page))
  console.log('terminate:', await notice(page))
  await sleep(800)
  console.log('second exit code after terminate:', second.exitCode)
  await clearNotice(page)

  // A pid that is gone: signal it through the API directly.
  const gone = await page.evaluate(async () => {
    const r = await fetch('/api/server/status/activity/999999/cancel', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' }, body: '{}' })
    return `${r.status} ${await r.text()}`
  })
  console.log('cancel missing pid:', gone)

  // Full queries toggle and auto refresh controls.
  console.log('refresh rates:', (await page.locator('#id_refreshRate option').allInnerTexts()).join(', '))
  await page.click('#toggleRefresh')
  console.log('toggle label:', await page.locator('#toggleRefresh').innerText())
  await page.click('#toggleRefresh')
  await close()
}

// ---- Locks: srv_lock held ACCESS EXCLUSIVE by one session, a second waiting.
{
  psqlTry('DROP TABLE IF EXISTS public.srv_lock')
  psql('CREATE TABLE public.srv_lock (id int)')
  const holder = background('BEGIN; LOCK TABLE public.srv_lock IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(40); COMMIT;', 'bookshop', 'srv_docs_holder')
  await sleep(1000)
  const waiter = background('SELECT count(*) FROM public.srv_lock;', 'bookshop', 'srv_docs_waiter')
  await sleep(1500)

  const { page, close } = await openRetry('/server/status/locks', WIDE)
  await page.check('#showWaiting')
  await settle(page, 600)
  console.log('waiting locks:', await page.locator('#tablelocks tbody tr').count())
  await page.uncheck('#showWaiting')
  await page.selectOption('#tableFilter select', 'bookshop')
  await settle(page, 600)
  await shot(page, 'server/status-locks.png', { selector: '#tablelocks' })
  await page.goto(page.url().replace('/locks', '/processes'))
  await settle(page, 800)
  const blocked = page.locator('#tableprocesslist tbody tr.table-warning')
  console.log('blocked rows:', await blocked.count(), await blocked.first().innerText().catch(() => ''))
  await shot(page, 'server/status-processes-blocked.png', { selector: '#tableprocesslist' })
  await close()
  holder.kill()
  waiter.kill()
  psqlTry("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN ('srv_docs_holder', 'srv_docs_waiter')")
  await sleep(500)
  psqlTry('DROP TABLE IF EXISTS public.srv_lock')
}

// ---- Prepared transactions: max_prepared_transactions is 0 on the docs cluster.
{
  console.log('max_prepared_transactions:', psql('SHOW max_prepared_transactions'))
  console.log('PREPARE TRANSACTION:', psqlTry("BEGIN; PREPARE TRANSACTION 'srv_docs'"))
  const { page, close } = await openRetry('/server/status/prepared')
  await settle(page, 600)
  await shot(page, 'server/status-prepared.png', { selector: '.container-fluid' })
  await close()
}

// ---- Monitor: a clip of the live charts while some load runs.
{
  const load = background("SELECT count(*) FROM generate_series(1, 3000) g, LATERAL (SELECT * FROM books LIMIT 5) b; SELECT pg_sleep(2); SELECT count(*) FROM books, authors, orders; INSERT INTO audit_log SELECT * FROM audit_log WHERE false;", 'bookshop', 'srv_docs_load')
  await recordAs('server/status-monitor.mp4', '/server/status/monitor', async (page) => {
    await page.click('a.popupLink')
    await page.waitForTimeout(800)
    await page.selectOption('#id_gridChartRefresh', '2')
    await page.waitForTimeout(600)
    await page.selectOption('#chartColumns', '2')
    await page.waitForTimeout(800)
    await page.click('a.popupLink')
    for (let i = 0; i < 5; i++) {
      background('SELECT count(*) FROM books b1, books b2, authors; SELECT pg_sleep(1);', 'bookshop', 'srv_docs_load')
      await page.waitForTimeout(2000)
    }
    await page.click('a[href="#pauseCharts"]')
    await page.waitForTimeout(1200)
  })
  load.kill()
  const { page, close } = await openRetry('/server/status/monitor')
  await page.click('a.popupLink')
  await settle(page, 300)
  console.log('chart titles:', (await page.locator('#chartGrid').innerText()).split('\n').slice(0, 5).join(' / '))
  console.log('monitor db options:', (await page.locator('#monitorDatabase option').allInnerTexts()).join(', '))
  await close()
}

await done()
