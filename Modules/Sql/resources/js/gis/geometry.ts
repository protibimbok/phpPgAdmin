/**
 * The shapes of a spatial value, for the GIS visualization: PostgreSQL's built-in geometric
 * types read from their text output, and PostGIS geometry and geography from the hex EWKB they
 * are output as. Everything is read in the browser, so no extension and no library is needed.
 */

export type XY = [number, number]

export type Shape =
  | { kind: 'point'; at: XY }
  | { kind: 'line'; points: XY[]; closed: boolean }
  | { kind: 'polygon'; rings: XY[][] }
  | { kind: 'circle'; at: XY; r: number }

/** The column types the visualization can draw. */
export const SPATIAL_TYPES = ['point', 'lseg', 'box', 'path', 'polygon', 'circle', 'geometry', 'geography'] as const

export function isSpatialType(type: string | null | undefined): boolean {
  return (SPATIAL_TYPES as readonly string[]).includes((type ?? '').replace(/^.*\./, '').replace(/^"|"$/g, ''))
}

/** The numbers of a geometric value's text, in pairs: "((1,2),(3,4))" → [[1,2],[3,4]]. */
function pairs(text: string): XY[] {
  const numbers = (text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?Infinity|NaN/g) ?? []).map(Number)
  const out: XY[] = []
  for (let i = 0; i + 1 < numbers.length; i += 2) out.push([numbers[i], numbers[i + 1]])
  return out
}

/** A value of one of the built-in geometric types, as PostgreSQL writes it; null when it is not one. */
export function parseGeometric(type: string, text: string): Shape[] | null {
  const value = text.trim()
  switch (type) {
    case 'point': {
      const p = pairs(value)
      return p.length === 1 ? [{ kind: 'point', at: p[0] }] : null
    }
    case 'lseg': {
      const p = pairs(value)
      return p.length === 2 ? [{ kind: 'line', points: p, closed: false }] : null
    }
    case 'box': {
      const p = pairs(value)
      if (p.length !== 2) return null
      const [[x1, y1], [x2, y2]] = p
      return [{ kind: 'polygon', rings: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]] }]
    }
    case 'path': {
      const p = pairs(value)
      // An open path is written in brackets, a closed one in parentheses.
      return p.length > 0 ? [{ kind: 'line', points: p, closed: value.startsWith('(') }] : null
    }
    case 'polygon': {
      const p = pairs(value)
      return p.length > 0 ? [{ kind: 'polygon', rings: [p] }] : null
    }
    case 'circle': {
      const numbers = (value.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number)
      return numbers.length === 3 ? [{ kind: 'circle', at: [numbers[0], numbers[1]], r: numbers[2] }] : null
    }
  }
  return null
}

/** A PostGIS value as it is output, hex (E)WKB; null when it cannot be read. */
export function parseEwkb(hex: string): Shape[] | null {
  const clean = hex.trim()
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) return null
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  const view = new DataView(bytes.buffer)
  let offset = 0
  try {
    const shapes: Shape[] = []
    read(shapes)
    return shapes
  } catch {
    return null
  }

  function read(shapes: Shape[]): void {
    const little = view.getUint8(offset) === 1
    offset += 1
    const u32 = () => {
      const v = view.getUint32(offset, little)
      offset += 4
      return v
    }
    const f64 = () => {
      const v = view.getFloat64(offset, little)
      offset += 8
      return v
    }
    let type = u32()
    // EWKB flags: Z, M and SRID; ISO WKB adds 1000 for Z, 2000 for M, 3000 for ZM.
    let dims = 2
    if (type & 0x80000000) dims++
    if (type & 0x40000000) dims++
    if (type & 0x20000000) u32()
    type &= 0x0fffffff
    if (type > 1000) {
      dims += Math.floor(type / 1000) === 3 ? 2 : 1
      type %= 1000
    }
    const point = (): XY => {
      const x = f64()
      const y = f64()
      for (let i = 2; i < dims; i++) f64()
      return [x, y]
    }
    const points = (): XY[] => Array.from({ length: u32() }, point)
    switch (type) {
      case 1: {
        const p = point()
        if (!Number.isNaN(p[0])) shapes.push({ kind: 'point', at: p })
        return
      }
      case 2:
        shapes.push({ kind: 'line', points: points(), closed: false })
        return
      case 3:
        shapes.push({ kind: 'polygon', rings: Array.from({ length: u32() }, points) })
        return
      case 4:
      case 5:
      case 6:
      case 7: {
        const n = u32()
        for (let i = 0; i < n; i++) read(shapes)
        return
      }
    }
    throw new Error(`WKB type ${type}`)
  }
}

/** A spatial value of a column of the given type; null for NULL or a value that cannot be read. */
export function parseSpatial(type: string, value: string | null): Shape[] | null {
  if (value === null) return null
  const bare = type.replace(/^.*\./, '').replace(/^"|"$/g, '')
  return bare === 'geometry' || bare === 'geography' ? parseEwkb(value) : parseGeometric(bare, value)
}

/** The smallest box around the shapes: [minX, minY, maxX, maxY], null when there is nothing. */
export function bounds(shapes: Shape[]): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null
  const add = ([x, y]: XY, r = 0) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    box = box === null ? [x - r, y - r, x + r, y + r] : [Math.min(box[0], x - r), Math.min(box[1], y - r), Math.max(box[2], x + r), Math.max(box[3], y + r)]
  }
  for (const s of shapes) {
    if (s.kind === 'point') add(s.at)
    else if (s.kind === 'circle') add(s.at, s.r)
    else if (s.kind === 'line') s.points.forEach((p) => add(p))
    else s.rings.forEach((ring) => ring.forEach((p) => add(p)))
  }
  return box
}
