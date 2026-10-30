/**
 * The statements of a batch with where each one sits, split as the server's Splitter splits
 * them: 'strings' (E'' with backslash escapes), "identifiers", $tag$ dollar quotes $tag$,
 * -- line comments and nested block comments never end a statement.
 */
export interface StatementRange {
  /** The statement's text, trimmed, without its delimiter. */
  sql: string
  /** Where the trimmed text starts and ends in the batch. */
  from: number
  to: number
  /** Where the statement's delimiter ends (to, when there is none). */
  end: number
}

const DOLLAR_TAG = /\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y

/** The index just past the quoted text or comment starting at i; null when none starts there. */
function skipQuotedOrComment(text: string, i: number): number | null {
  const c = text[i]
  const length = text.length

  if (c === "'") {
    const before = text[i - 1]
    const twoBefore = text[i - 2]
    const escapes = (before === 'E' || before === 'e') && (twoBefore === undefined || !/[A-Za-z0-9_]/.test(twoBefore))
    let j = i + 1
    while (j < length) {
      if (escapes && text[j] === '\\') {
        j += 2
        continue
      }
      if (text[j] === "'") {
        if (text[j + 1] === "'") {
          j += 2
          continue
        }

        return j + 1
      }
      j++
    }

    return length
  }

  if (c === '"') {
    let j = i + 1
    while (j < length) {
      if (text[j] === '"') {
        if (text[j + 1] === '"') {
          j += 2
          continue
        }

        return j + 1
      }
      j++
    }

    return length
  }

  if (c === '$') {
    DOLLAR_TAG.lastIndex = i
    const match = DOLLAR_TAG.exec(text)
    if (match) {
      const end = text.indexOf(match[0], i + match[0].length)

      return end === -1 ? length : end + match[0].length
    }

    return null
  }

  if (c === '-' && text[i + 1] === '-') {
    const end = text.indexOf('\n', i)

    return end === -1 ? length : end + 1
  }

  if (c === '/' && text[i + 1] === '*') {
    let depth = 1
    let j = i + 2
    while (j < length && depth > 0) {
      if (text[j] === '/' && text[j + 1] === '*') {
        depth++
        j += 2
      } else if (text[j] === '*' && text[j + 1] === '/') {
        depth--
        j += 2
      } else {
        j++
      }
    }

    return j
  }

  return null
}

/** Whether the chunk holds anything but whitespace and comments. */
function hasCode(chunk: string): boolean {
  let i = 0
  while (i < chunk.length) {
    const skipped = chunk[i] === '-' || chunk[i] === '/' ? skipQuotedOrComment(chunk, i) : null
    if (skipped !== null) {
      i = skipped
      continue
    }
    if (!/\s/.test(chunk[i])) return true
    i++
  }

  return false
}

export function splitStatements(text: string, delimiter = ';'): StatementRange[] {
  const delim = delimiter === '' ? ';' : delimiter
  const statements: StatementRange[] = []
  const push = (from: number, to: number, end: number) => {
    const raw = text.slice(from, to)
    if (!hasCode(raw)) return
    const lead = raw.length - raw.trimStart().length
    const sql = raw.trim()
    statements.push({ sql, from: from + lead, to: from + lead + sql.length, end })
  }

  let start = 0
  let i = 0
  while (i < text.length) {
    const skipped = skipQuotedOrComment(text, i)
    if (skipped !== null) {
      i = skipped
      continue
    }
    if (text.startsWith(delim, i)) {
      push(start, i, i + delim.length)
      i += delim.length
      start = i
      continue
    }
    i++
  }
  push(start, text.length, text.length)

  return statements
}

/**
 * The statement the cursor is in, as pgAdmin's "Execute query" picks it: the one whose text
 * or delimiter holds the position, else the last one before it on the same stretch of text
 * (the cursor after a statement's semicolon), else the next one.
 */
export function statementAt(text: string, pos: number, delimiter = ';'): StatementRange | null {
  const statements = splitStatements(text, delimiter)
  if (statements.length === 0) return null
  const inside = statements.find((s) => pos >= s.from && pos <= s.end)
  if (inside) return inside
  const before = [...statements].reverse().find((s) => s.end <= pos)
  // A blank line between the statement and the cursor ends it, as it does for pgAdmin.
  if (before && !/\n\s*\n/.test(text.slice(before.end, pos))) return before

  return statements.find((s) => s.from >= pos) ?? before ?? null
}

/** The UTF-16 index of the n-th code point of the text (0-based), which is how the server counts. */
export function codePointOffset(text: string, codePoints: number): number {
  let units = 0
  let seen = 0
  for (const ch of text) {
    if (seen >= codePoints) break
    units += ch.length
    seen++
  }

  return units + Math.max(0, codePoints - seen)
}
