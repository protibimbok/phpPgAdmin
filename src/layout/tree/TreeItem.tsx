import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import Icon from '@/components/Icon'
import { isTreeItemOpen, setTreeItemOpen } from './treeState'

export interface TreeItemProps {
  /** The item's place in the tree, "db/schemas/2200": the key its open state is remembered by. */
  path: string
  /** The text; the link points at `href`. */
  label: string
  href: string
  icon: string
  title?: string
  /** Whether the item may expand; `children` is rendered when it is open. */
  expandable?: boolean
  /** Called when the item is opened the first time, to load what it holds. */
  onExpand?: () => void
  /** The nested list, a <ul>. */
  children?: ReactNode
  /** The last item of its list has no connecting line below it. */
  last?: boolean
  /** Extra classes phpMyAdmin puts on the <li>: "database", "tableContainer subContainer", "new_database italics". Never "container": Bootstrap pads it. */
  className?: string
  /** The first item of the root list only: phpMyAdmin gives nested children no "first" class, as the item's own vertical segment is what joins it to its parent. */
  first?: boolean
}

/**
 * One item of phpMyAdmin's navigation tree (navigation/tree/node.twig): a block with the
 * connecting line and the expander, a block with the icon, the text, then the nested list
 * when the item is open. Whether it is open is remembered across reloads (treeState.ts).
 */
export default function TreeItem({ path, label, href, icon, title, expandable = false, onExpand, children, last = false, className, first = false }: TreeItemProps) {
  const [open, setOpen] = useState(() => expandable && isTreeItemOpen(path))
  const [loaded, setLoaded] = useState(open)

  function toggle() {
    const next = !open
    setOpen(next)
    setTreeItemOpen(path, next)
    if (next && !loaded) {
      setLoaded(true)
      onExpand?.()
    }
  }

  const classes = [className, first ? 'first' : null, last ? 'last' : null].filter(Boolean).join(' ')

  return (
    <li className={classes}>
      <div className="block">
        <i className={first ? 'first' : undefined} />
        {expandable ? (
          <a className="expander" href={href} onClick={(e) => { e.preventDefault(); toggle() }} aria-expanded={open} aria-label={label}>
            <Icon name={open ? 'b_minus' : 'b_plus'} />
          </a>
        ) : null}
        {!last && <b />}
      </div>
      <div className="block second">
        <Link to={href}>
          <Icon name={icon} title={title ?? label} />
        </Link>
      </div>
      <Link className="hover_show_full" to={href} title={title ?? label}>
        {label}
      </Link>
      <div className="clearfloat" />
      {expandable && open && <div className="list_container">{children}</div>}
    </li>
  )
}
