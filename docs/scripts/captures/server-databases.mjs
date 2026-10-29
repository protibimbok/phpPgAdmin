// Server » Databases: the list, the Create database card, statistics and the drop dialog.
// Creates and drops the scratch database srv_scratch.
//   node docs/scripts/captures/server-databases.mjs

import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, notice, clearNotice, confirm, onlyRows, openRetry } from './server-lib.mjs'

const DEMO = /^(bookshop|postgres|srv_.*)$/

psqlTry('DROP DATABASE IF EXISTS srv_scratch WITH (FORCE)', 'postgres')

const { page, close } = await openRetry('/server/databases')
await page.fill('#filterText', '')
await onlyRows(page, '#dbStatsForm', DEMO)
await shot(page, 'server/databases-list.png', { selector: '#databases' })
await shot(page, 'server/databases-create-card.png', { selector: '#create_database_form', pad: 16 })

// Create srv_scratch from template0, owned by bookshop_staff, in UTF8.
await page.fill('#text_create_db', 'srv_scratch')
await page.selectOption('select[name=template]', 'template0')
await page.selectOption('select[name=datowner]', 'bookshop_staff')
await page.selectOption('select[name=encoding]', 'UTF8')
await page.click('#buttonGo')
console.log('create:', await notice(page))
console.log('catalog:', psql("SELECT datname, pg_get_userbyid(datdba), pg_encoding_to_char(encoding), datcollate FROM pg_database WHERE datname = 'srv_scratch'"))
await clearNotice(page)

// An encoding the cluster's locale (C.UTF-8) does not support: PostgreSQL refuses it, and the card has no locale field.
await page.fill('#text_create_db', 'srv_scratch_bad')
await page.selectOption('select[name=template]', '')
await page.selectOption('select[name=datowner]', '')
await page.selectOption('select[name=encoding]', 'LATIN1')
await page.click('#buttonGo')
console.log('bad encoding:', await notice(page))
await clearNotice(page)
await page.fill('#text_create_db', '')
await page.selectOption('select[name=encoding]', '')

// The search box filters by name.
await page.fill('#filterText', 'srv')
await settle(page, 200)
console.log('filtered rows:', await page.locator('#dbStatsForm tbody tr').count())
await page.fill('#filterText', '')

// Enable statistics adds pg_stat_database's columns.
await page.click('a:has-text("Enable statistics")')
await settle(page, 800)
await onlyRows(page, '#dbStatsForm', DEMO)
console.log('stat headers:', (await page.locator('#dbStatsForm thead th').allInnerTexts()).join(' | '))
await shot(page, 'server/databases-statistics.png', { selector: '#dbStatsForm' })
await page.click('a:has-text("Disable statistics")')

// The drop dialog, with Force.
await page.check('#dbStatsForm input[value=srv_scratch]')
await page.click('#bulkActionDropButton')
await page.locator('#confirm_dialog').waitFor()
await page.check('#dropDatabaseForce')
await shot(page, 'server/databases-drop-confirm.png', { selector: '#confirm_dialog .modal-content' })
console.log('drop dialog:', await confirm(page))
console.log('drop:', await notice(page))
console.log('after drop:', psql("SELECT count(*) FROM pg_database WHERE datname = 'srv_scratch'"))

// Drop with nothing checked.
await clearNotice(page)
await page.click('#bulkActionDropButton')
console.log('none selected:', await notice(page))

await close()
await done()
psqlTry('DROP DATABASE IF EXISTS srv_scratch WITH (FORCE)', 'postgres')
