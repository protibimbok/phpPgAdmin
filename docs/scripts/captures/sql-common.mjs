// Shared helpers for the sql*.mjs capture scripts (SQL tab, Browse, Insert, Search, console).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { APP, MEDIA, open, settle } from '../capture.mjs'

export const PSQL = ['-h', process.env.DOCS_PG_HOST ?? 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', process.env.DOCS_PG_USER ?? 'postgres', '-d', 'bookshop', '-v', 'ON_ERROR_STOP=1', '-Atqc']

/** Runs SQL on the docs cluster with psql and returns its output. */
export const psql = (sql) => execFileSync('psql', [...PSQL, sql]).toString().trim()

/**
 * Signs in as DOCS_PG_USER (postgres). The server is chosen before the username is typed: picking
 * a saved server fills in the role that used it last, which would otherwise replace the username.
 */
async function signIn(page) {
  const target = `${process.env.DOCS_PG_HOST ?? 'localhost'}:${process.env.DOCS_PG_PORT ?? '5499'}`
  const select = page.locator('#select_server')
  if (await select.count()) {
    const value = await select.locator('option').evaluateAll((os, t) => (os.find((o) => o.textContent.includes(t)) ?? os[os.length - 1]).value, target)
    await select.selectOption(value)
  }
  await page.fill('#input_username', process.env.DOCS_PG_USER ?? 'postgres')
  await page.fill('#input_password', process.env.DOCS_PG_PASSWORD ?? '')
  await page.click('#input_go')
  await page.waitForSelector('#pma_navigation', { timeout: 20000 })
  await settle(page)
}

/** open() signed in as postgres, with a few retries: a sign-in can fail while other scripts change the cluster. */
export async function openRetry(route, opts = {}) {
  let last
  for (let i = 0; i < 4; i++) {
    const handle = await open(route, { ...opts, login: false })
    try {
      if (await handle.page.locator('#input_username').count()) {
        await signIn(handle.page)
        await handle.page.goto(APP + route, { waitUntil: 'domcontentloaded' })
        await settle(handle.page)
      }
      return handle
    } catch (e) {
      last = e
      await handle.close()
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  throw last
}

/** Replaces the SQL editor's text (CodeMirror) and closes the completion popup. */
export async function setSql(page, sql, selector = '#sqlqueryform .cm-content') {
  await page.click(selector)
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(sql)
  await page.keyboard.press('Escape')
}

/** Runs the query box and waits for the results. */
export async function go(page) {
  await page.click('#button_submit_query')
  await settle(page, 700)
}

/** The scratch tables the scripts edit: copies of seed tables, plus one with a column of many types. */
export function createScratch() {
  psql(`DROP TABLE IF EXISTS sql_books, sql_types; DROP TYPE IF EXISTS sql_mood;
    CREATE TABLE sql_books AS SELECT * FROM books; ALTER TABLE sql_books ADD PRIMARY KEY (id);
    CREATE TYPE sql_mood AS ENUM ('happy', 'sad', 'ok');
    CREATE TABLE sql_types (
      id serial PRIMARY KEY, ident int GENERATED ALWAYS AS IDENTITY, label varchar(20) NOT NULL DEFAULT 'new',
      note text, flag boolean, mood sql_mood DEFAULT 'ok', born date, at_time time(3), stamp timestamptz NOT NULL,
      amount numeric(10,2), ratio double precision, doc jsonb, tags text[], blob bytea, uid uuid, span int4range,
      addr address, ts tsvector, doubled int GENERATED ALWAYS AS (id * 2) STORED, isbn isbn13);
    INSERT INTO sql_types (label, note, flag, mood, born, at_time, stamp, amount, ratio, doc, tags, blob, uid, span, addr, ts, isbn)
    VALUES ('first', repeat('long text ', 10), true, 'happy', '2024-02-29', '13:14:15.5', '2026-10-01 09:30+00', 12.5, 0.25,
            '{"a": 1, "b": [1, 2]}', '{x,"y z"}', '\\xdeadbeef', '30f93799-9e80-4d54-8fbc-8be5ba457515', '[1,10)',
            ROW('1 High St', 'Leeds', 'LS1 1AA', 'GB'), to_tsvector('english', 'the quick brown fox'), '9780000000001'),
           ('second', NULL, NULL, 'sad', NULL, NULL, '2026-10-02 10:00+00', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);`)
}

export function dropScratch() {
  psql('DROP TABLE IF EXISTS sql_books, sql_types; DROP TYPE IF EXISTS sql_mood; DROP SEQUENCE IF EXISTS sql_seq; DROP VIEW IF EXISTS sql_view_demo')
}

/** capture.mjs's record(), signed in through openRetry(): a clip under docs/public/media/<name>. */
export async function recordClip(name, route, steps, opts = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'docs-video-'))
  const viewport = opts.viewport ?? { width: 1280, height: 800 }
  const started = Date.now()
  const { page, context } = await openRetry(route, { ...opts, recordVideo: { dir, size: viewport } })
  await page.waitForTimeout(600)
  const skip = Math.max(0, (Date.now() - started) / 1000 - 0.5)
  await steps(page)
  await page.waitForTimeout(1200)
  const video = page.video()
  await context.close()
  const webm = await video.path()
  const file = path.join(MEDIA, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // The sign-in at the start of the recording is cut off.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(skip.toFixed(2)), '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '28',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', file])
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('saved', path.relative(process.cwd(), file))
  return file
}

/**
 * Saves a PNG of one element under docs/public/media/<name> with Playwright's element screenshot,
 * which crops correctly below the fold too.
 */
export async function snap(page, name, selector, opts = {}) {
  const file = path.join(MEDIA, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const el = page.locator(selector).first()
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(opts.wait ?? 250)
  // The console bar is fixed to the bottom of the window and would cover the element's last line.
  const hide = opts.keepConsole ? '' : '#pma_console_container { display: none !important; }'
  const style = hide ? await page.addStyleTag({ content: hide }) : null
  await el.screenshot({ path: file, animations: 'disabled' })
  await style?.evaluate((node) => node.remove())
  console.log('saved', path.relative(process.cwd(), file))
  return file
}

/** Calls the app's JSON API from the signed-in page. */
export function api(page, method, url, body) {
  return page.evaluate(async ([method, url, body]) => {
    const r = await fetch(url, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return r.json().catch(() => null)
  }, [method, url, body])
}
