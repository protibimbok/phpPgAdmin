// Shared helpers for the table-*.mjs capture scripts (docs pages under schema/ and table/).
// Scratch objects are prefixed tbl_ and dropped at the end of each script.
import { execFileSync } from 'node:child_process'
import { open as openPage, settle } from '../capture.mjs'

const PG = ['-h', process.env.DOCS_PG_HOST ?? 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', process.env.DOCS_PG_USER ?? 'postgres', '-d', 'bookshop', '-XAtq', '-v', 'ON_ERROR_STOP=1']

/** Runs SQL against the docs cluster with psql and returns its output. */
export const psql = (sql) => execFileSync('psql', [...PG, '-c', sql], { encoding: 'utf8' }).trim()

/** open() with a few retries: the docs cluster occasionally refuses a sign-in while other scripts run. */
export async function open(route, opts) {
  for (let i = 0; ; i++) {
    try {
      const result = await openPage(route, opts)
      result.page.setDefaultTimeout(10000)
      return result
    } catch (e) {
      if (i === 3) throw e
      await new Promise((r) => setTimeout(r, 10000))
    }
  }
}

/** Closes the topmost dialog through its Close button. */
export async function closeModal(page) {
  await page.locator('.modal.show .modal-footer button:has-text("Close")').last().click()
  await settle(page, 300)
}

/** Dismisses the notification in the corner, if any. */
export async function dismiss(page) {
  const n = page.locator('#loading_parent .ajax_notification')
  if (await n.count()) await n.click().catch(() => {})
  await page.waitForTimeout(200)
}

/**
 * Shoots a dialog: the page is scrolled back to the top first, since a dialog is fixed to the
 * window and shot() measures from the top of the document; `height` enlarges the window for a
 * dialog taller than 800 px.
 */
export async function modalShot(page, name, selector, height = 1300) {
  const { shot } = await import('../capture.mjs')
  const size = page.viewportSize()
  if (height > size.height) await page.setViewportSize({ width: size.width, height })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  await shot(page, name, { selector })
  if (height > size.height) await page.setViewportSize(size)
}
