// The PL/pgSQL debugger: screenshots and a clip for docs/tools/debugger.md, debugging
// public.apply_discount in bookshop (which has pldbgapi; the docs cluster preloads
// plugin_debugger). Run with: node docs/scripts/captures/tools-debugger.mjs
// apply_discount is IMMUTABLE and writes nothing; a scratch database tools_nodbg (without
// pldbgapi) shows what a database without the debugger offers, and is dropped at the end.

import { done, record, settle } from '../capture.mjs'
import { check, open, psql, shot, summary } from './tools-lib.mjs'

const oid = psql("SELECT 'public.apply_discount(numeric, numeric)'::regprocedure::oid")
const base = `/db/bookshop/schema/public/routines/function/${oid}`
const gutter = (line) => `#debugger_source tbody tr:nth-child(${line}) td:first-child`
const status = (page) => page.locator('#debugger_status').innerText()
const tab = (page, name) => page.click(`.nav-tabs a[href="#${name}"]`)
/** Waits until the toolbar answers again after a command. */
const idle = (page) => page.waitForFunction(() => !document.querySelector('#btn-stop')?.disabled, null, { timeout: 60000 })

// The routine editor's Debug link, and the arguments dialog.
{
  const { page, close } = await open(`${base}/edit`)
  check('the routine editor offers Debug', (await page.locator('#debug_routine').count()) === 1)
  await shot(page, 'tools/debugger-link.png', { selector: '#debug_routine', pad: 12 })
  await page.click('#debug_routine')
  await page.waitForSelector('#debugger_arguments')
  await settle(page)
  check('percent starts on its default', await page.isChecked('#debugger_arguments tbody tr:nth-child(2) input[aria-label="Use default?"]'))
  await page.fill('input[name=arg_0]', '80')
  await shot(page, 'tools/debugger-arguments.png', { selector: '#debugger form .card' })

  // The session: paused on the first statement.
  await page.click('#debug_start')
  await page.waitForSelector('#debugger_toolbar')
  await settle(page)
  check('the call stops at its first statement', /Paused at line 5 of apply_discount/.test(await status(page)), await status(page))
  check('the call is written with the values cast to their types', (await page.locator('#debugger p code').first().innerText()) === "SELECT * FROM public.apply_discount('80'::numeric)")

  // Step over, a breakpoint on RETURN, Continue to it.
  await page.click('#btn-step-over')
  await idle(page)
  check('Step over goes to the next statement', /line 8/.test(await status(page)), await status(page))
  await page.click(gutter(9))
  await idle(page)
  check('a click in the gutter sets a breakpoint', (await page.locator(`${gutter(9)} [aria-label=Breakpoint]`).count()) === 1)
  await page.click('#btn-continue')
  await idle(page)
  check('Continue stops at the breakpoint', /line 9/.test(await status(page)), await status(page))
  await tab(page, 'locals')
  await settle(page)
  const locals = await page.locator('#debugger_locals').innerText()
  check('Local variables shows result', /result\s+numeric\s+72\.00/.test(locals), locals)
  await shot(page, 'tools/debugger-session.png', { selector: '#debugger' })

  // Change a variable's value while paused.
  page.once('dialog', (d) => d.accept('1.23'))
  await page.click('#debugger_locals a:has-text("Change")')
  await idle(page)
  check('Change deposits a new value', /1\.23/.test(await page.locator('#debugger_locals').innerText()))
  await tab(page, 'stack')
  await settle(page)
  const stack = await page.locator('#debugger_stack').innerText()
  check('Stack lists the frame with its arguments', /apply_discount\(numeric,numeric\)\s+line \d+\s+price=80, percent=10/.test(stack), stack)
  // Known bug: the Stack tab takes one off a line number pldebugger already gives as the source's.
  check('Stack shows the line one less than where the call is paused (known bug)', /line 8/.test(stack), stack)
  await shot(page, 'tools/debugger-stack.png', { selector: '#debugger .nav-tabs + .card', pad: 4 })

  // Step over off the end: the result comes back once pldebugger lets the call go.
  const t0 = Date.now()
  await page.click('#btn-step-over')
  await page.waitForFunction(() => /ended/.test(document.querySelector('#debugger_status')?.textContent ?? ''), null, { timeout: 60000 })
  const seconds = (Date.now() - t0) / 1000
  await settle(page)
  const results = await page.locator('#debugger_results').innerText()
  check('the Results tab shows the value the changed variable returned', /apply_discount\s+1\.23/.test(results), results)
  console.log(`     (the call took ${seconds.toFixed(1)} s to end after the last step)`)
  await shot(page, 'tools/debugger-results.png', { selector: '#debugger' })
  await page.click('#btn-stop')
  await page.waitForSelector('#debugger_arguments')
  check('Close returns to the arguments dialog', true)
  await close()
}

// An error raised by the routine ends up in Messages.
{
  const { page, close } = await open(`${base}/debug`)
  await page.fill('input[name=arg_0]', '80')
  await page.uncheck('#debugger_arguments tbody tr:nth-child(2) input[aria-label="Use default?"]')
  await page.fill('input[name=arg_1]', '150')
  await page.click('#debug_start')
  await page.waitForSelector('#debugger_toolbar')
  await page.click('#btn-continue')
  await page.waitForFunction(() => /ended/.test(document.querySelector('#debugger_status')?.textContent ?? ''), null, { timeout: 60000 })
  await settle(page)
  const messages = await page.locator('#debugger_messages').innerText()
  check('an exception ends the call with an error in Messages', /The call ended with an error/.test(await status(page)) && /percent must be between 0 and 100, got 150/.test(messages), messages)
  await shot(page, 'tools/debugger-error.png', { selector: '#debugger' })
  await page.click('#btn-stop')
  await close()
}

// Stop while paused aborts the call; leaving the page stops the session too.
{
  const { page, close } = await open(`${base}/debug`)
  await page.fill('input[name=arg_0]', '10')
  await page.click('#debug_start')
  await page.waitForSelector('#debugger_toolbar')
  await page.click('#btn-stop')
  await page.waitForSelector('#debugger_arguments')
  await page.waitForTimeout(1500)
  const left = psql("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%apply_discount(''10''%' AND pid <> pg_backend_pid()")
  check('Stop ends the target session', left === '0', left)
  await close()
}

// A database without pldbgapi: no Debug link, and the page says why.
{
  psql('DROP DATABASE IF EXISTS tools_nodbg WITH (FORCE)', 'postgres')
  psql('CREATE DATABASE tools_nodbg', 'postgres')
  psql("CREATE FUNCTION public.tools_f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$", 'tools_nodbg')
  const f = psql("SELECT 'public.tools_f'::regproc::oid", 'tools_nodbg')
  const { page, close } = await open(`/db/tools_nodbg/schema/public/routines/function/${f}/edit`)
  check('no Debug link without pldbgapi', (await page.locator('#debug_routine').count()) === 0)
  await page.goto(page.url().replace(/\/edit$/, '/debug'))
  await settle(page)
  const reason = await page.locator('#debugger .alert').innerText()
  check('the debug page names the missing extension', /CREATE EXTENSION pldbgapi/.test(reason), reason)
  await shot(page, 'tools/debugger-unavailable.png', { selector: '#debugger .alert' })
  await close()
  psql('DROP DATABASE tools_nodbg WITH (FORCE)', 'postgres')
}

// The clip: arguments, Debug, step, a breakpoint, Continue, the variables.
await record('tools/debugger-session.mp4', `${base}/debug`, async (page) => {
  await page.waitForSelector('#debugger_arguments')
  await page.waitForTimeout(500)
  await page.click('input[name=arg_0]')
  await page.keyboard.type('80', { delay: 120 })
  await page.waitForTimeout(600)
  await page.click('#debug_start')
  await page.waitForSelector('#debugger_toolbar')
  await page.waitForTimeout(1500)
  await page.click('#btn-step-over')
  await idle(page)
  await page.waitForTimeout(1300)
  await page.click(gutter(9))
  await idle(page)
  await page.waitForTimeout(1300)
  await page.click('#btn-continue')
  await idle(page)
  await page.waitForTimeout(1200)
  await tab(page, 'locals')
  await page.waitForTimeout(1800)
  await tab(page, 'stack')
  await page.waitForTimeout(1800)
  await page.click('#btn-stop')
  await page.waitForTimeout(800)
})

summary()
await done()
