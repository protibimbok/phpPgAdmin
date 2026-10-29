// What the server pages show to a role that is not a superuser: signs in as the scratch login
// role srv_role_viewer (CREATEDB, no other attributes) and reads each page. No screenshots,
// except the Logs refusal.
//   node docs/scripts/captures/server-nonsuperuser.mjs

import { done, settle } from '../capture.mjs'
import { psql, psqlTry, notice, openRetry, shotEl } from './server-lib.mjs'

psqlTry('DROP ROLE IF EXISTS srv_role_viewer')
psql('CREATE ROLE srv_role_viewer LOGIN CREATEDB')
process.env.DOCS_PG_USER = 'srv_role_viewer'

const text = async (page, sel = '.container-fluid') => (await page.locator(sel).first().innerText().catch(() => '(none)')).replace(/\s+/g, ' ').slice(0, 400)
const api = (page, url, init) => page.evaluate(async ([url, init]) => { const r = await fetch(url, init); return `${r.status} ${(await r.text()).slice(0, 220)}` }, [url, init])

const { page, close } = await openRetry('/server/databases')
await settle(page, 600)
console.log('databases:', await text(page, '#dbStatsForm'))
console.log('drop checkbox enabled for bookshop:', await page.locator('#dbStatsForm input[value=bookshop]').isEnabled())

for (const route of ['/server/status', '/server/status/processes', '/server/status/locks', '/server/status/prepared']) {
  await page.goto(page.url().replace(/\/server\/.*/, route))
  await settle(page, 800)
  console.log(route, ':', await text(page))
}
console.log('cancel postgres session:', await api(page, `/api/server/status/activity/${psql("SELECT pid FROM pg_stat_activity WHERE backend_type = 'checkpointer'")}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))

await page.goto(page.url().replace(/\/server\/.*/, '/server/status/logs'))
await settle(page, 800)
console.log('logs:', await text(page))
await shotEl(page, 'server/logs-not-allowed.png', '.container-fluid', { maxHeight: 200 })

await page.goto(page.url().replace(/\/server\/.*/, '/server/variables'))
await settle(page, 800)
console.log('variables rows:', await page.locator('#serverVariables tbody tr').count(), 'editable:', await page.locator('#serverVariables a.editLink').count())
console.log('variables api work_mem PUT:', await api(page, '/api/server/variables/work_mem', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"value":"8MB"}' }))

await page.goto(page.url().replace(/\/server\/.*/, '/server/roles'))
await settle(page, 800)
console.log('roles:', await text(page, '#userRightsTable'))
await page.goto(page.url().replace(/\/server\/.*/, '/server/roles/create'))
await settle(page, 600)
await page.fill('#pma_username', 'srv_role_byviewer')
await page.click('#adduser_submit')
console.log('create role as non-superuser:', await notice(page))

await page.goto(page.url().replace(/\/server\/.*/, '/server/tablespaces'))
await settle(page, 800)
console.log('tablespaces:', await text(page))

await page.goto(page.url().replace(/\/server\/.*/, '/server/replication'))
await settle(page, 800)
console.log('replication:', await text(page))

await page.goto(page.url().replace(/\/server\/.*/, '/server/status/monitor'))
await settle(page, 3000)
console.log('monitor:', (await text(page)).slice(0, 200))

await close()
psqlTry('DROP ROLE IF EXISTS srv_role_byviewer')
psqlTry('DROP ROLE IF EXISTS srv_role_viewer')
await done()
