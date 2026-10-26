import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import Icon from '@/components/Icon'
import { useTreeState } from './treeState'

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
  /** The nested list, a <ul>. */
  children?: ReactNode
  /** The last item of its list has no connecting line below it. */
  last?: boolean
  /** Extra classes phpMyAdmin puts on the <li>: "database", "tableContainer subContainer", "new_database italics". Never "container": Bootstrap pads it. */
  className?: string
  /** The first item of the root list only: phpMyAdmin gives nested children no "first" class, as the item's own vertical segment is what joins it to its parent. */
  first?: boolean
  /** The item the page shown is about: phpMyAdmin's li.selected. */
  selected?: boolean
  /** Open the item because the page shown is inside it ("Link with main panel"). */
  autoOpen?: boolean
}

/**
 * One item of phpMyAdmin's navigation tree (navigation/tree/node.twig): a block with the
 * connecting line and the expander, a block with the icon, the text, then the nested list
 * when the item is open. Whether it is open is remembered across pages (treeState.ts).
 */
export default function TreeItem({ path, label, href, icon, title, expandable = false, children, last = false, className, first = false, selected = false, autoOpen = false }: TreeItemProps) {
  const state = useTreeState()
  const open = expandable && state.isOpen(path)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    if (autoOpen && expandable) state.setOpen(path, true)
  }, [autoOpen, expandable, path, state])

  const classes = [className, first ? 'first' : null, last ? 'last' : null, selected ? 'selected' : null, hover ? 'activePointer' : null].filter(Boolean).join(' ')

  return (
    <li className={classes} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="block">
        <i className={first ? 'first' : undefined} />
        {expandable ? (
          <a className="expander" href={href} onClick={(e) => { e.preventDefault(); state.setOpen(path, !open) }} aria-expanded={open} aria-label={label}>
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
      {open && <div className="list_container">{children}</div>}
    </li>
  )
}
