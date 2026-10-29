// Server » Replication: the primary and replica cards, replication slots, and the publications
// and subscriptions of a database. Scratch objects: slots srv_slot_phys / srv_slot_logical /
// srv_sub_slot, table public.srv_pub_tbl in bookshop and srv_sub, publication srv_pub in
// bookshop, database srv_sub with subscription srv_sub.
//   node docs/scripts/captures/server-replication.mjs

import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, notice, clearNotice, confirm, openRetry, shotEl, onlyRows } from './server-lib.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cleanup() {
  psqlTry("ALTER SUBSCRIPTION srv_sub DISABLE", 'srv_sub')
  psqlTry("ALTER SUBSCRIPTION srv_sub SET (slot_name = NONE)", 'srv_sub')
  psqlTry('DROP SUBSCRIPTION IF EXISTS srv_sub', 'srv_sub')
  psqlTry('DROP DATABASE IF EXISTS srv_sub WITH (FORCE)', 'postgres')
  for (const slot of ['srv_slot_phys', 'srv_slot_logical', 'srv_sub_slot']) psqlTry(`SELECT pg_drop_replication_slot('${slot}') FROM pg_replication_slots WHERE slot_name = '${slot}'`)
  psqlTry('DROP PUBLICATION IF EXISTS srv_pub')
  psqlTry('DROP TABLE IF EXISTS public.srv_pub_tbl')
}
cleanup()
psql("CREATE TABLE public.srv_pub_tbl (id int PRIMARY KEY, note text, secret text); INSERT INTO public.srv_pub_tbl VALUES (1, 'one', 'x'), (2, 'two', 'y'), (30, 'thirty', 'z')")
psql('CREATE DATABASE srv_sub', 'postgres')
psql('CREATE TABLE public.srv_pub_tbl (id int PRIMARY KEY, note text)', 'srv_sub')

const SLOTS = '#srvSlotsCard'
// The cards have no ids of their own; give them one by their header so CSS selectors can reach them.
const tagCards = (page) => page.evaluate(() => {
  const ids = { 'Primary replication': 'srvPrimaryCard', 'Replica replication': 'srvReplicaCard', 'Replication slots': 'srvSlotsCard' }
  for (const header of document.querySelectorAll('.card > .card-header')) if (ids[header.textContent.trim()]) header.parentElement.id = ids[header.textContent.trim()]
})
const previewIn = async (page, modal) => {
  await modal.locator('.modal-footer button', { hasText: 'Preview SQL' }).click()
  const box = page.locator('.modal-content').last()
  await box.locator('pre, code').first().waitFor({ timeout: 8000 }).catch(() => {})
  await settle(page, 300)
  const text = (await box.locator('.modal-body').innerText()).trim()
  await box.locator('.btn-close').click()
  return text
}

{
  // A tall viewport, so the subscription dialog fits without scrolling inside the modal.
  const { page, close } = await openRetry('/server/replication', { viewport: { width: 1280, height: 2000 } })
  await page.locator('.card-header', { hasText: 'Primary replication' }).waitFor()
  await settle(page, 400)
  await tagCards(page)
  console.log('primary card:', (await page.locator('#srvPrimaryCard').innerText()).replace(/\n+/g, ' / '))
  console.log('replica card:', (await page.locator('#srvReplicaCard').innerText()).replace(/\n+/g, ' / '))
  await page.click('#primary_status_href')
  await page.click('#primary_replicas_href')
  await settle(page, 300)
  console.log('primary status:', (await page.locator('#serverprimaryreplicationsummary').innerText()).replace(/\n/g, ' / '))
  await shotEl(page, 'server/replication-primary.png', '#srvPrimaryCard')
  console.log('add replication user link:', await page.locator('#primary_addreplicauser_href').getAttribute('href'))

  // WAL replay on a primary: the server refuses.
  console.log('pause replay on a primary:', await page.evaluate(async () => { const r = await fetch('/api/server/replication/replay/pause', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); return `${r.status} ${(await r.text()).slice(0, 200)}` }))

  // Slots: a physical one reserving WAL, a logical one in bookshop with two-phase.
  const slots = page.locator(SLOTS)
  await slots.locator('#slot_name').fill('srv_slot_phys')
  await slots.locator('select[name=slot_type]').selectOption('physical')
  await slots.locator('#slot_reserve').check()
  await slots.locator('input[type=submit]').click()
  console.log('physical slot:', await notice(page))
  await clearNotice(page)
  await slots.locator('#slot_name').fill('srv_slot_logical')
  await slots.locator('select[name=slot_type]').selectOption('logical')
  await slots.locator('select[name=slot_database]').selectOption('bookshop')
  console.log('plugin default:', await slots.locator('input[name=slot_plugin]').inputValue())
  await slots.locator('#slot_two_phase').check()
  await shotEl(page, 'server/replication-slots-form.png', `${SLOTS} form`, { pad: 4 })
  await slots.locator('input[type=submit]').click()
  console.log('logical slot:', await notice(page))
  await clearNotice(page)
  // The slot the subscription will use (a subscription to this same cluster cannot create its own).
  await slots.locator('#slot_name').fill('srv_sub_slot')
  await slots.locator('#slot_two_phase').uncheck()
  await slots.locator('input[type=submit]').click()
  console.log('subscription slot:', await notice(page))
  await clearNotice(page)
  // An invalid name.
  await slots.locator('#slot_name').fill('Srv-Bad')
  await slots.locator('input[type=submit]').click()
  console.log('invalid slot name:', await notice(page))
  await clearNotice(page)
  await tagCards(page)
  console.log('catalog:', psql("SELECT string_agg(slot_name || ':' || slot_type || ':' || coalesce(plugin, '-') || ':' || coalesce(database, '-') || ':' || two_phase || ':' || coalesce(restart_lsn::text, 'no lsn'), ', ') FROM pg_replication_slots WHERE slot_name LIKE 'srv_%'"))
  await onlyRows(page, SLOTS, /^srv_/, 'td:nth-child(1)')
  await shotEl(page, 'server/replication-slots.png', `${SLOTS} table`, { pad: 4 })

  // Drop the physical slot.
  await slots.locator('tbody tr', { hasText: 'srv_slot_phys' }).locator('a.drop_anchor').click()
  console.log('drop slot:', await confirm(page))
  console.log('drop slot:', await notice(page))
  await clearNotice(page)

  // ---- Logical replication: publications of bookshop.
  await page.selectOption('#logical_db', 'bookshop')
  await page.click('#goButton')
  await page.locator('#publications_section').waitFor()
  await settle(page, 500)
  console.log('url:', new URL(page.url()).search)
  await page.locator('#publications_section button.add_anchor').click()
  const pub = page.locator('#publicationDialogModal')
  await pub.waitFor()
  await settle(page, 600)
  await pub.locator('input[name=publication_name]').fill('srv_pub')
  await pub.locator('button', { hasText: 'Add table' }).click()
  const tid = await pub.locator('select[name=pubtable_0] option').evaluateAll((os) => os.find((o) => o.textContent.includes('srv_pub_tbl'))?.value)
  await pub.locator('select[name=pubtable_0]').selectOption(tid)
  await settle(page, 600)
  await pub.locator('select[name=pubtable_columns_0]').selectOption(['id', 'note'])
  await pub.locator('input[name=pubtable_where_0]').fill('id < 10')
  await pub.locator('input[name=evnt_truncate]').uncheck()
  await pub.locator('input[name=publication_comment]').fill('Scratch publication for the docs')
  console.log('publication preview:\n', await previewIn(page, pub))
  await shotEl(page, 'server/replication-publication.png', '#publicationDialogModal .modal-content')
  await pub.locator('.modal-footer button.btn-primary').click()
  console.log('publication:', await notice(page))
  await clearNotice(page)
  console.log('catalog:', psql("SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate, pubviaroot FROM pg_publication WHERE pubname = 'srv_pub'"), '|', psql("SELECT attnames, rowfilter FROM pg_publication_tables WHERE pubname = 'srv_pub'"))

  // Edit: FOR ALL TABLES is read-only once created.
  await page.locator('#publicationsTable tbody tr', { hasText: 'srv_pub' }).locator('a[href="#edit"]').click()
  await pub.waitFor()
  await settle(page, 600)
  console.log('all tables on edit:', await pub.locator('input[readonly]').first().inputValue().catch(() => '?'), '| checkbox:', await pub.locator('input[name=all_table]').count())
  await pub.locator('input[name=evnt_truncate]').check()
  console.log('publication edit preview:\n', await previewIn(page, pub))
  await pub.locator('.modal-footer button.btn-primary').click()
  console.log('publication edit:', await notice(page))
  await clearNotice(page)

  // Export.
  await page.locator('#publicationsTable tbody tr', { hasText: 'srv_pub' }).locator('a[href="#export"]').click()
  await page.locator('.modal-content').last().getByText('CREATE PUBLICATION').first().waitFor()
  console.log('publication export:\n', await page.locator('.modal-content .modal-body').last().innerText())
  await page.locator('.modal-content').last().locator('.btn-close').click()

  // ---- Subscriptions of srv_sub.
  await page.selectOption('#logical_db', 'srv_sub')
  await page.click('#goButton')
  await page.locator('#subscriptions_section').waitFor()
  await settle(page, 500)
  await page.locator('#subscriptions_section button.add_anchor').click()
  const sub = page.locator('.modal-content').last()
  await sub.locator('input[name=name]').waitFor()
  await settle(page, 500)
  await sub.locator('input[name=name]').fill('srv_sub')
  await sub.locator('input[name=host]').fill('localhost')
  await sub.locator('input[name=port]').fill('5499')
  await sub.locator('input[name=username]').fill('postgres')
  await sub.locator('input[name=db]').fill('bookshop')
  await sub.locator('button', { hasText: 'Get publications' }).click()
  await sub.locator('label', { hasText: 'srv_pub' }).first().waitFor({ timeout: 10000 })
  console.log('remote publications:', (await sub.locator('label:has(input[type=checkbox])').allInnerTexts()).filter((t) => t.trim().startsWith('srv') || t.includes('pub')).join(', '))
  await sub.locator('label', { hasText: 'srv_pub' }).first().locator('input').check()
  await sub.locator('input[name=create_slot]').uncheck()
  await sub.locator('input[name=slot_name]').fill('srv_sub_slot')
  console.log('with options:', (await sub.locator('input[type=checkbox][name], select[name]').evaluateAll((els) => els.map((e) => `${e.name}=${e.type === 'checkbox' ? e.checked : e.value}`))).join(' '))
  console.log('subscription preview:\n', await previewIn(page, sub))
  await shotEl(page, 'server/replication-subscription.png', '.modal-content >> nth=-1')
  await sub.locator('.modal-footer button.btn-primary').click()
  console.log('subscription:', await notice(page, 20000))
  await clearNotice(page)
  await sleep(4000)
  console.log('copied rows in srv_sub:', psql('SELECT string_agg(id || ' + "'='" + ' || note, \', \' ORDER BY id) FROM public.srv_pub_tbl', 'srv_sub'))
  psql("INSERT INTO public.srv_pub_tbl VALUES (3, 'three', 'w'), (40, 'forty', 'v')")
  await sleep(3000)
  console.log('after insert in bookshop:', psql('SELECT string_agg(id::text, \', \' ORDER BY id) FROM public.srv_pub_tbl', 'srv_sub'))
  await page.click('#goButton')
  await settle(page, 800)
  console.log('subscription row:', (await page.locator('#subscriptionsTable tbody tr', { hasText: 'srv_sub' }).innerText()).replace(/\s+/g, ' '))
  await shotEl(page, 'server/replication-subscriptions.png', '#subscriptions_section')

  // Edit: disable, refresh publication.
  await page.locator('#subscriptionsTable tbody tr', { hasText: 'srv_sub' }).locator('a[href="#edit"]').click()
  await sub.locator('input[name=name]').waitFor()
  await settle(page, 500)
  console.log('edit password placeholder / conninfo note:', await sub.locator('input[name=password]').getAttribute('placeholder'), '/', await sub.locator('.alert, .form-text').first().innerText().catch(() => ''))
  await sub.locator('input[name=refresh_pub]').check()
  console.log('edit preview (refresh):\n', await previewIn(page, sub))
  await sub.locator('input[name=refresh_pub]').uncheck()
  await sub.locator('input[name=enabled]').uncheck()
  console.log('edit preview (disable):\n', await previewIn(page, sub))
  await sub.locator('.modal-footer button.btn-primary').click()
  console.log('subscription edit:', await notice(page))
  await clearNotice(page)
  console.log('enabled:', psql("SELECT subenabled FROM pg_subscription WHERE subname = 'srv_sub'", 'srv_sub'))

  // Drop the subscription: DROP SUBSCRIPTION also drops srv_sub_slot on the publisher.
  await page.locator('#subscriptionsTable tbody tr', { hasText: 'srv_sub' }).locator('a[href="#drop"]').click()
  console.log('drop subscription:', await confirm(page))
  console.log('drop subscription:', await notice(page, 20000))
  await clearNotice(page)
  console.log('slots left:', psql("SELECT coalesce(string_agg(slot_name, ', '), '(none)') FROM pg_replication_slots WHERE slot_name LIKE 'srv_%'"))

  // Drop the publication and the logical slot.
  await page.selectOption('#logical_db', 'bookshop')
  await page.click('#goButton')
  await page.locator('#publicationsTable').waitFor()
  await page.locator('#publicationsTable tbody tr', { hasText: 'srv_pub' }).locator('a[href="#drop"]').click()
  console.log('drop publication:', await confirm(page))
  console.log('drop publication:', await notice(page))
  await clearNotice(page)
  await page.locator(SLOTS).locator('tbody tr', { hasText: 'srv_slot_logical' }).locator('a.drop_anchor').click()
  await confirm(page)
  console.log('drop logical slot:', await notice(page))
  await close()
}

cleanup()
console.log('leftovers:', psql("SELECT (SELECT count(*) FROM pg_replication_slots WHERE slot_name LIKE 'srv_%') || ' slots, ' || (SELECT count(*) FROM pg_publication WHERE pubname LIKE 'srv_%') || ' publications, ' || (SELECT count(*) FROM pg_database WHERE datname = 'srv_sub') || ' srv_sub'"))
await done()
