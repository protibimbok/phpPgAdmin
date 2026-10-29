// Shared helpers for the database-level capture scripts (database*.mjs).
import { execFileSync } from 'node:child_process'

/** Runs SQL on the docs cluster with psql and returns its unaligned, tuples-only output. */
export function psql(sql, db = 'postgres') {
  return execFileSync('psql', ['-h', process.env.DOCS_PG_HOST ?? 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', process.env.DOCS_PG_USER ?? 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql], { encoding: 'utf8' }).trim()
}

/** The message phpPgAdmin shows at the top of the page (success or error), waiting for it to appear. */
export async function message(page, timeout = 8000) {
  const box = page.locator('.ajax_notification').first()
  await box.waitFor({ timeout }).catch(() => {})
  const text = (await box.count()) ? (await box.innerText()).trim() : ''
  return text
}

/** Clears the shown message so the next one can be read. */
export async function clearMessage(page) {
  const box = page.locator('.ajax_notification')
  if (await box.count()) await box.first().click().catch(() => {})
  await page.waitForTimeout(150)
}

/** The text of the open Preview SQL modal, then closes it. */
export async function previewText(page) {
  const pre = page.locator('.modal.show .preview_sql, .modal.show .alert-danger').last()
  await pre.waitFor({ timeout: 15000 })
  for (let i = 0; i < 100 && /^Loading/.test((await pre.innerText()).trim()); i++) await page.waitForTimeout(150)
  await page.waitForTimeout(100)
  return (await pre.innerText()).trim()
}

export async function closeModal(page) {
  await page.locator('.modal.show .btn-close').last().click()
  await page.waitForTimeout(200)
}

export function check(label, ok, detail = '') {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** open() with retries: the shared dev server sometimes answers 503 while other captures run. */
export async function openRetry(open, route, opts, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      return await open(route, opts)
    } catch (e) {
      if (i >= tries) throw e
      console.log(`open ${route} failed (${e.message.split('\n')[0]}), retrying`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

/**
 * Screenshot of one element under docs/public/media/<name>. capture.mjs's shot() with a selector
 * crops by viewport coordinates on a full-page image, which is off once the page has scrolled;
 * Playwright's element screenshot does the scrolling and cropping itself.
 */
export async function shotEl(page, name, selector) {
  const { MEDIA } = await import('../capture.mjs')
  const path = await import('node:path')
  const fs = await import('node:fs')
  const file = path.join(MEDIA, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await page.locator(selector).first().screenshot({ path: file })
  console.log('saved', path.relative(process.cwd(), file))
}
