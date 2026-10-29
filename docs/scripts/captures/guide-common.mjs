// Shared by the guide capture scripts: the scratch login role guide_user, and a login helper that
// signs in as it. The guide's own role keeps the Settings changes and the language switch
// these scripts make away from the postgres role the other capture scripts use.
//
// guide_user is created when missing and dropped by dropGuideUser(); its saved preferences in the
// application storage are removed with it. The docs cluster trusts local connections, so no
// password is needed.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP, open, settle } from '../capture.mjs'

export const ROLE = 'guide_user'
const PG = ['-h', process.env.DOCS_PG_HOST ?? 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', 'postgres', '-d', 'postgres', '-Atqc']
const TARGET = `${process.env.DOCS_PG_HOST ?? 'localhost'}:${process.env.DOCS_PG_PORT ?? '5499'}`
const STORAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../storage/phppgadmin.sqlite')

export function psql(sql) {
  return execFileSync('psql', [...PG, sql]).toString().trim()
}

export function sqlite(sql) {
  return execFileSync('sqlite3', [STORAGE, sql]).toString().trim()
}

export function createGuideUser() {
  psql(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN; END IF; END $$`)
}

export function dropGuideUser() {
  psql(`DROP ROLE IF EXISTS ${ROLE}`)
  sqlite(`DELETE FROM preferences WHERE username = '${ROLE}'; DELETE FROM query_history WHERE username = '${ROLE}';`)
}

/**
 * Signs in on the login page as `user`. The server is picked first: picking a saved server
 * fills the username in with the role that last used it, so the username is typed after.
 */
export async function loginAs(page, user = ROLE, password = process.env.GUIDE_PASSWORD ?? '') {
  await page.waitForSelector('#input_username')
  await settle(page)
  const select = page.locator('#select_server')
  if (await select.count()) {
    const value = await select.locator('option').evaluateAll((os, t) => (os.find((o) => o.textContent.includes(t)) ?? os[os.length - 1]).value, TARGET)
    await select.selectOption(value)
  }
  if (!(await page.locator('#select_server').count()) || !(await page.locator('#select_server option:checked').textContent()).includes(TARGET)) {
    if (!(await page.locator('#login_advanced_fields').count())) await page.click('#login_advanced a')
    const [host, port] = TARGET.split(':')
    await page.fill('#input_host', host)
    await page.fill('#input_port', port)
  }
  await page.fill('#input_username', user)
  await page.fill('#input_password', password)
  const [host, port] = TARGET.split(':')
  const where = `host = '${host}' AND port = ${Number(port)}`
  const previous = sqlite(`SELECT last_username FROM servers WHERE ${where}`)
  await page.click('#input_go')
  await page.waitForSelector('#pma_navigation', { timeout: 20000 })
  // The login saved guide_user as the server's last username, which the login page pre-fills and
  // capture.mjs's login() would then sign in as: put the previous one back straight away.
  const restore = previous !== '' && previous !== user ? previous : 'postgres'
  if (user !== restore) sqlite(`UPDATE servers SET last_username = '${restore.replace(/'/g, "''")}' WHERE ${where} AND last_username = '${user}'`)
  await settle(page)
}

/** A page signed in as guide_user at `route`. */
export async function openAs(route = '/', opts = {}) {
  const session = await open('/', { ...opts, login: false })
  await loginAs(session.page, opts.user ?? ROLE)
  if (route !== '/') {
    await session.page.goto(APP + route, { waitUntil: 'domcontentloaded' })
    await settle(session.page)
  }
  return session
}
