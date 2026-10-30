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

/**
 * A geometry read from (E)WKB: its type code (1 Point … 7 GeometryCollection, 8 CircularString,
 * 9 CompoundCurve, 10 CurvePolygon, 11 MultiCurve, 12 MultiSurface, 15 PolyhedralSurface,
 * 16 TIN, 17 Triangle), its Z and M, and either its coordinates (a point, a curve's points,
 * a polygon's or triangle's rings) or its members (a collection's geometries, a compound
 * curve's segments, a curve polygon's rings).
 */
interface Wkb {
  type: number
  z: boolean
  m: boolean
  coords?: number[][]
  rings?: number[][][]
  parts?: Wkb[]
}

/** The types whose WKB is a count of whole geometries, each with its own header. */
const WITH_PARTS = new Set([4, 5, 6, 7, 9, 10, 11, 12, 15, 16])

/** A hex (E)WKB value read into its geometry and SRID; throws when it cannot be read. */
function readWkb(hex: string): { geometry: Wkb; srid: number | null } {
  const clean = hex.trim()
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) throw new Error('not hex')
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
  const view = new DataView(bytes.buffer)
  let offset = 0
  let srid: number | null = null

  function read(depth: number): Wkb {
    if (depth > 64) throw new Error('nested too deep')
    const little = view.getUint8(offset) === 1
    offset += 1
    const u32 = () => {
      const v = view.getUint32(offset, little)
      offset += 4
      return v
    }
    // A count can be no larger than what is left to read, so a broken value fails at once.
    const count = (size: number) => {
      const n = u32()
      if (n * size > view.byteLength - offset) throw new Error('count past the end')
      return n
    }
    const f64 = () => {
      const v = view.getFloat64(offset, little)
      offset += 8
      return v
    }
    let type = u32()
    // EWKB flags: Z, M and SRID; ISO WKB adds 1000 for Z, 2000 for M, 3000 for ZM.
    let z = Boolean(type & 0x80000000)
    let m = Boolean(type & 0x40000000)
    if (type & 0x20000000) srid = u32()
    type &= 0x0fffffff
    if (type > 1000) {
      const flag = Math.floor(type / 1000)
      z ||= flag === 1 || flag === 3
      m ||= flag === 2 || flag === 3
      type %= 1000
    }
    const dims = 2 + (z ? 1 : 0) + (m ? 1 : 0)
    const point = () => Array.from({ length: dims }, f64)
    const points = () => Array.from({ length: count(dims * 8) }, point)
    switch (type) {
      case 1:
        return { type, z, m, coords: [point()] }
      case 2:
      case 8:
        return { type, z, m, coords: points() }
      case 3:
      case 17:
        return { type, z, m, rings: Array.from({ length: count(4) }, points) }
    }
    if (WITH_PARTS.has(type)) return { type, z, m, parts: Array.from({ length: count(9) }, () => read(depth + 1)) }
    throw new Error(`WKB type ${type}`)
  }

  const geometry = read(0)

  return { geometry, srid }
}

/** Whether a point is POINT EMPTY, which WKB writes as NaN coordinates. */
const isEmptyPoint = (coords: number[]) => coords.every((v) => Number.isNaN(v))

/** A curve's points in order: a compound curve's segments joined where they meet. */
function curvePoints(g: Wkb): XY[] {
  if (g.coords) return g.coords.map(([x, y]) => [x, y])
  const out: XY[] = []
  for (const part of g.parts ?? []) {
    const p = curvePoints(part)
    out.push(...(out.length > 0 && p.length > 0 && out[out.length - 1][0] === p[0][0] && out[out.length - 1][1] === p[0][1] ? p.slice(1) : p))
  }
  return out
}

/**
 * A geometry's shapes for drawing. The curved types are drawn through their control points: a
 * circular arc as the straight lines between its start, middle and end points, which is an
 * approximation of the arc, not the arc itself.
 */
function shapesOf(g: Wkb, shapes: Shape[]): void {
  switch (g.type) {
    case 1:
      if (!isEmptyPoint(g.coords![0])) shapes.push({ kind: 'point', at: [g.coords![0][0], g.coords![0][1]] })
      return
    case 2:
    case 8:
    case 9: {
      const points = curvePoints(g)
      if (points.length > 0) shapes.push({ kind: 'line', points, closed: false })
      return
    }
    case 3:
    case 17: {
      const rings = g.rings!.filter((r) => r.length > 0).map((r) => r.map(([x, y]): XY => [x, y]))
      if (rings.length > 0) shapes.push({ kind: 'polygon', rings })
      return
    }
    case 10: {
      const rings = g.parts!.map(curvePoints).filter((r) => r.length > 0)
      if (rings.length > 0) shapes.push({ kind: 'polygon', rings })
      return
    }
  }
  for (const part of g.parts ?? []) shapesOf(part, shapes)
}

/** A PostGIS value as it is output, hex (E)WKB; null when it cannot be read. */
export function parseEwkb(hex: string): Shape[] | null {
  try {
    const shapes: Shape[] = []
    shapesOf(readWkb(hex).geometry, shapes)
    return shapes
  } catch {
    return null
  }
}

/** A spatial value of a column of the given type; null for NULL or a value that cannot be read. */
export function parseSpatial(type: string, value: string | null): Shape[] | null {
  if (value === null) return null
  const bare = type.replace(/^.*\./, '').replace(/^"|"$/g, '')
  return bare === 'geometry' || bare === 'geography' ? parseEwkb(value) : parseGeometric(bare, value)
}

const finite = ([x, y]: XY) => Number.isFinite(x) && Number.isFinite(y)

/**
 * The shapes without the points that cannot be drawn: a coordinate that is NaN or infinite
 * (PostgreSQL's geometric types and WKB both hold them). A line or ring keeps its other points;
 * a shape left with none is dropped. "skipped" counts the points left out.
 */
export function drawable(shapes: Shape[]): { shapes: Shape[]; skipped: number } {
  let skipped = 0
  const keep = (points: XY[]) => {
    const kept = points.filter(finite)
    skipped += points.length - kept.length
    return kept
  }
  const out: Shape[] = []
  for (const s of shapes) {
    if (s.kind === 'point' || s.kind === 'circle') {
      if (finite(s.at) && (s.kind === 'point' || (Number.isFinite(s.r) && Number.isFinite(s.at[0] - s.r) && Number.isFinite(s.at[0] + s.r) && Number.isFinite(s.at[1] - s.r) && Number.isFinite(s.at[1] + s.r)))) out.push(s)
      else skipped++
    } else if (s.kind === 'line') {
      const points = keep(s.points)
      if (points.length > 0) out.push({ ...s, points })
    } else {
      const rings = s.rings.map(keep).filter((ring) => ring.length > 0)
      if (rings.length > 0) out.push({ ...s, rings })
    }
  }
  return { shapes: out, skipped }
}

/** The smallest box around the shapes: [minX, minY, maxX, maxY], null when there is nothing. */
export function bounds(shapes: Shape[]): [number, number, number, number] | null {
  let box: [number, number, number, number] | null = null
  const add = ([x, y]: XY, r = 0) => {
    if (![x, y, x - r, y - r, x + r, y + r].every(Number.isFinite)) return
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

const WKT_NAMES: Record<number, string> = {
  1: 'POINT',
  2: 'LINESTRING',
  3: 'POLYGON',
  4: 'MULTIPOINT',
  5: 'MULTILINESTRING',
  6: 'MULTIPOLYGON',
  7: 'GEOMETRYCOLLECTION',
  8: 'CIRCULARSTRING',
  9: 'COMPOUNDCURVE',
  10: 'CURVEPOLYGON',
  11: 'MULTICURVE',
  12: 'MULTISURFACE',
  15: 'POLYHEDRALSURFACE',
  16: 'TIN',
  17: 'TRIANGLE',
}

/**
 * The members a type writes without their tag, as PostGIS's ST_AsText does: a multi-point's
 * points, a compound curve's, curve polygon's and multi-curve's line strings, a multi-surface's
 * and polyhedral surface's polygons, a TIN's triangles. Any other member (a circular string in
 * a compound curve, every member of a collection) is written tagged, "CIRCULARSTRING(…)".
 */
const UNTAGGED: Record<number, number[]> = { 4: [1], 5: [2], 6: [3], 9: [2], 10: [2], 11: [2], 12: [3], 15: [3], 16: [17] }

/**
 * A PostGIS value's hex (E)WKB as Well Known Text, with its SRID as EWKT writes it
 * ("SRID=4326;POINT(1 2)"); null when it cannot be read. Z and M are kept, and an empty
 * geometry or member is written as the OGC grammar has it: "LINESTRING EMPTY",
 * "MULTIPOINT(EMPTY,(1 2))", "GEOMETRYCOLLECTION(POINT EMPTY)".
 */
export function ewkbToWkt(hex: string): string | null {
  const num = (v: number) => String(Number.isInteger(v) ? v : Number(v.toPrecision(15)))
  const point = (coords: number[]) => coords.map(num).join(' ')
  const list = (points: number[][]) => (points.length === 0 ? 'EMPTY' : `(${points.map(point).join(',')})`)

  /** The text after the tag: "(1 2)", "((0 0,1 0,1 1,0 0))", "EMPTY". */
  function body(g: Wkb): string {
    switch (g.type) {
      case 1:
        return isEmptyPoint(g.coords![0]) ? 'EMPTY' : `(${point(g.coords![0])})`
      case 2:
      case 8:
        return list(g.coords!)
      case 3:
      case 17:
        return g.rings!.length === 0 ? 'EMPTY' : `(${g.rings!.map(list).join(',')})`
    }
    const parts = g.parts!
    if (parts.length === 0) return 'EMPTY'
    const untagged = UNTAGGED[g.type] ?? []

    return `(${parts.map((p) => (untagged.includes(p.type) ? body(p) : tagged(p))).join(',')})`
  }

  /** "POINT(1 2)", "POINT Z (1 2 3)", "POINT EMPTY", "LINESTRING M EMPTY". */
  function tagged(g: Wkb): string {
    const name = WKT_NAMES[g.type]
    if (name === undefined) throw new Error(`WKB type ${g.type}`)
    const suffix = g.z && g.m ? ' ZM' : g.z ? ' Z' : g.m ? ' M' : ''
    const text = body(g)

    return text === 'EMPTY' || suffix !== '' ? `${name}${suffix} ${text}` : `${name}${text}`
  }

  try {
    const { geometry, srid } = readWkb(hex)
    return `${srid !== null ? `SRID=${srid};` : ''}${tagged(geometry)}`
  } catch {
    return null
  }
}

/** The geometry's kind, "POINT", from its hex (E)WKB; null when it cannot be read. */
export function ewkbKind(hex: string): string | null {
  const wkt = ewkbToWkt(hex)
  return wkt === null ? null : (wkt.replace(/^SRID=\d+;/, '').match(/^[A-Z]+/)?.[0] ?? null)
}
