// Screenshot and screen-recording helpers for the documentation.
//
// A capture script imports these, drives the app with Playwright and writes into docs/public/media/.
//
//   import { open, shot, record } from './capture.mjs'
//   const { page, close } = await open('/server/databases')
//   await shot(page, 'databases/list.png')                         // the content area
//   await shot(page, 'databases/create-card.png', { selector: '#create_database_form' })
//   await close()
//   await record('sql/run-query.mp4', '/db/bookshop/sql', async (page) => { ... })
//
// Environment: DOCS_APP_URL (default http://phppgadmin.test), DOCS_PG_HOST / DOCS_PG_PORT (default
// localhost:5499, the cluster docs/scripts/demo-cluster.sh starts), DOCS_PG_USER / DOCS_PG_PASSWORD
// (default postgres, no password), CHROME (default /usr/bin/google-chrome-stable).

import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP = (process.env.DOCS_APP_URL ?? 'http://phppgadmin.test').replace(/\/$/, '')
export const MEDIA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/media')
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome-stable'
const PG_HOST = process.env.DOCS_PG_HOST ?? 'localhost'
const PG_PORT = process.env.DOCS_PG_PORT ?? '5499'
const VIEWPORT = { width: 1280, height: 800 }

let browser
async function launch() {
  browser ??= await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
  return browser
}

export async function settle(page, ms = 400) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(ms)
}

/** Signs in to the docs cluster (DOCS_PG_HOST:DOCS_PG_PORT) through the login form's Advanced section. */
export async function login(page) {
  if (!(await page.locator('#input_username').count())) return
  const target = `${PG_HOST}:${PG_PORT}`
  const select = page.locator('#select_server')
  if (await select.count()) {
    const value = await select.locator('option').evaluateAll((os, t) => (os.find((o) => o.textContent.includes(t)) ?? os[os.length - 1]).value, target)
    await select.selectOption(value)
  }
  if (!(await page.locator('#select_server').count()) || (await page.locator('#select_server option:checked').textContent()).includes(target) === false) {
    if (!(await page.locator('#login_advanced_fields').count())) await page.click('#login_advanced a')
    await page.fill('#input_host', PG_HOST)
    await page.fill('#input_port', PG_PORT)
  }
  // After the server choice: picking a saved server fills in the username last used with it.
  await page.fill('#input_username', process.env.DOCS_PG_USER ?? 'postgres')
  if (process.env.DOCS_PG_PASSWORD) await page.fill('#input_password', process.env.DOCS_PG_PASSWORD)
  await page.click('#input_go')
  await page.waitForSelector('#pma_navigation', { timeout: 20000 })
  await settle(page)
}

/** Opens `route` signed in. Pass `{ login: false }` to stay on the login page. */
export async function open(route = '/', opts = {}) {
  const b = await launch()
  const context = await b.newContext({ viewport: opts.viewport ?? VIEWPORT, deviceScaleFactor: opts.scale ?? 1, recordVideo: opts.recordVideo })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message.slice(0, 300)}`))
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text().slice(0, 300)}`) })
  await page.goto(APP + route, { waitUntil: 'domcontentloaded' })
  await settle(page)
  if (opts.login !== false) {
    await login(page)
    if (new URL(page.url()).pathname + new URL(page.url()).search !== route) {
      await page.goto(APP + route, { waitUntil: 'domcontentloaded' })
      await settle(page)
    }
  }
  return { page, context, close: () => context.close() }
}

/**
 * Saves a PNG under docs/public/media/<name>. Without a selector it takes the whole viewport;
 * `selector` crops to one element (with `pad` px around it), `fullPage` takes the whole document.
 */
export async function shot(page, name, opts = {}) {
  const file = path.join(MEDIA, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (opts.selector) {
    const el = page.locator(opts.selector).first()
    await el.scrollIntoViewIfNeeded()
    const box = await el.boundingBox()
    if (!box) throw new Error(`shot ${name}: ${opts.selector} is not visible`)
    const pad = opts.pad ?? 8
    const vp = page.viewportSize()
    const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad)
    const width = Math.min(box.width + 2 * pad, vp.width - x), height = box.height + 2 * pad
    if (y + height <= vp.height) {
      // In view after scrolling: clip the viewport, which is right for fixed dialogs as well.
      await page.screenshot({ path: file, clip: { x, y, width, height } })
    } else {
      // Taller than the window: Playwright stitches the element itself (no padding).
      await el.screenshot({ path: file })
    }
  } else {
    await page.screenshot({ path: file, fullPage: !!opts.fullPage })
  }
  console.log('saved', path.relative(process.cwd(), file))
  return file
}

/**
 * Records `steps(page)` starting at `route` and saves it as an H.264 MP4 under docs/public/media/<name>
 * (no audio, small enough to commit). Keep clips under ~20 s; use page.waitForTimeout between steps
 * so a reader can follow, and `type(page, selector, text)` for visible typing.
 */
export async function record(name, route, steps, opts = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'docs-video-'))
  const { page, context } = await open(route, { ...opts, recordVideo: { dir, size: opts.viewport ?? VIEWPORT } })
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
  return file
}

/** Types into a field one key at a time so it shows up in a recording. */
export async function type(page, selector, text, delay = 45) {
  await page.click(selector)
  await page.keyboard.type(text, { delay })
}

export async function done() {
  await browser?.close()
}
