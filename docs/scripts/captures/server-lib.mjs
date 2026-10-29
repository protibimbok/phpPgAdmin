// Helpers shared by the server-level capture scripts (server-*.mjs): psql against the docs
// cluster, and reading the notification phpPgAdmin shows after an action.

import { execFileSync, spawn } from 'node:child_process'

const PG = ['-h', process.env.DOCS_PG_HOST ?? 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', process.env.DOCS_PG_USER ?? 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

/** Runs SQL through psql on `db` (bookshop by default) and returns its unaligned output. */
export function psql(sql, db = 'bookshop') {
  return execFileSync('psql', [...PG, '-d', db, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Like psql(), but returns the error text instead of throwing. */
export function psqlTry(sql, db = 'bookshop') {
  try {
    return psql(sql, db)
  } catch (e) {
    return `ERROR: ${String(e.stderr ?? e.message).trim()}`
  }
}

/** Starts a psql session in the background running `sql` (a pg_sleep, a lock); returns the child process. */
export function background(sql, db = 'bookshop', app = 'srv_docs') {
  return spawn('psql', [...PG, '-d', db, '-c', sql], { env: { ...process.env, PGAPPNAME: app }, stdio: 'ignore' })
}

/** The text of the notification shown at the top of the page, or '' when none appears within `ms`. */
export async function notice(page, ms = 8000) {
  const box = page.locator('.ajax_notification').last()
  const end = Date.now() + ms
  let text = ''
  while (Date.now() < end) {
    text = (await box.count()) ? (await box.innerText().catch(() => '')).trim() : ''
    if (text !== '' && !/^Processing request/.test(text)) return text
    await page.waitForTimeout(150)
  }
  return text
}

/** Waits until the notification is gone (or dismisses an error one), so the next shot is clean. */
export async function clearNotice(page) {
  const box = page.locator('.ajax_notification')
  if (await box.count()) await box.first().click().catch(() => {})
  await page.locator('.ajax_notification').waitFor({ state: 'detached', timeout: 7000 }).catch(() => {})
}

/** Confirms the open ConfirmQuery dialog and returns the statement text it showed. */
export async function confirm(page) {
  const dialog = page.locator('#confirm_dialog')
  await dialog.waitFor({ state: 'visible', timeout: 8000 })
  const text = (await dialog.locator('.modal-body').innerText()).trim()
  await dialog.locator('.submitOK').click()
  return text
}

/**
 * Hides the rows of `table` whose `cell` text is not matched by `keep` (a RegExp), so objects other
 * capture scripts create at the same time stay out of the screenshots. Updates a "Total: n" line.
 */
export async function onlyRows(page, table, keep, cell = 'td:nth-child(2)') {
  await page.evaluate(({ table, keep, cell }) => {
    const re = new RegExp(keep)
    let shown = 0
    for (const tr of document.querySelectorAll(`${table} tbody tr`)) {
      const text = tr.querySelector(cell)?.textContent.trim() ?? ''
      if (re.test(text)) shown++
      else tr.style.display = 'none'
    }
    for (const el of document.querySelectorAll('.fw-bold')) if (/^Total: \d+$/.test(el.textContent.trim())) el.textContent = `Total: ${shown}`
  }, { table, keep: keep.source, cell })
}

/**
 * capture.mjs's open(), signed in as postgres and tried again when the sign-in fails (the shared
 * app answers 503 now and then under load). capture.mjs's login() fills the username before it
 * picks the saved server, and picking a saved server puts that server's last username back in
 * the field, so it can sign in as whoever used the server last; this fills the username after.
 */
export async function openRetry(route, opts = {}, tries = 3) {
  const { open, settle, APP } = await import('../capture.mjs')
  const user = process.env.DOCS_PG_USER ?? 'postgres'
  const target = `${process.env.DOCS_PG_HOST ?? 'localhost'}:${process.env.DOCS_PG_PORT ?? '5499'}`
  for (let i = 1; ; i++) {
    const session = await open(route, { ...opts, login: false })
    const { page } = session
    try {
      if (await page.locator('#input_username').count()) {
        const select = page.locator('#select_server')
        if (await select.count()) {
          const value = await select.locator('option').evaluateAll((os, t) => (os.find((o) => o.textContent.includes(t)) ?? os[os.length - 1]).value, target)
          await select.selectOption(value)
        }
        if (!(await select.count()) || !(await page.locator('#select_server option:checked').textContent()).includes(target)) {
          if (!(await page.locator('#login_advanced_fields').count())) await page.click('#login_advanced a')
          await page.fill('#input_host', target.split(':')[0])
          await page.fill('#input_port', target.split(':')[1])
        }
        await page.fill('#input_username', user)
        await page.fill('#input_password', process.env.DOCS_PG_PASSWORD ?? '')
        await page.click('#input_go')
        await page.waitForSelector('#pma_navigation', { timeout: 20000 })
        await settle(page)
      }
      const me = await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user?.username)
      if (me !== user) throw new Error(`signed in as ${me}, not ${user}`)
      if (new URL(page.url()).pathname + new URL(page.url()).search !== route) {
        await page.goto(APP + route, { waitUntil: 'domcontentloaded' })
        await settle(page)
      }
      return session
    } catch (e) {
      await session.close()
      if (i >= tries) throw e
      console.log(`[retry] open ${route}: ${e.message.split('\n')[0]}`)
    }
  }
}

/**
 * shot() for an element that may sit below the fold: capture.mjs's shot() clips the full-page
 * screenshot with viewport coordinates, which are off once the page has scrolled, so this adds
 * the scroll offset. `maxHeight` cuts a tall element (a long table) after that many pixels.
 */
export async function shotEl(page, name, selector, { pad = 8, maxHeight } = {}) {
  const { MEDIA } = await import('../capture.mjs')
  const path = await import('node:path')
  const fs = await import('node:fs')
  const file = path.join(MEDIA, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const el = page.locator(selector).first()
  await el.scrollIntoViewIfNeeded()
  const box = await el.evaluate((node) => {
    const r = node.getBoundingClientRect()
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
  })
  const width = Math.min(box.width + 2 * pad, page.viewportSize().width - Math.max(0, box.x - pad))
  const height = Math.min(box.height + 2 * pad, maxHeight ?? Infinity)
  // Fixed bars (the console toggle, the top menu) would be painted over a full-page shot; hide them meanwhile.
  await el.evaluate((node) => {
    for (const other of document.querySelectorAll('body *')) {
      if (node.contains(other) || other.contains(node) || other.closest('.modal')) continue
      const position = getComputedStyle(other).position
      if (position === 'fixed' || position === 'sticky') {
        other.dataset.srvHidden = other.style.visibility
        other.style.visibility = 'hidden'
      }
    }
  })
  await page.screenshot({ path: file, fullPage: true, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width, height } })
  await page.evaluate(() => {
    for (const other of document.querySelectorAll('[data-srv-hidden]')) {
      other.style.visibility = other.dataset.srvHidden
      delete other.dataset.srvHidden
    }
  })
  console.log('saved', path.relative(process.cwd(), file))
}

/** capture.mjs's record(), signed in through openRetry(). */
export async function recordAs(name, route, steps, opts = {}) {
  const { MEDIA } = await import('../capture.mjs')
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const path = await import('node:path')
  const viewport = opts.viewport ?? { width: 1280, height: 800 }
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'docs-video-'))
  const { page, context } = await openRetry(route, { ...opts, viewport, recordVideo: { dir, size: viewport } })
  await page.waitForTimeout(600)
  await steps(page)
  await page.waitForTimeout(1200)
  const video = page.video()
  await context.close()
  const webm = await video.path()
  const file = path.join(MEDIA, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', file])
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('saved', path.relative(process.cwd(), file))
}
