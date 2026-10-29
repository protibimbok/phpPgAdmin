import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import type { Dependency } from '@/nodes/client'

export interface DependencyPanelProps {
  /** What the object depends on, and what depends on it: a node collection's dependencies(oid) and dependents(oid). */
  dependencies: () => Promise<Dependency[]>
  dependents: () => Promise<Dependency[]>
  /** Reloads the lists when it changes: the object's identity. */
  reloadKey: string
}

/**
 * pgAdmin's Dependencies and Dependents tabs as two cards side by side: each object with its
 * type, name and the kind of dependency (normal, auto, internal, owner, ACL…), from
 * pg_depend through the node API.
 */
export default function DependencyPanel({ dependencies, dependents, reloadKey }: DependencyPanelProps) {
  const { t } = useTranslation()
  const { data, error } = useRequest(() => Promise.all([dependencies(), dependents()]), [reloadKey])

  return (
    <div className="row" id="dependency_panel">
      {(
        [
          ['dependencies', data?.[0]],
          ['dependents', data?.[1]],
        ] as const
      ).map(([kind, rows]) => (
        <div className="col-12 col-lg-6" key={kind}>
          <div className="card mb-3" id={kind}>
            <div className="card-header">{t(`dependency.${kind}`)}</div>
            <div className="card-body">
              {error ? (
                <div className="alert alert-danger mb-0" role="alert">
                  {error.message}
                </div>
              ) : rows === undefined ? (
                t('loading')
              ) : rows.length === 0 ? (
                <div className="card-text">{t(`dependency.no_${kind}`)}</div>
              ) : (
                <table className="table table-striped table-hover w-auto mb-0">
                  <thead>
                    <tr>
                      <th>{t('dependency.type')}</th>
                      <th>{t('dependency.name')}</th>
                      <th>{t('dependency.restriction')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        <td className="text-nowrap">
                          {row.icon && <Icon name={row.icon} />} {typeLabel(row.type, t)}
                        </td>
                        <td>{row.name}</td>
                        <td>{row.field}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** A dependency's type as pgAdmin labels it: "foreign_key" is "Foreign key". */
function typeLabel(type: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (type === '') return ''
  const fallback = type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')

  return t(`dependency.types.${type}`, { defaultValue: fallback })
}
