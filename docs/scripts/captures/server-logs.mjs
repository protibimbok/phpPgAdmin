// Server » Status » Logs: the file picker, the three formats, paging, full messages, plain text
// and the download. Writes a few entries to the log first (an error with a statement and a hint).
//   node docs/scripts/captures/server-logs.mjs

import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, openRetry, shotEl } from './server-lib.mjs'

psqlTry("SELECT 1 / 0 AS srv_docs_division")
psqlTry("SELECT * FROM srv_docs_missing_table")
psqlTry("DO $$ BEGIN RAISE WARNING 'srv docs warning' USING DETAIL = 'A detail line', HINT = 'A hint line'; END $$")
console.log('current files:', psql("SELECT pg_current_logfile('stderr'), pg_current_logfile('csvlog'), pg_current_logfile('jsonlog')"))

const { page, close } = await openRetry('/server/status/logs')
await page.locator('#logTable').waitFor({ timeout: 15000 })
await settle(page, 500)
const files = await page.locator('select[name=log] option').allInnerTexts()
console.log('files:', files.length, files.slice(0, 6).join(' | '))
const card = page.locator('form.card')
console.log('card:', (await card.innerText()).replace(/\n+/g, ' / ').slice(0, 300))

async function view(ext, { plain = false } = {}) {
  const name = await page.locator('select[name=log] option').evaluateAll((os, ext) => os.map((o) => o.value).find((v) => v.endsWith(ext) && os.find((o) => o.value === v).textContent.includes('being written')) ?? os.map((o) => o.value).find((v) => v.endsWith(ext)), ext)
  await page.selectOption('select[name=log]', name)
  if (plain) await page.check('#logPlain')
  else await page.uncheck('#logPlain')
  await page.click('form.card input[type=submit]')
  await settle(page, 800)
  return name
}

// The newest page of the csvlog file opens with the structured columns.
psqlTry("DO $$ BEGIN RAISE WARNING 'srv docs warning' USING DETAIL = 'A detail line', HINT = 'A hint line'; END $$")
console.log('csv file:', await view('.csv'))
console.log('csv headers:', (await page.locator('#logTable thead tr:nth-child(2) th').allInnerTexts()).join(' | '))
console.log('range:', await page.locator('#logTable thead .text-body-secondary').innerText())
await shotEl(page, 'server/logs-csvlog.png', '.container-fluid', { maxHeight: 760 })

// Show full messages: DETAIL / HINT / STATEMENT appear under the message.
await page.click('#logTable thead a[href="#full"]')
await settle(page, 300)
const warning = page.locator('#logTable tbody tr').filter({ has: page.locator('td:nth-child(5)', { hasText: /^WARNING$/ }) }).filter({ hasText: 'srv docs warning' }).last()
for (let i = 0; i < 8 && !(await warning.count()); i++) {
  await page.click('#logTable a[href="#previous"]')
  await settle(page, 500)
}
console.log('full warning:', (await warning.innerText()).replace(/\n/g, ' / '))
await warning.scrollIntoViewIfNeeded()
await warning.evaluate((tr) => tr.setAttribute('id', 'srvWarningRow'))
await shotEl(page, 'server/logs-full-message.png', '#srvWarningRow', { pad: 4 })
await page.click('#logTable thead a[href="#full"]')

// Previous page and back.
if (await page.locator('#logTable a[href="#previous"]').count()) {
  await page.click('#logTable a[href="#previous"]')
  await settle(page, 600)
  console.log('previous range:', await page.locator('#logTable thead .text-body-secondary').innerText())
  await page.click('#logTable a[href="#next"]')
  await settle(page, 600)
  console.log('next range:', await page.locator('#logTable thead .text-body-secondary').innerText())
} else console.log('no previous page')

// jsonlog and stderr.
console.log('json file:', await view('.json'))
console.log('json headers:', (await page.locator('#logTable thead tr:nth-child(2) th').allInnerTexts()).join(' | '))
console.log('stderr file:', await view('.log'))
console.log('stderr headers:', (await page.locator('#logTable thead tr:nth-child(2) th').allInnerTexts()).join(' | '))
console.log('stderr first row:', (await page.locator('#logTable tbody tr').last().innerText()).replace(/\n/g, ' / ').slice(0, 200))
await shotEl(page, 'server/logs-stderr.png', '#logTable', { maxHeight: 420 })

// Plain text.
await view('.log', { plain: true })
console.log('plain text chars:', (await page.locator('#logText').innerText()).length)
await shotEl(page, 'server/logs-plain.png', '#logText', { maxHeight: 360 })

// Download: the whole file as an attachment.
const name = await page.locator('select[name=log]').inputValue()
const href = await page.locator('form.card a[download]').getAttribute('href')
const dl = await page.evaluate(async (href) => {
  const r = await fetch(href)
  const b = await r.arrayBuffer()
  return `${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-disposition')} ${b.byteLength}`
}, href)
console.log('download', name, href, '->', dl)
console.log('size in pg_ls_logdir:', psql(`SELECT size FROM pg_ls_logdir() WHERE name = '${name}'`))

// A file that is not in the log directory.
console.log('outside the directory:', await page.evaluate(async () => { const r = await fetch('/api/server/logs/..%2Fpostgresql.conf'); return `${r.status} ${(await r.text()).slice(0, 120)}` }))

await close()
await done()
