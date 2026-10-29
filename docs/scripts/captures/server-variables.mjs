// Server » Variables: the filter, the editors, ALTER SYSTEM SET / RESET of work_mem (reset at the end).
//   node docs/scripts/captures/server-variables.mjs

import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, notice, clearNotice, openRetry, shotEl } from './server-lib.mjs'

const auto = () => psql("SELECT coalesce(string_agg(name || ' = ' || setting, ', '), '(empty)') FROM pg_file_settings WHERE sourcefile LIKE '%postgresql.auto.conf'")

const { page, close } = await openRetry('/server/variables')
await page.locator('#serverVariables tbody tr').first().waitFor()
console.log('rows:', await page.locator('#serverVariables tbody tr').count(), 'pg_settings:', psql('SELECT count(*) FROM pg_settings'))

// The filter reads spaces as underscores.
await page.fill('#filterText', 'work mem')
await settle(page, 200)
console.log('work mem filter:', (await page.locator('#serverVariables tbody .var-name').allInnerTexts()).join(', '))
await shot(page, 'server/variables-filter.png', { selector: '.container-fluid' })

// Edit work_mem: the text editor with its range in the title, Enter saves.
await page.click('#serverVariables a.editLink[data-variable="work_mem"]')
const editor = page.locator('.serverVariableEditor input')
await editor.waitFor()
console.log('editor value / title:', await editor.inputValue(), '/', await editor.getAttribute('title'))
await editor.fill('8MB')
await shotEl(page, 'server/variables-edit.png', '#serverVariables', { pad: 4 })
await editor.press('Enter')
console.log('save:', await notice(page))
console.log('row now:', (await page.locator('#serverVariables tbody tr').filter({ has: page.locator('.var-name', { hasText: /^work mem$/ }) }).innerText()).replace(/\s+/g, ' '))
console.log('auto.conf:', auto(), '| new session SHOW work_mem:', psql('SHOW work_mem'))
await clearNotice(page)

// A bad value: the server's error.
await page.click('#serverVariables a.editLink[data-variable="work_mem"]')
await editor.fill('lots')
await editor.press('Enter')
console.log('bad value:', await notice(page))
await clearNotice(page)

// Reset: ALTER SYSTEM RESET.
await page.click('a.resetLink')
console.log('reset:', await notice(page))
console.log('auto.conf:', auto(), '| new session SHOW work_mem:', psql('SHOW work_mem'))
await clearNotice(page)

// A boolean gets a select; Escape cancels.
await page.fill('#filterText', 'autovacuum')
await page.click('#serverVariables a.editLink[data-variable="autovacuum"]')
await page.locator('.serverVariableEditor select').waitFor()
console.log('bool options:', (await page.locator('.serverVariableEditor select option').allInnerTexts()).join(', '))
await page.locator('.serverVariableEditor select').press('Escape')
console.log('editor after Escape:', await page.locator('.serverVariableEditor').count())

// An enum.
await page.fill('#filterText', 'wal level')
await page.click('#serverVariables a.editLink[data-variable="wal_level"]')
await page.locator('.serverVariableEditor select').waitFor()
console.log('enum options:', (await page.locator('.serverVariableEditor select option').allInnerTexts()).join(', '))
await page.click('a.cancelLink')

// A read-only (internal) parameter.
await page.fill('#filterText', 'block size')
await settle(page, 200)
console.log('read-only title:', await page.locator('#serverVariables .read_only_var').first().getAttribute('title'))
await shotEl(page, 'server/variables-readonly.png', '#serverVariables', { pad: 4 })
await close()

// ?filter= in the URL fills the filter.
{
  const { page, close } = await openRetry('/server/variables?filter=shared_buffers')
  await page.locator('#serverVariables tbody tr').first().waitFor()
  console.log('?filter rows:', (await page.locator('#serverVariables tbody .var-name').allInnerTexts()).join(', '))
  await close()
}

psqlTry('ALTER SYSTEM RESET work_mem')
psqlTry('SELECT pg_reload_conf()')
console.log('final auto.conf:', auto())
await done()
