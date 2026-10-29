// Helpers shared by the tools capture scripts (tools-*.mjs): psql against the docs cluster, the
// app's JSON API with the page's session, the notification after an action, and a check that
// prints what it verified.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { APP, MEDIA, open as openOnce, shot as shotOnce } from '../capture.mjs'

const PG = ['-h', process.env.DOCS_PG_HOST ?? 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', process.env.DOCS_PG_USER ?? 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

/** Runs SQL through psql on `db` (bookshop by default) and returns its unaligned output. */
export function psql(sql, db = 'bookshop') {
  return execFileSync('psql', [...PG, '-d', db, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** A fresh directory for downloads and generated input files. */
export function workdir(name) {
  return fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), `tools-${name}-`))
}

/** GET or POST the app's API with the page's session; returns { status, json, text, headers }. */
export async function api(page, method, url, data) {
  const r = await page.request.fetch(APP + url, { method, data, headers: { Accept: 'application/json' } })
  const text = await r.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not JSON
  }
  return { status: r.status(), json, text, headers: r.headers() }
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

/** Dismisses the notification (a click on it, as a reader would) so that the next shot is clean. */
export async function clearNotices(page) {
  for (let i = 0; i < 5; i++) {
    const box = page.locator('.ajax_notification')
    if (!(await box.count())) return
    await box.first().dispatchEvent('click').catch(() => {})
    await page.waitForTimeout(200)
  }
}

let failures = 0
/** Prints a verified item; a false condition is reported as a failure and counted. */
export function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`)
}

export function summary() {
  console.log(failures === 0 ? 'all checks passed' : `${failures} check(s) failed`)
}

/**
 * open() from capture.mjs, tried again when the sign-in fails: other capture scripts change the
 * cluster's authentication for a moment now and then.
 */
export async function open(route, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const opened = await openOnce(route, opts)
      if (opts.login === false) return opened
      const me = await api(opened.page, 'GET', '/api/auth/me')
      const user = JSON.stringify(me.json ?? {})
      if (me.status === 200 && user.includes(`"${process.env.DOCS_PG_USER ?? 'postgres'}"`)) return opened
      await opened.close()
      throw new Error(`signed in as someone else: ${user}`)
    } catch (e) {
      console.log(`[open ${route}] attempt ${attempt}: ${e.message.split('\n')[0]}`)
      if (attempt >= 5) throw e
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

/**
 * shot() from capture.mjs, cropped differently: capture.mjs clips a full-page screenshot with the
 * element's viewport position, which is off once the page has scrolled, and a full-page shot
 * paints the fixed bars over the content. This scrolls the element to just below the top bar and
 * clips the viewport; an element taller than the viewport falls back to a full-page clip.
 */
export async function shot(page, name, opts = {}) {
  if (!opts.selector) return shotOnce(page, name, opts)
  const file = path.join(MEDIA, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const pad = opts.pad ?? 8
  const el = page.locator(opts.selector).first()
  await el.waitFor({ state: 'visible', timeout: 10000 })
  const vp = page.viewportSize()
  const doc = await el.evaluate((e) => {
    const r = e.getBoundingClientRect()
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
  })
  const top = opts.top ?? 70
  if (doc.height + 2 * pad <= vp.height - top) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, doc.y - top))
    await page.waitForTimeout(150)
    const r = await el.boundingBox()
    const x = Math.max(0, r.x - pad)
    const y = Math.max(0, r.y - pad)
    await page.screenshot({ path: file, clip: { x, y, width: Math.min(r.width + 2 * pad, vp.width - x), height: Math.min(r.height + 2 * pad, vp.height - y) } })
  } else {
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    const x = Math.max(0, doc.x - pad)
    const y = Math.max(0, doc.y - pad)
    // The fixed bars would be painted where the viewport was; hide them for the shot.
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('body *')) {
        if (getComputedStyle(e).position === 'fixed' && !e.closest('.modal')) {
          e.dataset.toolsHidden = e.style.visibility
          e.style.visibility = 'hidden'
        }
      }
    })
    await page.screenshot({ path: file, fullPage: true, clip: { x, y, width: Math.min(doc.width + 2 * pad, width - x), height: doc.height + 2 * pad } })
    await page.evaluate(() => {
      for (const e of document.querySelectorAll('[data-tools-hidden]')) {
        e.style.visibility = e.dataset.toolsHidden
        delete e.dataset.toolsHidden
      }
    })
  }
  console.log('saved', path.relative(process.cwd(), file))
  return file
}
