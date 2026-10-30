import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { imageUri } from './images'
import { nodeProperties, propertyText, P_HEIGHT, P_WIDTH, X_MARGIN, Y_MARGIN, type PlanAnalysis, type PlanNode } from './plan'

// pgAdmin's Graphical.jsx constants.
const IMAGE_WIDTH = 50
const IMAGE_HEIGHT = 50
const ARROW_WIDTH = 10
const ARROW_HEIGHT = 10
const TXT_ALIGN = 5
const TXT_SIZE = 15
const LABEL_WIDTH = 150
const MIN_ZOOM = 0.3
const MAX_ZOOM = 2
const ZOOM_STEP = 0.05

export interface GraphicalProps {
  analysis: PlanAnalysis
  onDownload: (kind: 'svg' | 'png' | 'json', svg: SVGSVGElement | null) => void
}

/**
 * pgAdmin's Graphical tab: the plan drawn right to left, the root on the right and each child
 * a column further left, joined to its parent by an arrow as wide as the rows it hands up. An
 * icon's backdrop is shaded by the node's share of the time (or of the cost). Hovering a node
 * shows its properties; a click opens them in the panel on the right. Zoom in, back to the
 * original size, out, and download the drawing or the plan.
 */
export default function Graphical({ analysis, onDownload }: GraphicalProps) {
  const { t } = useTranslation('sql')
  const container = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [selected, setSelected] = useState<PlanNode | null>(null)

  // As pgAdmin does, a plan wider than the panel is scaled down to fit, to no less than 30%.
  useLayoutEffect(() => {
    const width = container.current?.offsetWidth ?? 0
    if (width > 0 && analysis.width > 0) setZoom(Math.min(1, Math.max(MIN_ZOOM, width / analysis.width)))
    setSelected(null)
  }, [analysis])

  return (
    <div className="explain-graphical">
      <div className="explain-toolbar btn-toolbar mb-2" role="toolbar">
        <div className="btn-group me-2" role="group">
          <button type="button" className="btn btn-secondary btn-sm" title={t('explain.zoom_in')} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}>
            <Icon name="b_plus" /> {t('explain.zoom_in')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" title={t('explain.zoom_original')} onClick={() => setZoom(1)}>
            {t('explain.zoom_original')}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" title={t('explain.zoom_out')} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}>
            <Icon name="b_minus" /> {t('explain.zoom_out')}
          </button>
        </div>
        <div className="btn-group" role="group">
          <button type="button" className="btn btn-secondary btn-sm" id="explain_download_svg" onClick={() => onDownload('svg', svg.current)}>
            <Icon name="b_save" /> SVG
          </button>
          <button type="button" className="btn btn-secondary btn-sm" id="explain_download_png" onClick={() => onDownload('png', svg.current)}>
            <Icon name="b_save" /> PNG
          </button>
          <button type="button" className="btn btn-secondary btn-sm" id="explain_download_json" onClick={() => onDownload('json', null)}>
            <Icon name="b_save" /> JSON
          </button>
        </div>
      </div>
      <div className="explain-canvas" ref={container}>
        <PlanSvg ref={svg} analysis={analysis} zoom={zoom} selected={selected} onNodeClick={setSelected} />
        {selected && <NodeDetails node={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}

interface PlanSvgProps {
  analysis: PlanAnalysis
  zoom: number
  selected: PlanNode | null
  onNodeClick: (node: PlanNode) => void
}

const PlanSvg = forwardRef<SVGSVGElement, PlanSvgProps>(function PlanSvg({ analysis, zoom, selected, onNodeClick }, ref) {
  const { t } = useTranslation('sql')
  const arrows = analysis.nodes.filter((n) => n.serial !== analysis.root.serial)
  // The arrowheads' ids are the page's: each plan card (a batch of EXPLAINs) has its own.
  const markers = `explain_arrow_${useId().replace(/[^A-Za-z0-9]/g, '')}_`

  return (
    <svg
      ref={ref}
      className="explain-svg"
      xmlns="http://www.w3.org/2000/svg"
      version="1.1"
      width={analysis.width * zoom}
      height={analysis.height * zoom}
      role="img"
      aria-label={t('explain.graphical')}
    >
      <defs>
        {arrows.map((node) => (
          <marker key={node.serial} id={`${markers}${node.serial}`} viewBox={`0 0 ${2 * ARROW_WIDTH} ${2 * ARROW_HEIGHT}`} markerWidth={ARROW_WIDTH} markerHeight={ARROW_HEIGHT} orient="auto" refX="0" refY={ARROW_WIDTH / 4}>
            <polygon className="explain-arrowhead" points={[0, 0, 0, ARROW_WIDTH / 2, ARROW_HEIGHT, ARROW_WIDTH / 4, 0, 0].join(',')} />
          </marker>
        ))}
      </defs>
      <g transform={`matrix(${zoom},0,0,${zoom},0,0)`}>
        <rect className="explain-surface" x={0} y={0} width={analysis.width} height={analysis.height} rx={5} ry={5} />
        <PlanContent node={analysis.root} originX={analysis.width - X_MARGIN} originY={Y_MARGIN} selected={selected} markers={markers} onNodeClick={onNodeClick} />
      </g>
    </svg>
  )
})

interface PlanContentProps {
  node: PlanNode
  originX: number
  originY: number
  parent?: { x: number; y: number }
  selected: PlanNode | null
  /** The prefix of the arrowheads' marker ids. */
  markers: string
  onNodeClick: (node: PlanNode) => void
}

/** pgAdmin's PlanContent: a node's subplan frame, icon, label and the arrow to its parent, then its children. */
function PlanContent({ node, originX, originY, parent, selected, markers, onNodeClick }: PlanContentProps) {
  const x = originX + node.xpos
  const y = originY + node.ypos
  const isSubPlan = node.raw['Parent Relationship'] === 'SubPlan'
  const tooltip = `${node.label}\n${nodeProperties(node.raw).map(([key, value]) => `${key}: ${propertyText(value)}`).join('\n')}`

  return (
    <>
      <g className="explain-node" data-serial={node.serial}>
        {isSubPlan && (
          <>
            {/* The subplan's own box: pgAdmin's frame grows with the node's distance from the top, which overshoots the drawing. */}
            <rect className="explain-subplan" x={x - node.width + P_WIDTH + X_MARGIN} y={y - Y_MARGIN} width={node.width - X_MARGIN} height={node.height} rx={5} pointerEvents="none" />
            <text className="explain-subplan-name" x={x + P_WIDTH + X_MARGIN - node.width / 2} y={y - Y_MARGIN + TXT_SIZE + TXT_ALIGN} fontSize={TXT_SIZE} textAnchor="middle">
              {String(node.raw['Subplan Name'] ?? '')}
            </text>
          </>
        )}
        <rect
          className={`explain-shade explain-sev${node.shade ?? 1}${selected === node ? ' explain-selected' : ''}`}
          x={x + (P_WIDTH - IMAGE_WIDTH) / 2 - 6}
          y={y + (P_HEIGHT - IMAGE_HEIGHT) / 2 - 6}
          width={IMAGE_WIDTH + 12}
          height={IMAGE_HEIGHT + 12}
          rx={6}
        />
        <image
          href={imageUri(node.image)}
          preserveAspectRatio="none"
          x={x + (P_WIDTH - IMAGE_WIDTH) / 2}
          y={y + (P_HEIGHT - IMAGE_HEIGHT) / 2}
          width={IMAGE_WIDTH}
          height={IMAGE_HEIGHT}
          className="explain-icon"
          onClick={() => onNodeClick(node)}
        >
          <title>{tooltip}</title>
        </image>
        <MultiText x={x + P_WIDTH / 2 + TXT_ALIGN} y={y + P_HEIGHT - TXT_ALIGN} label={node.label} />
        {parent && <PolyLine startX={x + P_WIDTH} startY={y + P_HEIGHT / 2} endX={parent.x - ARROW_WIDTH} endY={parent.y + P_HEIGHT / 2} width={node.arrowSize + 2} marker={`${markers}${node.serial}`} />}
      </g>
      {node.children.map((child) => (
        <PlanContent key={child.serial} node={child} originX={originX} originY={originY} parent={{ x, y }} selected={selected} markers={markers} onNodeClick={onNodeClick} />
      ))}
    </>
  )
}

/** pgAdmin's three-segment arrow: across, slanted to the parent's height, across into the arrowhead. */
function PolyLine({ startX, startY, endX, endY, width, marker }: { startX: number; startY: number; endX: number; endY: number; width: number; marker: string }) {
  const mid1 = startX + (endX - startX) / 3
  const mid2 = startX + (2 * (endX - startX)) / 3

  return (
    <>
      <line className="explain-arrow" x1={startX} x2={mid1} y1={startY} y2={startY} strokeWidth={width} />
      <line className="explain-arrow" x1={mid1 - 1} x2={mid2} y1={startY} y2={endY} strokeWidth={width} />
      <line className="explain-arrow" x1={mid2} x2={endX} y1={endY} y2={endY} strokeWidth={width} markerEnd={`url(#${marker})`} />
    </>
  )
}

let measure: CanvasRenderingContext2D | null | undefined

/** The width of a letter at the label's size, measured as pgAdmin's Multitext does, in the page's font. */
function letterWidth(): number {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (measure === undefined) measure = document.createElement('canvas').getContext('2d')
  if (!measure) return TXT_SIZE * 0.55
  measure.font = `${TXT_SIZE}px ${getComputedStyle(document.body).fontFamily}`

  return measure.measureText(abc).width / abc.length
}

/** pgAdmin's Multitext: the label broken into lines of at most 150px, a long word cut with a hyphen. */
function MultiText({ x, y, label }: { x: number; y: number; label: string }) {
  const [lines, setLines] = useState<string[]>([label])
  useEffect(() => setLines(wrap(label, LABEL_WIDTH, letterWidth())), [label])

  return (
    <text className="explain-label" x={x} y={y} fontSize={TXT_SIZE} textAnchor="middle">
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i > 0 ? '1.2em' : undefined}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

export function wrap(label: string, maxWidth: number, letter: number): string[] {
  const breakAt = Math.max(1, Math.round(maxWidth / letter) - 1)
  const split = (leading: string, soFar: number, word: string): string[] => {
    if (word.length === 0) return []
    if (soFar && soFar + word.length * letter > maxWidth) return [leading, ...split('', 0, word)]
    if (soFar) return [`${leading} ${word}`]
    const out: string[] = leading ? [leading] : []
    if (word.length > breakAt + 1) return [...out, `${word.slice(0, breakAt)}-`, ...split('', 0, word.slice(breakAt))]

    return [...out, word]
  }
  let lines: string[] = []
  let current = ''
  let width = 0
  for (const word of label.split(' ')) {
    const next = split(current, width, word)
    if (current) lines = lines.slice(0, -1)
    lines = [...lines, ...next]
    current = lines[lines.length - 1] ?? ''
    width = current.length * letter
  }

  return lines
}

/** pgAdmin's details card: every property of the clicked node. */
function NodeDetails({ node, onClose }: { node: PlanNode; onClose: () => void }) {
  const { t } = useTranslation('sql')

  return (
    <div className="explain-details card" data-label="explain-details">
      <div className="card-header d-flex align-items-center">
        <span className="me-2">{node.label}</span>
        <a href="#close" className="ms-auto" title={t('explain.close')} onClick={(e) => { e.preventDefault(); onClose() }}>
          <Icon name="b_close" title={t('explain.close')} />
        </a>
      </div>
      <div className="card-body">
        <table className="table table-sm table-striped mb-0">
          <tbody>
            {nodeProperties(node.raw).map(([key, value]) => (
              <tr key={key}>
                <th scope="row">{key}</th>
                <td>{propertyText(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
