// Database Objects tab (extensions, languages, casts, event triggers): verifies each dialog on the
// scratch database dbo_scratch and captures the screenshots for docs/database/objects.md.
// Creates dbo_scratch if needed and drops it at the end.
//   node docs/scripts/captures/database-objects.mjs
import { open, shot, done, settle, APP } from '../capture.mjs'
import { psql, message, clearMessage, previewText, closeModal, check, openRetry, shotEl } from './database-lib.mjs'

const DB = 'dbo_scratch'
if (psql(`SELECT count(*) FROM pg_database WHERE datname = '${DB}'`) === '0') psql(`CREATE DATABASE ${DB}`)
const q = (sql) => psql(sql, DB)
q(`DROP EVENT TRIGGER IF EXISTS dbo_et; DROP EVENT TRIGGER IF EXISTS dbo_et2;
   DROP EXTENSION IF EXISTS hstore CASCADE; DROP EXTENSION IF EXISTS pg_trgm CASCADE; DROP EXTENSION IF EXISTS earthdistance CASCADE; DROP EXTENSION IF EXISTS cube CASCADE; DROP EXTENSION IF EXISTS plperl CASCADE;
   DROP LANGUAGE IF EXISTS dbo_lang CASCADE; DROP LANGUAGE IF EXISTS dbo_lang2 CASCADE;
   DROP SCHEMA IF EXISTS dbo_ext CASCADE; DROP TYPE IF EXISTS dbo_pair CASCADE; DROP TABLE IF EXISTS dbo_kv; DROP TABLE IF EXISTS dbo_et_log;
   DROP FUNCTION IF EXISTS dbo_et_fn() CASCADE`)
q(`CREATE SCHEMA dbo_ext;
   CREATE TYPE dbo_pair AS (a int, b int);
   CREATE FUNCTION dbo_text_to_pair(text) RETURNS dbo_pair LANGUAGE sql IMMUTABLE AS $$ SELECT split_part($1, ',', 1)::int, split_part($1, ',', 2)::int $$;
   CREATE TABLE dbo_et_log (tag text, at timestamptz DEFAULT now());
   CREATE FUNCTION dbo_et_fn() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO dbo_et_log(tag) VALUES (tg_tag); END $$`)

const { page, close } = await openRetry(open, `/db/${DB}/objects`)
const goto = async (route) => { await page.goto(APP + route); await settle(page) }
const f = (kind, key) => `#${kind}Dialog_${key}`
const dialog = (kind) => `#${kind}Dialog`
const add = async (section) => { await page.click(`#${section}_section .add_anchor`); await page.waitForTimeout(800) }
const rowAction = async (section, name, action) => {
  await page.locator(`#${section}Table tr`, { has: page.locator('strong', { hasText: name }) }).first().locator(`.${action}_anchor`).click()
  await page.waitForTimeout(800)
}
const saveDialog = async (kind) => {
  await page.click(`${dialog(kind)} .modal-footer .btn-primary`)
  const m = await message(page, 15000); await clearMessage(page); await settle(page)
  if (await page.locator(`${dialog(kind)}.show`).count()) await closeDialog(kind)
  return m
}
const previewDialog = async (kind) => { await page.locator(`${dialog(kind)} .modal-footer button`, { hasText: 'Preview SQL' }).click(); const t = await previewText(page); await closeModal(page); return t }
async function closeDialog(kind) { await page.locator(`${dialog(kind)} .modal-footer button`, { hasText: 'Close' }).click(); await page.waitForTimeout(300) }
const drop = async (section, name, cascade = false) => {
  await rowAction(section, name, 'drop')
  if (cascade) await page.check('#confirm_cascade')
  const text = (await page.locator('#confirm_dialog .modal-body').innerText()).replace(/\n+/g, ' | ')
  await page.click('#confirm_dialog .submitOK')
  const m = await message(page, 15000); await clearMessage(page); await settle(page)
  return `${text} => ${m}`
}

await shot(page, 'database/objects.png')

// ---------- Extensions
await add('extensions')
await page.selectOption(f('extension', 'name'), 'hstore')
await page.waitForTimeout(300)
console.log('hstore versions:', await page.locator(`${f('extension', 'version')} option`).allInnerTexts())
console.log('hstore schema hint:', await page.locator(dialog('extension')).locator('.form-text').allInnerTexts())
await page.selectOption(f('extension', 'schema'), 'public')
await shot(page, 'database/extension-dialog.png', { selector: `${dialog('extension')} .modal-content` })
console.log('hstore preview:', await previewDialog('extension'))
console.log('hstore add:', await saveDialog('extension'), q(`SELECT extversion, extnamespace::regnamespace FROM pg_extension WHERE extname='hstore'`))

// pg_trgm at an older version, then update
await add('extensions')
await page.selectOption(f('extension', 'name'), 'pg_trgm')
await page.waitForTimeout(300)
await page.selectOption(f('extension', 'version'), '1.5')
console.log('pg_trgm 1.5:', await saveDialog('extension'), q(`SELECT extversion FROM pg_extension WHERE extname='pg_trgm'`))
await rowAction('extensions', 'pg_trgm', 'edit')
console.log('pg_trgm edit name readonly:', await page.locator(f('extension', 'name')).getAttribute('readonly'), 'versions', await page.locator(`${f('extension', 'version')} option`).allInnerTexts())
await page.selectOption(f('extension', 'version'), '1.6')
await page.selectOption(f('extension', 'schema'), 'dbo_ext')
await shot(page, 'database/extension-edit.png', { selector: `${dialog('extension')} .modal-content` })
console.log('pg_trgm update preview:', await previewDialog('extension'))
console.log('pg_trgm update:', await saveDialog('extension'), q(`SELECT extversion, extnamespace::regnamespace FROM pg_extension WHERE extname='pg_trgm'`))

// CASCADE: earthdistance requires cube
await add('extensions')
await page.selectOption(f('extension', 'name'), 'earthdistance')
console.log('earthdistance no cascade:', await saveDialog('extension'))
await add('extensions')
await page.selectOption(f('extension', 'name'), 'earthdistance')
await page.check(f('extension', 'cascade'))
console.log('earthdistance cascade preview:', await previewDialog('extension'))
console.log('earthdistance cascade:', await saveDialog('extension'), q(`SELECT string_agg(extname, ',') FROM pg_extension`))

// Non-relocatable: plperl (a trusted language packaged as an extension)
await add('extensions')
await page.selectOption(f('extension', 'name'), 'plperl')
await page.waitForTimeout(300)
console.log('plperl hint:', await page.locator(dialog('extension')).locator('.form-text').allInnerTexts())
await page.selectOption(f('extension', 'schema'), 'dbo_ext')
console.log('plperl in dbo_ext:', await saveDialog('extension'))
await add('extensions')
await page.selectOption(f('extension', 'name'), 'plperl')
console.log('plperl default schema:', await saveDialog('extension'), q(`SELECT extnamespace::regnamespace FROM pg_extension WHERE extname='plperl'`))
await rowAction('extensions', 'plperl', 'edit')
console.log('plperl edit schema readonly:', await page.locator(f('extension', 'schema')).evaluate((e) => `${e.tagName} ro=${e.readOnly}`))
await closeDialog('extension')

// Export, drop with dependents
await rowAction('extensions', 'hstore', 'export')
await page.waitForTimeout(800)
console.log('hstore export:', await page.locator('.modal.show .modal-body').innerText())
await closeModal(page)
q(`CREATE TABLE dbo_kv (h public.hstore)`)
await goto(`/db/${DB}/objects`)
console.log('drop hstore:', await drop('extensions', 'hstore'))
console.log('drop hstore cascade:', await drop('extensions', 'hstore', true), q(`SELECT count(*) FROM pg_attribute WHERE attrelid='dbo_kv'::regclass AND attnum > 0 AND NOT attisdropped`))

// Extensions already installed are left out of the Add list
await add('extensions')
const names = await page.locator(`${f('extension', 'name')} option`).allInnerTexts()
console.log('add list has pg_trgm?', names.includes('pg_trgm'), 'has hstore?', names.includes('hstore'), 'count', names.length)
await closeDialog('extension')

// ---------- Languages
await add('languages')
console.log('language handlers:', await page.locator(`${f('language', 'lanproc')} option`).allInnerTexts(), 'inline count:', await page.locator(`${f('language', 'laninl')} option`).count(), 'validator count:', await page.locator(`${f('language', 'lanval')} option`).count())
await page.fill(f('language', 'name'), 'dbo_lang')
await page.check(f('language', 'trusted'))
await page.selectOption(f('language', 'lanproc'), 'language_handler_in')
console.log('language with language_handler_in:', await previewDialog('language'))
await page.click(`${dialog('language')} .modal-footer .btn-primary`)
console.log('  =>', await message(page, 15000)); await clearMessage(page)
await page.selectOption(f('language', 'lanproc'), 'plpgsql_call_handler')
await page.selectOption(f('language', 'laninl'), 'plpgsql_inline_handler')
await page.selectOption(f('language', 'lanval'), 'plpgsql_validator')
await page.fill(f('language', 'description'), 'A scratch language for the docs')
await shot(page, 'database/language-dialog.png', { selector: `${dialog('language')} .modal-content` })
console.log('language preview:', await previewDialog('language'))
console.log('language add:', await saveDialog('language'), q(`SELECT lanpltrusted, lanowner::regrole FROM pg_language WHERE lanname='dbo_lang'`))
await rowAction('languages', 'dbo_lang', 'edit')
await page.fill(f('language', 'name'), 'dbo_lang2')
await page.selectOption(f('language', 'lanowner'), 'bookshop_staff')
console.log('language rename/owner preview:', await previewDialog('language'))
console.log('language rename/owner:', await saveDialog('language'), q(`SELECT lanname, lanowner::regrole FROM pg_language WHERE lanname LIKE 'dbo_lang%'`))
await rowAction('languages', 'dbo_lang2', 'edit')
await page.uncheck(f('language', 'trusted'))
console.log('language untrust preview:', await previewDialog('language'))
console.log('language untrust:', await saveDialog('language'), q(`SELECT lanpltrusted, lanowner::regrole, obj_description(oid,'pg_language') FROM pg_language WHERE lanname='dbo_lang2'`))
console.log('drop language:', await drop('languages', 'dbo_lang2'))

// ---------- Casts
await add('casts')
await page.selectOption(f('cast', 'srctyp'), 'text')
await page.waitForTimeout(500)
await page.selectOption(f('cast', 'trgtyp'), 'dbo_pair')
await page.waitForTimeout(1200)
console.log('cast functions:', await page.locator(`${f('cast', 'proname')} option`).allInnerTexts())
await page.selectOption(f('cast', 'proname'), { index: 1 })
await page.selectOption(f('cast', 'castcontext'), 'ASSIGNMENT')
await page.fill(f('cast', 'description'), 'text "a,b" to dbo_pair')
await shot(page, 'database/cast-dialog.png', { selector: `${dialog('cast')} .modal-content` })
console.log('cast preview:', await previewDialog('cast'))
console.log('cast add:', await saveDialog('cast'), q(`SELECT castcontext FROM pg_cast WHERE castsource='text'::regtype AND casttarget='dbo_pair'::regtype`))
console.log('cast works:', q(`SELECT ('3,4'::text)::dbo_pair`))
await rowAction('casts', 'dbo_pair', 'edit')
console.log('cast edit read-only fields:', await page.locator(`${dialog('cast')} input[readonly]`).count())
await page.fill(f('cast', 'description'), 'Changed comment')
console.log('cast edit preview:', await previewDialog('cast'))
console.log('cast edit:', await saveDialog('cast'))
// binary compatible
await add('casts')
await page.selectOption(f('cast', 'srctyp'), 'dbo_pair')
await page.waitForTimeout(500)
await page.selectOption(f('cast', 'trgtyp'), 'text')
await page.waitForTimeout(800)
console.log('binary cast preview:', await previewDialog('cast'))
console.log('binary cast add:', await saveDialog('cast'))
await goto(`/db/${DB}/objects`)
console.log('cast rows:', await page.locator('#castsTable tbody tr').allInnerTexts())
console.log('drop cast:', await drop('casts', 'text AS dbo_pair'))

// ---------- Event triggers
await add('event_triggers')
console.log('events:', await page.locator(`${f('event_trigger', 'eventname')} option`).allInnerTexts(), 'functions:', await page.locator(`${f('event_trigger', 'eventfunname')} option`).allInnerTexts())
await page.fill(f('event_trigger', 'name'), 'dbo_et')
await page.selectOption(f('event_trigger', 'eventname'), 'DDL_COMMAND_END')
await page.selectOption(f('event_trigger', 'eventfunname'), { index: 1 })
await page.fill(f('event_trigger', 'when'), 'CREATE TABLE, DROP TABLE')
await page.fill(f('event_trigger', 'comment'), 'Logs table DDL')
await shot(page, 'database/event-trigger-dialog.png', { selector: `${dialog('event_trigger')} .modal-content` })
console.log('et preview:', await previewDialog('event_trigger'))
console.log('et add:', await saveDialog('event_trigger'), q(`SELECT evtevent, evtenabled, evttags FROM pg_event_trigger WHERE evtname='dbo_et'`))
q(`CREATE TABLE dbo_fires (id int); DROP TABLE dbo_fires`)
console.log('et fired:', q(`SELECT string_agg(tag, ',') FROM dbo_et_log`))
for (const state of ['D', 'R', 'A', 'O']) {
  await rowAction('event_triggers', 'dbo_et', 'edit')
  await page.selectOption(f('event_trigger', 'enabled'), state)
  const sql = await previewDialog('event_trigger')
  console.log(`et state ${state}:`, sql.replace(/\n/g, ' '), '|', await saveDialog('event_trigger'), q(`SELECT evtenabled FROM pg_event_trigger WHERE evtname='dbo_et'`))
}
await shotEl(page, 'database/event-triggers.png', '#event_triggers_section')
await rowAction('event_triggers', 'dbo_et', 'edit')
await page.fill(f('event_trigger', 'when'), 'ALTER TABLE')
await page.fill(f('event_trigger', 'name'), 'dbo_et2')
await page.selectOption(f('event_trigger', 'eventowner'), 'postgres')
console.log('et tags+rename preview:', await previewDialog('event_trigger'))
console.log('et tags+rename:', await saveDialog('event_trigger'), q(`SELECT evtname, evttags, obj_description(oid, 'pg_event_trigger') FROM pg_event_trigger`))
// Owner that is not a superuser
await rowAction('event_triggers', 'dbo_et2', 'edit')
await page.selectOption(f('event_trigger', 'eventowner'), 'bookshop_staff')
console.log('et owner non-superuser:', await saveDialog('event_trigger'))
await closeDialog('event_trigger').catch(() => {})
console.log('drop et:', await drop('event_triggers', 'dbo_et2'))

// The navigation panel link: ?open=extension:<oid>
const oid = q(`SELECT oid FROM pg_extension WHERE extname='pg_trgm'`)
await goto(`/db/${DB}/objects?open=extension:${oid}`)
console.log('open= dialog title:', await page.locator('.modal.show .modal-title').innerText().catch(() => 'none'), page.url())
await closeDialog('extension').catch(() => {})

await close()
await done()
q(`DROP EVENT TRIGGER IF EXISTS dbo_et; DROP EVENT TRIGGER IF EXISTS dbo_et2;
   DROP EXTENSION IF EXISTS hstore CASCADE; DROP EXTENSION IF EXISTS pg_trgm CASCADE; DROP EXTENSION IF EXISTS earthdistance CASCADE; DROP EXTENSION IF EXISTS cube CASCADE; DROP EXTENSION IF EXISTS plperl CASCADE;
   DROP LANGUAGE IF EXISTS dbo_lang CASCADE; DROP LANGUAGE IF EXISTS dbo_lang2 CASCADE;
   DROP SCHEMA IF EXISTS dbo_ext CASCADE; DROP TYPE IF EXISTS dbo_pair CASCADE; DROP TABLE IF EXISTS dbo_kv; DROP TABLE IF EXISTS dbo_et_log;
   DROP FUNCTION IF EXISTS dbo_et_fn() CASCADE; DROP FUNCTION IF EXISTS dbo_text_to_pair(text)`)
psql('DROP DATABASE IF EXISTS dbo_scratch WITH (FORCE)')
