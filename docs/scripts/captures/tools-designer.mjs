// Designer: screenshots and a clip for docs/database/designer.md, and checks of each side-menu
// tool. Run with: node docs/scripts/captures/tools-designer.mjs
// A relation is made and dropped between two scratch tables (public.tools_parent and
// public.tools_child in bookshop), dropped at the end; a saved page tools_page is deleted again.

import fs from 'node:fs'
import path from 'node:path'
import { done, record, settle } from '../capture.mjs'
import { api, check, clearNotices, notice, open, psql, shot, summary, workdir } from './tools-lib.mjs'

const dir = workdir('designer')
psql('DROP TABLE IF EXISTS public.tools_child, public.tools_parent')

const box = (key) => `[id="${key}"]`
const menu = (id) => `#side_menu #${id}`
const route = '/db/bookshop/designer'

const { page, close } = await open(route)
await page.waitForSelector(box('public.books'))
await settle(page, 1000)
await shot(page, 'database/designer-overview.png')
const boxes = await page.locator('table.designer_tab').count()
const lines = await page.locator('#relations g.relation').count()
const diagramTables = (await api(page, 'GET', '/api/databases/bookshop/designer')).json.tables
check('every relation of the user schemas has a box, partitions left out', boxes === diagramTables.length && diagramTables.length > 0 && !diagramTables.some((t) => t.name === 'orders_2025') && diagramTables.some((t) => t.name === 'book_catalogue'), `${boxes} boxes, ${diagramTables.length} relations`)
check('a line per foreign key column', lines >= 8, lines)
await shot(page, 'database/designer-side-menu.png', { selector: '#side_menu', pad: 4 })

// Lines on and off, angular or direct.
await page.click(menu('toggle_lines'))
check('Toggle relationship lines hides them', (await page.locator('#relations g.relation').count()) === 0)
await page.click(menu('toggle_lines'))
const before = await page.locator('#relations g.relation path').nth(1).getAttribute('d')
await page.click(menu('angular_direct_button'))
const after = await page.locator('#relations g.relation path').nth(1).getAttribute('d')
check('Angular / Direct links changes how lines are drawn', before !== after, `${before?.slice(0, 40)} → ${after?.slice(0, 40)}`)
await page.click(menu('angular_direct_button'))

// Small/Big All folds every box; a box's own v folds it.
await page.click(menu('key_SB_all'))
check('Small/Big All folds the boxes', (await page.locator('table.designer_tab tbody').count()) === 0)
await page.click(menu('key_SB_all'))
await page.click(`${box('public.authors')} .small_tab`)
check('the v in a header folds one box', (await page.locator(`${box('public.authors')} tbody`).count()) === 0)
await page.click(`${box('public.authors')} .small_tab`)

// Tables list: hide one table, show it again.
await page.click(menu('showdesignerpanel'))
await page.waitForSelector('#layer_menu')
await shot(page, 'database/designer-tables-list.png', { selector: '#layer_menu', pad: 4 })
await page.uncheck('[id="designer_show_public.reviews"]')
const hidden = (await page.locator(box('public.reviews')).count()) === 0
check('unticking a table in the list hides its box', hidden)
await page.check('[id="designer_show_public.reviews"]')
check('ticking it again shows the box', (await page.locator(box('public.reviews')).count()) === 1)
await page.click(menu('showdesignerpanel'))

// Help.
await page.click(menu('help'))
await page.waitForSelector('.modal .modal-body li')
const help = await page.locator('.modal .modal-body').innerText()
check('Help lists the mouse and keyboard controls', /Ctrl\+wheel/.test(help) && /Shift\+drag/.test(help))
await page.click('.modal .btn-close')

// Keyboard: Ctrl+A selects all, an arrow moves the selection, 1 fits.
{
  const area = await page.locator('#canvas_outer').boundingBox()
  await page.mouse.click(area.x + area.width - 260, area.y + area.height - 20)
}
await page.keyboard.press('Control+a')
check('Ctrl+A selects every box', (await page.locator('table.designer_tab.selected').count()) === (await page.locator('table.designer_tab').count()))
const x0 = await page.locator(box('public.books')).evaluate((e) => e.style.left)
await page.keyboard.press('ArrowRight')
const x1 = await page.locator(box('public.books')).evaluate((e) => e.style.left)
check('an arrow key moves the selection', x0 !== x1, `${x0} → ${x1}`)
await page.keyboard.press('Escape')
const zoom0 = await page.locator('.zoom-level').innerText()
await page.keyboard.press('+')
const zoom1 = await page.locator('.zoom-level').innerText()
check('+ zooms in', zoom0 !== zoom1, `${zoom0} → ${zoom1}`)
await page.keyboard.press('1')
await settle(page)
await shot(page, 'database/designer-view-controls.png', { selector: '#designer_view', pad: 4 })
check('the page name shows unsaved changes', (await page.locator('#saved_state').count()) === 1)

// Pages: save as, open, delete.
await page.click(menu('SaveAs'))
await page.fill('#selected_value', 'tools_page')
await page.click('.modal .btn-primary')
check('Save page as saves a page', /tools_page has been saved/.test(await notice(page)))
await clearNotices(page)
check('the page name is shown', (await page.locator('#page_name').innerText()) === 'tools_page')
await page.click(menu('newPage'))
check('New page starts an untitled layout', (await page.locator('#page_name').innerText()) === 'Untitled')
await page.click(menu('editPage'))
await page.waitForSelector('.modal a:has-text("tools_page")')
await shot(page, 'database/designer-open-page.png', { selector: '.modal-content' })
await page.click('.modal a:has-text("tools_page")')
await settle(page)
check('Open page loads it', (await page.locator('#page_name').innerText()) === 'tools_page')
await page.click(menu('delPages'))
await page.waitForSelector('.modal input[aria-label="tools_page"]')
await page.check('.modal input[aria-label="tools_page"]')
await shot(page, 'database/designer-delete-pages.png', { selector: '.modal-content' })
await page.click('.modal .btn-danger')
check('Delete pages deletes it', /1 page\(s\) deleted/.test(await notice(page)))
await clearNotices(page)
await page.click('.modal .btn-close')
const pages = await api(page, 'GET', '/api/databases/bookshop/designer/pages')
check('no saved page left behind', !pages.json.pages.some((p) => p.name === 'tools_page'))

// Create relationship between the scratch tables, then drop it from its line. Tables made while
// the Designer is open come with Reload only into the Tables list; New page lays them out.
psql('CREATE TABLE public.tools_parent (id int PRIMARY KEY, name text); CREATE TABLE public.tools_child (id int PRIMARY KEY, parent_id int)')
await page.click(menu('reloadPage'))
await settle(page, 1000)
check('Reload does not add new tables to the layout', (await page.locator(box('public.tools_parent')).count()) === 0)
await page.click(menu('newPage'))
await settle(page)
check('New page lays them out', (await page.locator(box('public.tools_parent')).count()) === 1)
await page.click(menu('rel_button'))
check('Create relationship asks for the referenced key', /Select referenced key/.test(await page.locator('#designer_hint').innerText()))
await page.click(`${box('public.tools_parent')} tr[data-column="id"]`)
check('then for the foreign key', /Select Foreign Key for tools_parent\.id/.test(await page.locator('#designer_hint').innerText()))
await page.click(`${box('public.tools_child')} tr[data-column="parent_id"]`)
await page.waitForSelector('#layer_new_relation_table')
await page.selectOption('#on_delete', 'CASCADE')
await shot(page, 'database/designer-create-relation.png', { selector: '.modal-content' })
await page.click('.modal .btn-secondary:has-text("Preview SQL")')
await page.waitForTimeout(800)
const previewText = await page.locator('.modal').last().innerText()
check('Preview SQL shows ALTER TABLE … ADD FOREIGN KEY', /ALTER TABLE public\.tools_child ADD FOREIGN KEY \(parent_id\) REFERENCES public\.tools_parent \(id\) ON UPDATE NO ACTION ON DELETE CASCADE;/.test(previewText), previewText)
await page.locator('.modal .btn-close').last().click()
await page.click('.modal .btn-primary')
check('the relationship is created', /relationship has been created/.test(await notice(page)))
await clearNotices(page)
const fk = psql("SELECT conname FROM pg_constraint WHERE conrelid = 'public.tools_child'::regclass AND contype = 'f'")
check('the foreign key exists with ON DELETE CASCADE', fk !== '' && psql(`SELECT confdeltype FROM pg_constraint WHERE conname = '${fk}'`) === 'c', fk)
await settle(page)
const line = page.locator('#relations g.relation', { has: page.locator('title', { hasText: fk }) })
await line.locator('path').first().dispatchEvent('click')
await page.waitForSelector('.modal .btn-danger')
await shot(page, 'database/designer-drop-relation.png', { selector: '.modal-content' })
await page.click('.modal .btn-danger')
check('clicking a line drops its relationship', /has been dropped/.test(await notice(page)) && psql("SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.tools_child'::regclass AND contype = 'f'") === '0')
await clearNotices(page)

// Export: SVG, PNG and SQL downloads, with every box shown (reviews and its row security policy too).
for (const [format, ext] of [['svg', 'svg'], ['png', 'png'], ['sql', 'sql']]) {
  await page.click(menu('exportPages'))
  await page.selectOption('.modal #plugins', format)
  if (format === 'svg') await shot(page, 'database/designer-export.png', { selector: '.modal-content' })
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('.modal .btn-primary')])
  const file = path.join(dir, dl.suggestedFilename())
  await dl.saveAs(file)
  const bytes = fs.readFileSync(file)
  const ok = { svg: () => bytes.toString().startsWith('<svg') || bytes.toString().includes('<svg'), png: () => bytes.subarray(1, 4).toString() === 'PNG', sql: () => /CREATE TABLE IF NOT EXISTS public\.books/.test(bytes.toString()) && /CREATE POLICY \S+\s+ON public\.reviews/.test(bytes.toString()) && bytes.toString().indexOf('CREATE TABLE IF NOT EXISTS public.authors') < bytes.toString().indexOf('CREATE TABLE IF NOT EXISTS public.books') }[format]()
  check(`Export schema as ${format}: ${dl.suggestedFilename()}`, ok && dl.suggestedFilename() === `bookshop-Untitled.${ext}`, bytes.length)
  await page.waitForTimeout(300)
}
await close()

// The Create table button opens the create-table page of public.
{
  const { page: p, close: c } = await open(route)
  await p.waitForSelector(menu('StartTableNew'))
  await p.click(menu('StartTableNew'))
  await settle(p)
  check('Create table opens the schema create-table page', /\/db\/bookshop\/schema\/public\/create-table/.test(p.url()), p.url())
  await c()
}

// Clip: drag two boxes, snap to grid, fold one.
await record('database/designer-move.mp4', route, async (p) => {
  await p.waitForSelector(box('public.books'))
  await p.waitForTimeout(1200)
  const drag = async (key, dx, dy) => {
    const b = await p.locator(`${box(key)} .tab_zag`).boundingBox()
    await p.mouse.move(b.x + 20, b.y + b.height / 2)
    await p.mouse.down()
    for (let i = 1; i <= 25; i++) {
      await p.mouse.move(b.x + 20 + (dx * i) / 25, b.y + b.height / 2 + (dy * i) / 25)
      await p.waitForTimeout(30)
    }
    await p.mouse.up()
    await p.waitForTimeout(700)
  }
  await drag('public.authors', 160, 60)
  await drag('public.publishers', -120, 120)
  await p.click(menu('grid_button'))
  await p.waitForTimeout(700)
  await drag('public.reviews', 100, -80)
  await p.click(`${box('public.books')} .small_tab`)
  await p.waitForTimeout(900)
  await p.click(`${box('public.books')} .small_tab`)
  await p.waitForTimeout(600)
  await p.click(menu('angular_direct_button'))
  await p.waitForTimeout(1200)
})

psql('DROP TABLE IF EXISTS public.tools_child, public.tools_parent')
fs.rmSync(dir, { recursive: true, force: true })
summary()
await done()
