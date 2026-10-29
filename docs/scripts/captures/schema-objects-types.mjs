// Screenshots for docs/schema/types.md and text-search.md.
//
//   node docs/scripts/captures/schema-objects-types.mjs
//
// The seed types, collation and book_search are only looked at; the scratch objects (rtn_*) are
// created here and dropped at the end, so the script can be rerun.
import { shot, settle, done, APP } from '../capture.mjs'
import { psql, openRetry } from './schema-objects-lib.mjs'

const SCHEMA = '/db/bookshop/schema/public'
const FTS = '#textSearchDialogModal'

async function go(page, route) {
  await page.goto(APP + route, { waitUntil: 'domcontentloaded' })
  await settle(page, 900)
}

const CLEANUP = `
DROP TYPE IF EXISTS public.rtn_mood;
DROP DOMAIN IF EXISTS public.rtn_pct;
DROP TEXT SEARCH CONFIGURATION IF EXISTS public.rtn_books_fts;
DROP TEXT SEARCH DICTIONARY IF EXISTS public.rtn_simple_dict;
`
psql(CLEANUP)
psql(`
CREATE TYPE public.rtn_mood AS ENUM ('low', 'high');
CREATE DOMAIN public.rtn_pct AS numeric(5, 2) DEFAULT 0 NOT NULL CONSTRAINT rtn_pct_range CHECK (VALUE BETWEEN 0 AND 100);
ALTER DOMAIN public.rtn_pct ADD CONSTRAINT rtn_pct_half CHECK (VALUE <= 50) NOT VALID;
CREATE TEXT SEARCH DICTIONARY public.rtn_simple_dict (TEMPLATE = simple, STOPWORDS = english, ACCEPT = false);
CREATE TEXT SEARCH CONFIGURATION public.rtn_books_fts (PARSER = default);
`)

const { page, close } = await openRetry(`${SCHEMA}/types`)
await shot(page, 'schema/types-list.png', { fullPage: true })

// Enum: a new label and a renamed one, before Go.
await go(page, `${SCHEMA}/types/type/rtn_mood/edit`)
await page.fill('input[name="item_label[1]"]', 'top')
await page.click('#addLabelButton')
await page.fill('input[name="item_label[2]"]', 'mid')
await shot(page, 'schema/types-enum-editor.png', { selector: 'form.rte_form' })

await go(page, `${SCHEMA}/types/domain/rtn_pct/edit`)
await shot(page, 'schema/types-domain-editor.png', { selector: 'form.rte_form' })

// The tree's link form: ?open=<node>:<name> opens the dialog.
await go(page, `${SCHEMA}/types?open=collation:case_insensitive`)
await page.waitForTimeout(800)
await shot(page, 'schema/types-collation-dialog.png', { selector: '#collationDialogModal .modal-content' })

// Text search: map three token types of the scratch configuration.
await go(page, `${SCHEMA}/types?open=fts_configuration:rtn_books_fts`)
await page.waitForTimeout(1200)
for (const [token, dictionaries] of [['asciiword', 'rtn_simple_dict, english_stem'], ['word', 'english_stem'], ['int', 'simple']]) {
  await page.click(`${FTS} button:has-text("Add mapping")`)
  const row = page.locator(`${FTS} #fts_tokens tbody tr`).last()
  await row.locator('select').selectOption(token)
  await row.locator('input').fill(dictionaries)
}
await shot(page, 'schema/text-search-mappings.png', { selector: `${FTS} .modal-content` })
await page.locator(`${FTS} button:has-text("Go")`).click()
await settle(page, 1500)

await go(page, `${SCHEMA}/sql?${new URLSearchParams({ sql: "SELECT to_tsvector('public.rtn_books_fts', 'The Running dogs ran 42 miles') AS scratch,\n       to_tsvector('english', 'The Running dogs ran 42 miles') AS english;", run: '1' })}`)
await settle(page, 1500)
await shot(page, 'schema/text-search-tsvector.png', { selector: '.sqlqueryresults, #sqlqueryresultsouter', pad: 4 })

await close()
psql(CLEANUP)
await done()
