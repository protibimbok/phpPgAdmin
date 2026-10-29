// Shared helpers for schema-objects*.mjs.
import { execFileSync } from 'node:child_process'
import { open } from '../capture.mjs'

/** Runs SQL on the docs cluster's bookshop database with psql. */
export function psql(sql, db = 'bookshop') {
  return execFileSync('psql', ['-h', process.env.DOCS_PG_HOST ?? 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', process.env.DOCS_PG_USER ?? 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atqc', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

/** Opens `route` signed in, retrying while the app is busy (it answers 503 under load). */
export async function openRetry(route) {
  for (let i = 0; ; i++) {
    try {
      return await open(route)
    } catch (e) {
      if (i > 4) throw e
      await new Promise((r) => setTimeout(r, 8000))
    }
  }
}
