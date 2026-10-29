// Foreign data: wrappers, servers and user mappings on the database's Objects tab, and the schema's
// Foreign tables tab. Worked example on the scratch database dbo_scratch: postgres_fdw, a server
// pointing back at bookshop on the docs cluster, a user mapping, a foreign table over
// public.authors, then Browse. Captures the screenshots for docs/database/foreign-data.md and
// drops dbo_scratch at the end.
//   node docs/scripts/captures/database-foreign.mjs
import { open, shot, done, settle, APP } from '../capture.mjs'
import { psql, message, clearMessage, previewText, closeModal, check, openRetry, shotEl } from './database-lib.mjs'

const DB = 'dbo_scratch'
if (psql(`SELECT count(*) FROM pg_database WHERE datname = '${DB}'`) === '0') psql(`CREATE DATABASE ${DB}`)
const q = (sql) => psql(sql, DB)
const cleanup = () => q(`DROP EXTENSION IF EXISTS postgres_fdw CASCADE; DROP FOREIGN DATA WRAPPER IF EXISTS dbo_fdw CASCADE; DROP FOREIGN DATA WRAPPER IF EXISTS dbo_fdw2 CASCADE`)
cleanup()

const { page, close } = await openRetry(open, `/db/${DB}/objects`)
const goto = async (route) => { await page.goto(APP + route); await settle(page) }
const f = (kind, key) => `#${kind}Dialog_${key}`
const dialog = (kind) => `#${kind}Dialog`
const add = async (section) => { await page.click(`#${section}_section .add_anchor`); await page.waitForTimeout(800) }
const rowAction = async (section, name, action) => {
  await page.locator(`#${section}Table tr`, { has: page.locator('strong', { hasText: name }) }).first().locator(`.${action}_anchor`).click()
  await page.waitForTimeout(800)
}
async function closeDialog(kind) { await page.locator(`${dialog(kind)} .modal-footer button`, { hasText: 'Close' }).click(); await page.waitForTimeout(300) }
const saveDialog = async (kind) => {
  await page.click(`${dialog(kind)} .modal-footer .btn-primary`)
  const m = await message(page, 15000); await clearMessage(page); await settle(page)
  if (await page.locator(`${dialog(kind)}.show`).count()) await closeDialog(kind)
  return m
}
const previewDialog = async (kind) => { await page.locator(`${dialog(kind)} .modal-footer button`, { hasText: 'Preview SQL' }).click(); const t = await previewText(page); await closeModal(page); return t }
/** Fills the options grid of a dialog field with [option, value] pairs (adding rows as needed). */
const fillOptions = async (sel, pairs) => {
  for (let i = 0; i < pairs.length; i++) {
    if (!(await page.locator(`[name="${sel.slice(1)}_option_${i}"]`).count())) await page.click(`${sel}_add`)
    await page.fill(`[name="${sel.slice(1)}_option_${i}"]`, pairs[i][0])
    await page.fill(`[name="${sel.slice(1)}_value_${i}"]`, pairs[i][1])
  }
}
const drop = async (section, name, cascade = false) => {
  await rowAction(section, name, 'drop')
  if (cascade) await page.check('#confirm_cascade')
  const text = (await page.locator('#confirm_dialog .modal-body').innerText()).replace(/\n+/g, ' | ')
  await page.click('#confirm_dialog .submitOK')
  const m = await message(page, 15000); await clearMessage(page); await settle(page)
  return `${text} => ${m}`
}

// Add server / mapping with nothing to put them under
await add('foreign_servers')
console.log('server without wrapper:', await message(page)); await clearMessage(page)
await add('user_mappings')
console.log('mapping without server:', await message(page)); await clearMessage(page)

// ---------- A wrapper of our own (no handler: it can hold servers but not be queried)
await add('foreign_data_wrappers')
console.log('fdw handlers:', await page.locator(`${f('foreign_data_wrapper', 'fdwhan')} option`).allInnerTexts(), 'validators:', await page.locator(`${f('foreign_data_wrapper', 'fdwvalue')} option`).allInnerTexts())
await page.fill(f('foreign_data_wrapper', 'name'), 'dbo_fdw')
await fillOptions(f('foreign_data_wrapper', 'fdwoptions'), [['debug', 'true']])
await page.fill(f('foreign_data_wrapper', 'description'), 'A wrapper with no handler')
await shot(page, 'database/fdw-dialog.png', { selector: `${dialog('foreign_data_wrapper')} .modal-content` })
console.log('fdw preview:', await previewDialog('foreign_data_wrapper'))
console.log('fdw add:', await saveDialog('foreign_data_wrapper'), q(`SELECT fdwoptions, fdwhandler FROM pg_foreign_data_wrapper WHERE fdwname='dbo_fdw'`))
await rowAction('foreign_data_wrappers', 'dbo_fdw', 'edit')
await page.fill(f('foreign_data_wrapper', 'name'), 'dbo_fdw2')
await page.fill(`[name="${f('foreign_data_wrapper', 'fdwoptions').slice(1)}_value_0"]`, 'false')
await fillOptions(f('foreign_data_wrapper', 'fdwoptions'), [['debug', 'false'], ['level', '2']])
await page.selectOption(f('foreign_data_wrapper', 'fdwowner'), 'postgres')
console.log('fdw edit preview:', await previewDialog('foreign_data_wrapper'))
console.log('fdw edit:', await saveDialog('foreign_data_wrapper'), q(`SELECT fdwname, fdwoptions FROM pg_foreign_data_wrapper WHERE fdwname LIKE 'dbo_fdw%'`))
await rowAction('foreign_data_wrappers', 'dbo_fdw2', 'edit')
await page.locator(`${dialog('foreign_data_wrapper')} button`, { hasText: 'Remove' }).first().click()
console.log('fdw remove option preview:', await previewDialog('foreign_data_wrapper'))
console.log('fdw remove option:', await saveDialog('foreign_data_wrapper'), q(`SELECT fdwoptions FROM pg_foreign_data_wrapper WHERE fdwname='dbo_fdw2'`))
// Duplicate option name
await rowAction('foreign_data_wrappers', 'dbo_fdw2', 'edit')
await fillOptions(f('foreign_data_wrapper', 'fdwoptions'), [['level', '2'], ['level', '3']])
console.log('duplicate option:', await saveDialog('foreign_data_wrapper'))
// Export
await rowAction('foreign_data_wrappers', 'dbo_fdw2', 'export')
await page.waitForTimeout(800)
console.log('fdw export:', await page.locator('.modal.show .modal-body').innerText())
await closeModal(page)
console.log('drop fdw:', await drop('foreign_data_wrappers', 'dbo_fdw2'))

// ---------- postgres_fdw through the extension dialog
await add('extensions')
await page.selectOption(f('extension', 'name'), 'postgres_fdw')
console.log('postgres_fdw:', await saveDialog('extension'))
await shotEl(page, 'database/fdw-list.png', '#foreign_data_wrappers_section')

// ---------- Foreign server
await add('foreign_servers')
console.log('server wrappers:', await page.locator(`${f('foreign_server', 'fid')} option`).allInnerTexts())
await page.fill(f('foreign_server', 'name'), 'dbo_bookshop')
await page.fill(f('foreign_server', 'fsrvtype'), 'postgresql')
await page.fill(f('foreign_server', 'fsrvversion'), '18')
await fillOptions(f('foreign_server', 'fsrvoptions'), [['host', 'localhost'], ['port', '5499'], ['dbname', 'bookshop']])
await page.fill(f('foreign_server', 'description'), 'The bookshop demo database, through postgres_fdw')
await shot(page, 'database/server-dialog.png', { selector: `${dialog('foreign_server')} .modal-content` })
console.log('server preview:', await previewDialog('foreign_server'))
console.log('server add:', await saveDialog('foreign_server'), q(`SELECT srvtype, srvversion, srvoptions FROM pg_foreign_server WHERE srvname='dbo_bookshop'`))
// a bad option the validator rejects
await rowAction('foreign_servers', 'dbo_bookshop', 'edit')
await fillOptions(f('foreign_server', 'fsrvoptions'), [['host', 'localhost'], ['port', '5499'], ['dbname', 'bookshop'], ['nonsense', 'x']])
const badStatus = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/foreign_servers/'))
console.log('server bad option:', await saveDialog('foreign_server'))
check('a rejected option is a 400, not a 500', (await badStatus).status() === 400)

// ---------- User mapping
await add('user_mappings')
console.log('mapping users:', (await page.locator(`${f('user_mapping', 'name')} option`).allInnerTexts()).join(', '))
await page.selectOption(f('user_mapping', 'name'), 'postgres')
await fillOptions(f('user_mapping', 'umoptions'), [['user', 'postgres'], ['password', 's3cret-docs']])
await shot(page, 'database/user-mapping-dialog.png', { selector: `${dialog('user_mapping')} .modal-content` })
console.log('mapping preview:', await previewDialog('user_mapping'))
console.log('mapping add:', await saveDialog('user_mapping'), q(`SELECT umoptions FROM pg_user_mappings WHERE srvname='dbo_bookshop'`))
await shotEl(page, 'database/user-mappings.png', '#user_mappings_section')
console.log('mapping row:', await page.locator('#user_mappingsTable tbody tr').first().innerText())
await rowAction('user_mappings', 'postgres', 'edit')
const pwField = page.locator(`[name="${f('user_mapping', 'umoptions').slice(1)}_value_1"]`)
check('the Edit dialog gets the password masked, in a password field', (await pwField.inputValue()) === 'xxxxxx' && (await pwField.getAttribute('type')) === 'password')
// Saving with the dummy left in place keeps the stored password
await page.fill(`[name="${f('user_mapping', 'umoptions').slice(1)}_value_0"]`, 'postgres2')
console.log('mapping edit user preview:', await previewDialog('user_mapping'))
console.log('mapping edit user:', await saveDialog('user_mapping'))
check('the stored password is kept', q(`SELECT umoptions FROM pg_user_mappings WHERE srvname='dbo_bookshop'`) === '{user=postgres2,password=s3cret-docs}')
await rowAction('user_mappings', 'postgres', 'export')
await page.waitForTimeout(800)
check('Export masks the password', (await page.locator('.modal.show .modal-body').innerText()).includes("password 'xxxxxx'"))
await closeModal(page)
await rowAction('user_mappings', 'postgres', 'edit')
await page.fill(`[name="${f('user_mapping', 'umoptions').slice(1)}_value_0"]`, 'postgres')
await page.locator(`${dialog('user_mapping')} button`, { hasText: 'Remove' }).nth(1).click()
console.log('mapping remove password preview:', await previewDialog('user_mapping'))
console.log('mapping remove password:', await saveDialog('user_mapping'), q(`SELECT umoptions FROM pg_user_mappings WHERE srvname='dbo_bookshop'`))
await rowAction('user_mappings', 'postgres', 'export')
await page.waitForTimeout(800)
console.log('mapping export:', await page.locator('.modal.show .modal-body').innerText())
await closeModal(page)
// A PUBLIC mapping too, for the list
await add('user_mappings')
await page.selectOption(f('user_mapping', 'name'), 'PUBLIC')
console.log('public mapping:', await saveDialog('user_mapping'), q(`SELECT string_agg(usename, ',') FROM pg_user_mappings`))
console.log('drop public mapping:', await drop('user_mappings', 'PUBLIC'))

// Changing the server type recreates it: fails while the mapping uses it
await rowAction('foreign_servers', 'dbo_bookshop', 'edit')
await page.fill(f('foreign_server', 'fsrvtype'), 'pg')
console.log('server type preview:', await previewDialog('foreign_server'))
console.log('server type change:', await saveDialog('foreign_server'))
await rowAction('foreign_servers', 'dbo_bookshop', 'edit')
await page.fill(f('foreign_server', 'fsrvversion'), '18.0')
console.log('server version preview:', await previewDialog('foreign_server'))
console.log('server version:', await saveDialog('foreign_server'))
check('18 -> 18.0 is a change', q(`SELECT srvversion FROM pg_foreign_server WHERE srvname='dbo_bookshop'`) === '18.0')

// ---------- Foreign tables tab (schema public of dbo_scratch)
await goto(`/db/${DB}/schema/public/foreign-tables`)
await page.click('#foreign_tables_section .add_anchor')
await page.waitForTimeout(800)
const ft = (k) => `#foreign_tableDialog_${k}`
await page.fill(ft('name'), 'dbo_authors')
await fillOptions(ft('ftoptions'), [['schema_name', 'public'], ['table_name', 'authors']])
const cols = [['id', 'integer', true], ['name', 'text', true], ['born', 'date', false], ['country', 'character(2)', false]]
for (let i = 0; i < cols.length; i++) {
  await page.click(`${ft('columns')}_add`)
  await page.fill(`[name="foreign_tableDialog_columns_name_${i}"]`, cols[i][0])
  await page.fill(`[name="foreign_tableDialog_columns_type_${i}"]`, cols[i][1])
  if (cols[i][2]) await page.check(`[name="foreign_tableDialog_columns_notnull_${i}"]`)
}
await page.fill(ft('description'), 'public.authors in bookshop')
await shotEl(page, 'database/foreign-table-dialog.png', '#foreign_tableDialog .modal-content')
console.log('ft preview:', await previewDialog('foreign_table'))
console.log('ft add:', await saveDialog('foreign_table'))
await shotEl(page, 'database/foreign-tables.png', '#foreign_tables_section')

// Browse
await page.locator('#foreign_tablesTable a', { hasText: 'Browse' }).first().click()
await settle(page, 2000)
console.log('browse url:', page.url())
await shot(page, 'database/foreign-table-browse.png')

// Column ALTERs: rename, type, default, column option, add, drop
await goto(`/db/${DB}/schema/public/foreign-tables`)
await page.locator('#foreign_tablesTable .edit_anchor').first().click()
await page.waitForTimeout(800)
await page.fill('[name="foreign_tableDialog_columns_name_3"]', 'country_code')
await fillOptions('#foreign_tableDialog_columns_options_3', [['column_name', 'country']])
await page.fill('[name="foreign_tableDialog_columns_type_2"]', 'text')
await page.fill('[name="foreign_tableDialog_columns_default_2"]', "'unknown'")
await page.uncheck('[name="foreign_tableDialog_columns_notnull_1"]')
await page.click(`${ft('columns')}_add`)
await page.fill('[name="foreign_tableDialog_columns_name_4"]', 'bio')
await page.fill('[name="foreign_tableDialog_columns_type_4"]', 'text')
await page.locator('#foreign_tableDialog_columns tr', { has: page.locator('[name="foreign_tableDialog_columns_name_0"]') }).locator('button', { hasText: 'Remove' }).last().click()
await page.fill(ft('name'), 'dbo_authors2')
await page.selectOption(ft('owner'), 'bookshop_staff')
console.log('ft alter preview:', await previewDialog('foreign_table'))
console.log('ft alter:', await saveDialog('foreign_table'))
console.log('ft catalog:', q(`SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull || ':' || coalesce(array_to_string(attfdwoptions, ';'), ''), ', ' ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.dbo_authors2'::regclass AND attnum > 0 AND NOT attisdropped`))
console.log('ft rows:', q(`SELECT count(*), min(country_code) FROM public.dbo_authors2`))
await page.locator('#foreign_tablesTable .export_anchor').first().click()
await page.waitForTimeout(800)
console.log('ft export:', await page.locator('.modal.show .modal-body').innerText())
await closeModal(page)

// The table's Privileges? There is no tab on a foreign table: check for its route
await goto(`/db/${DB}/schema/public/foreign-tables`)
console.log('ft tree link targets:', await page.locator('#pma_navigation a', { hasText: 'dbo_authors2' }).evaluateAll((as) => as.map((a) => a.getAttribute('href'))))

// Drop the server: without CASCADE fails (mapping, table), with CASCADE drops them
await goto(`/db/${DB}/objects`)
console.log('drop server:', await drop('foreign_servers', 'dbo_bookshop'))
console.log('drop server cascade:', await drop('foreign_servers', 'dbo_bookshop', true), q(`SELECT count(*) FROM pg_foreign_table`), q(`SELECT count(*) FROM pg_user_mappings`))

await close()
await done()
cleanup()
psql('DROP DATABASE IF EXISTS dbo_scratch WITH (FORCE)')
