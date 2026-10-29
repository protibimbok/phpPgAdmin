// Server » Tablespaces: the list, Create tablespace, and the tablespace page (properties,
// parameters, privileges, Move objects, contents, drop). Scratch tablespace srv_ts (renamed
// srv_ts2) in ~/.cache/phppgadmin-docs/srv_ts, scratch table public.srv_ts_tbl in bookshop,
// scratch role srv_role_ts.
//   node docs/scripts/captures/server-tablespaces.mjs

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, notice, clearNotice, confirm, openRetry, shotEl, onlyRows } from './server-lib.mjs'

const DIR = path.join(os.homedir(), '.cache/phppgadmin-docs/srv_ts')
const DEMO = /^(pg_default|pg_global|srv_ts.*)$/

function cleanup() {
  psqlTry('DROP TABLE IF EXISTS public.srv_ts_tbl')
  psqlTry('DROP TABLESPACE IF EXISTS srv_ts')
  psqlTry('DROP TABLESPACE IF EXISTS srv_ts2')
  psqlTry('DROP ROLE IF EXISTS srv_role_ts')
  fs.rmSync(DIR, { recursive: true, force: true })
}
cleanup()
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
psql('CREATE ROLE srv_role_ts NOLOGIN')

const preview = async (page, button) => {
  await page.click(button)
  const modal = page.locator('.modal-content').last()
  await modal.locator('pre, code').first().waitFor({ timeout: 8000 }).catch(() => {})
  await settle(page, 300)
  const text = (await modal.locator('.modal-body').innerText()).trim()
  await modal.locator('.btn-close').click()
  return text
}

// ---- List and create
{
  const { page, close } = await openRetry('/server/tablespaces')
  await page.locator('#tablespacesForm').waitFor()
  await onlyRows(page, '#tablespacesForm', DEMO)
  await shot(page, 'server/tablespaces-list.png', { selector: '.container-fluid' })
  console.log('pg_default / pg_global checkboxes disabled:', await page.locator('#tablespacesForm tbody input[type=checkbox]:disabled').count())

  // A directory that does not exist.
  await page.fill('#text_create_tablespace', 'srv_ts')
  await page.fill('#text_create_location', DIR + '_missing')
  await page.click('#create_tablespace_form #buttonGo')
  console.log('missing directory:', await notice(page))
  await clearNotice(page)
  // A relative path.
  await page.fill('#text_create_location', 'relative/dir')
  await page.click('#create_tablespace_form #buttonGo')
  console.log('relative directory:', await notice(page))
  await clearNotice(page)

  await page.fill('#text_create_location', DIR)
  await page.locator('#create_tablespace_form select').selectOption('bookshop_staff')
  console.log('create preview:', await preview(page, '#create_tablespace_form input.preview_sql'))
  await shot(page, 'server/tablespaces-create.png', { selector: '#create_tablespace_form', pad: 16 })
  await page.click('#create_tablespace_form #buttonGo')
  console.log('create:', await notice(page))
  console.log('catalog:', psql("SELECT spcname, pg_get_userbyid(spcowner), pg_tablespace_location(oid) FROM pg_tablespace WHERE spcname = 'srv_ts'"))
  await clearNotice(page)

  // Export.
  await page.locator('#tablespacesForm tbody tr', { hasText: 'srv_ts' }).locator('a[href="#export"]').click()
  await page.locator('.modal-content').last().getByText('CREATE TABLESPACE').first().waitFor()
  console.log('export:\n', await page.locator('.modal-content .modal-body').last().innerText())
  await page.locator('.modal-content').last().locator('.btn-close').click()
  await close()
}

// ---- The tablespace page
psql('CREATE TABLE public.srv_ts_tbl (id int PRIMARY KEY) TABLESPACE srv_ts; INSERT INTO public.srv_ts_tbl SELECT generate_series(1, 1000)')
{
  const { page, close } = await openRetry('/server/tablespaces/srv_ts/edit')
  await page.locator('#tablespace_properties_form').waitFor()
  await settle(page, 400)

  // What is stored in it.
  await page.click('a[href="#contents"]')
  await page.locator('text=srv_ts_tbl').first().waitFor({ timeout: 10000 }).catch(() => {})
  await settle(page, 300)
  const contents = page.locator('.card', { hasText: 'Objects in this tablespace' })
  console.log('contents:', (await contents.innerText()).replace(/\s+/g, ' '))
  await shotEl(page, 'server/tablespaces-edit.png', '.container-fluid')

  // Drop while it holds a table: refused.
  await page.click('#drop_tablespace_anchor')
  console.log('drop dialog:', await confirm(page))
  console.log('drop non-empty:', await notice(page))
  await clearNotice(page)

  // Parameters.
  await page.click('#tablespace_parameters_form input[type=button]')
  const row = page.locator('#tablespace_parameters_form tbody tr').first()
  console.log('parameter names:', (await row.locator('select option').allInnerTexts()).filter(Boolean).join(', '))
  await row.locator('select').selectOption('random_page_cost')
  await row.locator('input[type=number]').fill('1.1')
  console.log('parameters preview:', await preview(page, '#tablespace_parameters_form input.preview_sql'))
  await page.click('#tablespace_parameters_form input[type=submit]')
  console.log('parameters save:', await notice(page))
  await clearNotice(page)
  console.log('spcoptions:', psql("SELECT spcoptions FROM pg_tablespace WHERE spcname = 'srv_ts'"))

  // Privileges: CREATE for srv_role_ts.
  await page.click('#add_user_anchor')
  const dialog = page.locator('.modal-content').last()
  await dialog.locator('#select_grantee').selectOption('srv_role_ts')
  await dialog.locator('#checkbox_CREATE_priv').check()
  await dialog.locator('button.btn-primary').click()
  console.log('grant:', await notice(page))
  await clearNotice(page)
  console.log('spcacl:', psql("SELECT spcacl FROM pg_tablespace WHERE spcname = 'srv_ts'"))

  // Move objects: everything in bookshop from srv_ts to pg_default.
  await page.selectOption('#moveDatabaseSelect', 'bookshop')
  await page.selectOption('#moveTablespaceSelect', 'pg_default')
  await page.check('#move_nowait')
  console.log('move preview:', await preview(page, '#tablespace_move_form input.preview_sql'))
  await shotEl(page, 'server/tablespaces-move.png', '#tablespace_move_form', { pad: 4 })
  await page.click('#tablespace_move_form input[type=submit]')
  console.log('move confirm:', await confirm(page))
  console.log('move:', await notice(page))
  await clearNotice(page)
  console.log('srv_ts_tbl tablespace now:', psql("SELECT coalesce((SELECT spcname FROM pg_tablespace WHERE oid = reltablespace), '(database default)') FROM pg_class WHERE relname IN ('srv_ts_tbl', 'srv_ts_tbl_pkey') ORDER BY relname"))

  // Rename, owner, comment.
  await page.fill('#tablespaceNameInput', 'srv_ts2')
  await page.selectOption('#tablespaceOwnerSelect', 'postgres')
  await page.fill('#tablespaceCommentInput', 'Scratch tablespace for the docs')
  console.log('properties preview:', await preview(page, '#tablespace_properties_form input.preview_sql'))
  await page.click('#tablespace_properties_form input[type=submit]')
  console.log('properties save:', await notice(page))
  await page.waitForURL(/srv_ts2/, { timeout: 8000 }).catch(() => {})
  console.log('url:', new URL(page.url()).pathname, '| catalog:', psql("SELECT spcname, pg_get_userbyid(spcowner), shobj_description(oid, 'pg_tablespace') FROM pg_tablespace WHERE spcname LIKE 'srv_ts%'"))
  await clearNotice(page)

  // Unchanged properties: Go says nothing to change.
  await page.click('#tablespace_properties_form input[type=submit]')
  console.log('nothing to change:', await notice(page))
  await clearNotice(page)

  // Drop now that it is empty.
  await page.click('#drop_tablespace_anchor')
  console.log('drop dialog:', await confirm(page))
  console.log('drop:', await notice(page))
  await page.waitForURL(/\/server\/tablespaces$/, { timeout: 8000 }).catch(() => {})
  console.log('left:', psql("SELECT count(*) FROM pg_tablespace WHERE spcname LIKE 'srv_ts%'"))
  await close()
}

// ---- pg_default's page: no drop card, contents of the default tablespace.
{
  const { page, close } = await openRetry('/server/tablespaces/pg_default/edit')
  await page.locator('#tablespace_properties_form').waitFor()
  console.log('pg_default drop card:', await page.locator('#drop_tablespace_anchor').count())
  await close()
}

cleanup()
await done()
