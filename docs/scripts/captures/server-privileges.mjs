// The Privileges tab at database, schema and relation level: grantees, column privileges,
// default privileges and the grant wizard. Scratch schema srv_priv_schema in bookshop (table
// srv_priv_tbl, view srv_priv_view, sequence srv_priv_seq, function srv_priv_fn), scratch roles
// srv_priv_reader / srv_priv_writer.
//   node docs/scripts/captures/server-privileges.mjs

import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, notice, clearNotice, confirm, openRetry, shotEl } from './server-lib.mjs'

function cleanup() {
  psqlTry('DROP SCHEMA IF EXISTS srv_priv_schema CASCADE')
  for (const r of ['srv_priv_reader', 'srv_priv_writer']) {
    psqlTry(`DROP OWNED BY ${r}`)
    psqlTry(`DROP OWNED BY ${r}`, 'postgres')
    psqlTry(`DROP ROLE IF EXISTS ${r}`)
  }
}
cleanup()
psql('CREATE ROLE srv_priv_reader NOLOGIN; CREATE ROLE srv_priv_writer NOLOGIN')
psql(`CREATE SCHEMA srv_priv_schema;
  CREATE TABLE srv_priv_schema.srv_priv_tbl (id int PRIMARY KEY, name text, secret text);
  CREATE VIEW srv_priv_schema.srv_priv_view AS SELECT id, name FROM srv_priv_schema.srv_priv_tbl;
  CREATE SEQUENCE srv_priv_schema.srv_priv_seq;
  CREATE FUNCTION srv_priv_schema.srv_priv_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';`)

const acl = (sql) => psql(sql)
const dialog = (page) => page.locator('.modal-content').last()
async function previewDialog(page) {
  await dialog(page).locator('.modal-footer button.preview_sql').click()
  const box = page.locator('.modal-content').last()
  await box.locator('pre, code').first().waitFor({ timeout: 8000 }).catch(() => {})
  await settle(page, 300)
  const text = (await box.locator('.modal-body').innerText()).trim()
  await box.locator('.btn-close').click()
  return text
}
const go = (page) => dialog(page).locator('.modal-footer button.btn-primary').click()
const rowOf = (page, scope, grantee) => page.locator(`${scope} tbody tr`).filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${grantee}( \\(owner\\))?$`) }) })

// ---- Database level
{
  const { page, close } = await openRetry('/db/bookshop/privileges')
  await page.locator('#usersForm').waitFor()
  await settle(page, 500)
  console.log('bookshop grantees:', (await page.locator('#usersForm tbody').innerText()).replace(/\t/g, ' ').replace(/\n/g, ' / '))
  await page.click('#add_user_anchor')
  await dialog(page).locator('#select_grantee').selectOption('srv_priv_reader')
  console.log('database privileges offered:', (await dialog(page).locator('dfn').allInnerTexts()).join(', '))
  await dialog(page).locator('#checkbox_CONNECT_priv').check()
  await dialog(page).locator('#checkbox_TEMPORARY_grant').check()
  await shot(page, 'server/privileges-dialog.png', { selector: '.modal-content' })
  console.log('grant preview:', await previewDialog(page))
  await go(page)
  console.log('grant:', await notice(page))
  await clearNotice(page)
  console.log('datacl:', acl("SELECT array_to_string(datacl, ' ') FROM pg_database WHERE datname = 'bookshop'"))
  await shotEl(page, 'server/privileges-database.png', '.container-fluid')

  // Edit: drop CONNECT; Revoke.
  await rowOf(page, '#usersForm', 'srv_priv_reader').locator('a.edit_user_anchor').click()
  await dialog(page).locator('#checkbox_CONNECT_priv').uncheck()
  console.log('edit preview:', await previewDialog(page))
  await go(page)
  console.log('edit:', await notice(page))
  await clearNotice(page)
  await rowOf(page, '#usersForm', 'srv_priv_reader').locator('a[href="#revoke"]').click()
  console.log('revoke:', await confirm(page))
  console.log('revoke:', await notice(page))
  await clearNotice(page)
  console.log('datacl after revoke:', acl("SELECT array_to_string(datacl, ' ') FROM pg_database WHERE datname = 'bookshop'"))

  // Default privileges, database-wide, for tables srv_priv_writer creates.
  const defaults = '#fieldset_default_privileges'
  console.log('defaults rows before:', (await page.locator(`${defaults} tbody`).innerText()).replace(/\s+/g, ' '))
  await page.click(`${defaults} a[href="#add-default"]`)
  await dialog(page).locator('#select_default_role').selectOption('srv_priv_writer')
  console.log('default object kinds:', (await dialog(page).locator('#select_default_objtype option').allInnerTexts()).join(', '))
  await dialog(page).locator('#select_default_objtype').selectOption('r')
  await dialog(page).locator('#select_grantee').selectOption('srv_priv_reader')
  await dialog(page).locator('#checkbox_SELECT_priv').check()
  console.log('default preview:', await previewDialog(page))
  await go(page)
  console.log('default:', await notice(page))
  await clearNotice(page)
  console.log('pg_default_acl:', acl("SELECT pg_get_userbyid(defaclrole) || ' ' || defaclobjtype::text || ' ' || coalesce(defaclnamespace::regnamespace::text, '-') || ' ' || array_to_string(defaclacl, ' ') FROM pg_default_acl WHERE defaclrole = 'srv_priv_writer'::regrole"))
  await shotEl(page, 'server/privileges-defaults.png', defaults)
  // The default takes effect for a table srv_priv_writer creates.
  psql('GRANT CREATE ON SCHEMA srv_priv_schema TO srv_priv_writer; SET ROLE srv_priv_writer; CREATE TABLE srv_priv_schema.srv_priv_by_writer (id int); RESET ROLE')
  console.log('new table acl:', acl("SELECT array_to_string(relacl, ' ') FROM pg_class WHERE relname = 'srv_priv_by_writer'"))
  await page.locator(`${defaults} tbody tr`, { hasText: 'srv_priv_reader' }).locator('a[href="#revoke"]').click()
  console.log('default revoke:', await confirm(page))
  console.log('default revoke:', await notice(page))
  console.log('pg_default_acl left:', acl("SELECT count(*) FROM pg_default_acl WHERE defaclrole = 'srv_priv_writer'::regrole"))
  await close()
}

// ---- Schema level: USAGE, schema defaults, grant wizard.
{
  const { page, close } = await openRetry('/db/bookshop/schema/srv_priv_schema/privileges')
  await page.locator('#usersForm').waitFor()
  await settle(page, 500)
  await page.click('#add_user_anchor')
  await dialog(page).locator('#select_grantee').selectOption('srv_priv_reader')
  console.log('schema privileges offered:', (await dialog(page).locator('dfn').allInnerTexts()).join(', '))
  await dialog(page).locator('#checkbox_USAGE_priv').check()
  await go(page)
  console.log('schema grant:', await notice(page))
  await clearNotice(page)
  console.log('nspacl:', acl("SELECT array_to_string(nspacl, ' ') FROM pg_namespace WHERE nspname = 'srv_priv_schema'"))
  console.log('schema default kinds:', await page.locator('#fieldset_default_privileges legend').innerText())

  // Grant wizard.
  const wizard = '#grantWizardForm'
  console.log('wizard objects:', (await page.locator(`${wizard} tbody tr`).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' | '))
  await page.locator(`${wizard} input[type=text]`).fill('srv_priv_')
  await page.check('#checkall_wizard_objects')
  console.log('privileges offered for all:', (await page.locator(`${wizard} dfn`).allInnerTexts()).join(', '))
  await page.selectOption('#select_wizard_grantee', 'srv_priv_reader')
  await page.check('#wizard_priv_SELECT')
  await page.check('#wizard_priv_EXECUTE')
  await page.check('#wizard_priv_USAGE')
  await shotEl(page, 'server/privileges-wizard.png', wizard)
  await page.click(`${wizard} input.preview_sql`)
  const box = page.locator('.modal-content').last()
  await box.locator('pre, code').first().waitFor()
  await settle(page, 300)
  console.log('wizard preview:\n', await box.locator('.modal-body').innerText())
  await box.locator('.btn-close').click()
  await page.click(`${wizard} input[type=submit]`)
  console.log('wizard confirm:', (await confirm(page)).slice(0, 200))
  console.log('wizard:', await notice(page))
  await clearNotice(page)
  console.log('acls:', acl("SELECT string_agg(relname || ' ' || array_to_string(relacl, ' '), ' | ' ORDER BY relname) FROM pg_class WHERE relnamespace = 'srv_priv_schema'::regnamespace AND relkind IN ('r','v','S')"), '| fn:', acl("SELECT array_to_string(proacl, ' ') FROM pg_proc WHERE proname = 'srv_priv_fn'"))
  // The wizard with no role.
  await page.check('#checkall_wizard_objects')
  await page.selectOption('#select_wizard_grantee', '')
  await page.click(`${wizard} input[type=submit]`)
  console.log('wizard no role:', await notice(page))
  await close()
}

// ---- Relation level: table grants and column privileges.
{
  const { page, close } = await openRetry('/db/bookshop/schema/srv_priv_schema/table/srv_priv_tbl/privileges')
  await page.locator('#usersForm').waitFor()
  await settle(page, 500)
  console.log('default privileges / wizard on a table page:', await page.locator('#fieldset_default_privileges').count(), await page.locator('#grantWizardForm').count())
  await page.click('#add_user_anchor')
  await dialog(page).locator('#select_grantee').selectOption('srv_priv_writer')
  console.log('table privileges offered:', (await dialog(page).locator('dfn').allInnerTexts()).join(', '))
  await dialog(page).locator('#checkbox_INSERT_priv').check()
  await dialog(page).locator('#checkbox_SELECT_priv').check()
  await go(page)
  console.log('table grant:', await notice(page))
  await clearNotice(page)

  // Choosing a role that already holds privileges starts from them.
  await page.click('#add_user_anchor')
  await dialog(page).locator('#select_grantee').selectOption('srv_priv_writer')
  console.log('preloaded for existing grantee:', await dialog(page).locator('#checkbox_INSERT_priv').isChecked())
  await dialog(page).locator('.btn-close').click()

  // Column privileges: UPDATE (name) for srv_priv_reader.
  await page.click('a[href="#add-column"]')
  await dialog(page).locator('#select_column').selectOption('name')
  await dialog(page).locator('#select_grantee').selectOption('srv_priv_reader')
  console.log('column privileges offered:', (await dialog(page).locator('dfn').allInnerTexts()).join(', '))
  await dialog(page).locator('#checkbox_UPDATE_priv').check()
  await dialog(page).locator('#checkbox_SELECT_priv').check()
  console.log('column preview:', await previewDialog(page))
  await go(page)
  console.log('column grant:', await notice(page))
  await clearNotice(page)
  console.log('attacl:', acl("SELECT string_agg(attname || ' ' || array_to_string(attacl, ' '), ' | ') FROM pg_attribute WHERE attrelid = 'srv_priv_schema.srv_priv_tbl'::regclass AND attacl IS NOT NULL"))
  await shotEl(page, 'server/privileges-table.png', '.container-fluid')

  // PUBLIC, then revoke the column privilege.
  await page.click('#add_user_anchor')
  await dialog(page).locator('#select_grantee').selectOption('PUBLIC')
  await dialog(page).locator('#checkbox_SELECT_priv').check()
  console.log('public preview:', await previewDialog(page))
  await dialog(page).locator('.btn-close').click()
  await page.locator('#usersForm tbody tr', { hasText: 'Column: name' }).locator('a[href="#revoke"]').click()
  console.log('column revoke:', await confirm(page))
  console.log('column revoke:', await notice(page))
  await close()
}

// ---- A view's Privileges tab.
{
  const { page, close } = await openRetry('/db/bookshop/schema/srv_priv_schema/view/srv_priv_view/privileges')
  await page.locator('#usersForm').waitFor()
  await settle(page, 400)
  console.log('view grantees:', (await page.locator('#usersForm tbody').innerText()).replace(/\s+/g, ' '))
  await close()
}

cleanup()
console.log('leftovers:', psql("SELECT (SELECT count(*) FROM pg_roles WHERE rolname LIKE 'srv_priv_%') || ' roles, ' || (SELECT count(*) FROM pg_namespace WHERE nspname = 'srv_priv_schema') || ' schema, bookshop datacl: ' || coalesce((SELECT array_to_string(datacl, ' ') FROM pg_database WHERE datname = 'bookshop'), '-')"))
await done()
