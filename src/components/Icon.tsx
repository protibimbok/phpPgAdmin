export interface IconProps {
  /** The image's name under src/img/icons, "b_home". */
  name: string
  /** Shown as a tooltip and read by screen readers; without it the icon is decoration. */
  title?: string
  className?: string
}

/**
 * One of phpMyAdmin's 16px icons, drawn as a background image by the .ic_* classes in
 * src/styles/_icons.scss.
 */
export default function Icon({ name, title, className }: IconProps) {
  const classes = ['icon', `ic_${name}`, className].filter(Boolean).join(' ')

  return title ? (
    <span className={classes} role="img" aria-label={title} title={title} />
  ) : (
    <span className={classes} aria-hidden="true" />
  )
}
