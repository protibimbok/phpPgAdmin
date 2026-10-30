import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { preference, preferenceDefinitions, preferenceGroups, savePreferences, useStoredPreferences, type PreferenceDefinition, type PreferenceValue } from '@/preferences'

/** phpMyAdmin's preferences pages, with the icons of its pills; Two-factor authentication has no counterpart. */
const PAGES = [
  { id: 'manage', icon: null },
  { id: 'features', icon: 'b_tblops' },
  { id: 'sql', icon: 'b_sql' },
  { id: 'navigation', icon: 'b_select' },
  { id: 'main-panel', icon: 'b_props' },
  { id: 'export', icon: 'b_export' },
  { id: 'import', icon: 'b_import' },
] as const

/**
 * Store settings, and have the navigation tree load its lists again when one of the Navigation
 * panel's settings changed ("Show system objects", the page sizes): the mounted tree reads
 * them only when it loads a list.
 */
async function saveSettings(values: Record<string, PreferenceValue | null>): Promise<void> {
  const navigation = preferenceDefinitions().filter((d) => d.page === 'navigation')
  const before = navigation.map((d) => preference(d.key))
  await savePreferences(values)
  if (navigation.some((d, i) => preference(d.key) !== before[i])) treeState.refresh()
}

/** Where "Save to browser's storage" keeps the settings. */
const STORAGE_KEY = 'phppgadmin.settings'

/**
 * The server's Settings tab, phpMyAdmin's user preferences: the pills of preferences/header.twig,
 * then either Manage your settings (import, export, reset) or a page of settings laid out like
 * config/form_display: a tab per group, each a fieldset of rows with the setting's name, its
 * description, its input and a "Restore default value" link, and Apply / Reset under them.
 */
export default function Settings() {
  const { t } = useTranslation('settings')
  const page = useParams().page ?? 'manage'

  return (
    <div className="container-fluid">
      <div className="row">
        <ul id="user_prefs_tabs" className="nav nav-pills m-2">
          {PAGES.map((p) => (
            <li className="nav-item" key={p.id}>
              <Link to={p.id === 'manage' ? '/server/settings' : `/server/settings/${p.id}`} className={`nav-link${page === p.id ? ' active' : ''}`}>
                {p.icon ? (
                  <span className="text-nowrap">
                    <Icon name={p.icon} /> {t(`pages.${p.id}`)}
                  </span>
                ) : (
                  t(`pages.${p.id}`)
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {page === 'manage' ? <Manage /> : <SettingsForm key={page} page={page} />}
    </div>
  )
}

type Values = Record<string, PreferenceValue>

const current = (defs: PreferenceDefinition[]): Values => Object.fromEntries(defs.map((d) => [d.key, preference(d.key)]))

/** A page of settings, after phpMyAdmin's config form: a tab per group, Apply and Reset. */
function SettingsForm({ page }: { page: string }) {
  const { t } = useTranslation('settings')
  const { t: tAny } = useTranslation()
  const defs = preferenceDefinitions().filter((d) => d.page === page)
  const groups = preferenceGroups(page)
  const [tab, setTab] = useState(groups[0]?.id ?? '')
  const [values, setValues] = useState<Values>(() => current(defs))
  const [busy, setBusy] = useState(false)
  // The form follows the settings changed elsewhere (the console's options) until it is edited.
  const stamp = useStoredPreferences()
  const edited = useRef(false)
  useEffect(() => {
    if (!edited.current) setValues(current(defs))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp])

  if (defs.length === 0) {
    return (
      <div className="alert alert-primary" role="alert">
        <Icon name="s_notice" /> {t('nothing')}
      </div>
    )
  }

  const set = (key: string, value: PreferenceValue) => {
    edited.current = true
    setValues((v) => ({ ...v, [key]: value }))
  }

  async function apply(e: FormEvent) {
    e.preventDefault()
    for (const def of defs) {
      const value = values[def.key]
      if (def.type === 'number' && (typeof value !== 'number' || !Number.isInteger(value) || (def.min !== undefined && value < def.min) || (def.max !== undefined && value > def.max))) {
        setTab(def.group)
        const bounds = def.min !== undefined ? (def.max !== undefined ? 'range' : 'min') : def.max !== undefined ? 'max' : 'any'

        return notifyError(t(`invalid_number.${bounds}`, { name: tAny(def.label), min: def.min, max: def.max }))
      }
    }
    setBusy(true)
    try {
      await saveSettings(values)
      edited.current = false
      notifySuccess(t('saved'))
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    // The checks are Apply's own, as phpMyAdmin's form validation is, not the browser's.
    <form className="config-form" noValidate onSubmit={(e) => void apply(e)}>
      <ul className="nav nav-tabs" id="configFormDisplayTab" role="tablist">
        {groups.map((g) => (
          <li className="nav-item" role="presentation" key={g.id}>
            <a
              className={`nav-link${tab === g.id ? ' active' : ''}`}
              id={`${g.id}-tab`}
              href={`#${g.id}`}
              role="tab"
              aria-controls={g.id}
              aria-selected={tab === g.id}
              onClick={(e) => {
                e.preventDefault()
                setTab(g.id)
              }}
            >
              {tAny(g.label)}
            </a>
          </li>
        ))}
      </ul>
      <div className="tab-content">
        {groups.map((g) => (
          <div className={`tab-pane fade${tab === g.id ? ' show active' : ''}`} id={g.id} role="tabpanel" aria-labelledby={`${g.id}-tab`} key={g.id}>
            <div className="card border-top-0">
              <div className="card-body">
                <h5 className="card-title visually-hidden">{tAny(g.label)}</h5>
                {g.description && <h6 className="card-subtitle mb-2 text-muted">{tAny(g.description)}</h6>}
                <fieldset className="optbox">
                  <legend>{tAny(g.label)}</legend>
                  <table className="table table-borderless">
                    <tbody>
                      {defs
                        .filter((d) => d.group === g.id)
                        .map((d) => (
                          <SettingRow key={d.key} def={d} value={values[d.key]} onChange={(value) => set(d.key, value)} />
                        ))}
                    </tbody>
                  </table>
                </fieldset>
              </div>
              <div className="card-footer">
                <input className="btn btn-primary" type="submit" name="submit_save" value={t('apply')} disabled={busy} />{' '}
                <input
                  className="btn btn-secondary"
                  type="button"
                  name="submit_reset"
                  value={t('reset')}
                  onClick={() => {
                    edited.current = false
                    setValues(current(defs))
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </form>
  )
}

/** One setting: config/form_display/input.twig's row. */
function SettingRow({ def, value, onChange }: { def: PreferenceDefinition; value: PreferenceValue; onChange: (value: PreferenceValue) => void }) {
  const { t } = useTranslation('settings')
  const { t: tAny } = useTranslation()
  const id = def.key.replace(/\./g, '_')
  const isDefault = value === def.default

  return (
    <tr>
      <th>
        <label htmlFor={id}>{tAny(def.label)}</label>
        {def.description && <small>{tAny(def.description)}</small>}
      </th>
      <td>
        {def.type === 'boolean' ? (
          <span className="checkbox">
            <input type="checkbox" name={id} id={id} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          </span>
        ) : def.type === 'select' ? (
          <select className="w-75" name={id} id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {(def.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {tAny(o.label)}
              </option>
            ))}
          </select>
        ) : def.type === 'number' ? (
          <input type="number" name={id} id={id} min={def.min} max={def.max} value={Number.isNaN(value) ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
        ) : (
          <input type="text" className="w-75" name={id} id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} />
        )}{' '}
        <a
          className={`restore-default${isDefault ? ' hide' : ''}`}
          href={`#${id}`}
          title={t('restore_default')}
          style={{ display: 'inline-block', opacity: isDefault ? 0.25 : 1 }}
          onClick={(e) => {
            e.preventDefault()
            onChange(def.default)
          }}
        >
          <Icon name="s_reload" title={t('restore_default')} />
        </a>
      </td>
    </tr>
  )
}

/** The role's settings as a file or the browser keeps them: the registered settings that differ from their default. */
function changedSettings(): Values {
  return Object.fromEntries(
    preferenceDefinitions()
      .map((d) => [d.key, preference(d.key)] as const)
      .filter(([key, value]) => value !== preferenceDefinitions().find((d) => d.key === key)?.default),
  )
}

/**
 * The settings a file or the browser storage holds, those this application knows and of the
 * right type; with merge, the others keep their values, without it they return to their default.
 */
function importValues(input: unknown, merge: boolean): Record<string, PreferenceValue | null> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('not an object')
  const given = input as Record<string, unknown>
  const values: Record<string, PreferenceValue | null> = {}
  for (const def of preferenceDefinitions()) {
    const value = given[def.key]
    if (value !== undefined && typeof value === typeof def.default) values[def.key] = value as PreferenceValue
    else if (!merge) values[def.key] = null
  }

  return values
}

/** Manage your settings (preferences/manage/main.twig): Import, Export and Reset. */
function Manage() {
  const { t } = useTranslation('settings')
  const navigate = useNavigate()
  const [importType, setImportType] = useState<'text_file' | 'local_storage'>('text_file')
  const [exportType, setExportType] = useState<'text_file' | 'local_storage'>('text_file')
  const [merge, setMerge] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [saved, setSaved] = useState(() => readStorage())

  async function doImport(e: FormEvent) {
    e.preventDefault()
    try {
      let data: unknown
      if (importType === 'local_storage') {
        if (!saved) return
        data = saved.values
      } else {
        if (!file) return notifyError(t('manage.no_file'))
        data = JSON.parse(await file.text())
      }
      await saveSettings(importValues(data, merge))
      notifySuccess(t('manage.imported'))
      navigate('/server/settings/features')
    } catch (err) {
      notifyError(err instanceof SyntaxError || (err instanceof Error && err.message === 'not an object') ? t('manage.invalid_file') : errorMessage(err))
    }
  }

  function doExport(e: FormEvent) {
    e.preventDefault()
    const values = changedSettings()
    if (exportType === 'local_storage') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: new Date().toISOString(), values }))
        setSaved(readStorage())
        notifySuccess(t('manage.saved_browser'))
      } catch {
        notifyError(t('manage.no_storage'))
      }
      return
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([JSON.stringify(values, null, 2)], { type: 'application/json' }))
    link.download = `phppgadmin-config-${location.hostname}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function doReset(e: FormEvent) {
    e.preventDefault()
    try {
      await savePreferences(Object.fromEntries(preferenceDefinitions().map((d) => [d.key, null])))
      notifySuccess(t('manage.reset_done'))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <div className="row">
      <div id="maincontainer" className="container-fluid">
        <div className="row">
          <div className="col-12 col-md-7">
            <div className="card mt-4">
              <div className="card-header">{t('manage.import')}</div>
              <div className="card-body">
                <form className="prefs-form" name="prefs_import" onSubmit={(e) => void doImport(e)}>
                  <input type="radio" id="import_text_file" name="import_type" value="text_file" checked={importType === 'text_file'} onChange={() => setImportType('text_file')} /> <label htmlFor="import_text_file">{t('manage.import_file')}</label>
                  <div id="opts_import_text_file" className={`prefsmanage_opts${importType === 'text_file' ? '' : ' disabled'}`}>
                    <label htmlFor="input_import_file">{t('manage.browse')}</label> <input type="file" name="import_file" id="input_import_file" accept=".json,application/json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  </div>
                  <input type="radio" id="import_local_storage" name="import_type" value="local_storage" checked={importType === 'local_storage'} onChange={() => setImportType('local_storage')} /> <label htmlFor="import_local_storage">{t('manage.import_browser')}</label>
                  <div id="opts_import_local_storage" className={`prefsmanage_opts${importType === 'local_storage' ? '' : ' disabled'}`}>
                    {t('manage.import_browser_help')}
                    <br />
                    {saved ? (
                      <div className="localStorage-exists">{t('manage.saved_on', { date: new Date(saved.date).toLocaleString() })}</div>
                    ) : (
                      <div className="localStorage-empty">
                        <div className="alert alert-primary" role="alert">
                          <Icon name="s_notice" /> {t('manage.nothing_saved')}
                        </div>
                      </div>
                    )}
                  </div>
                  <input type="checkbox" id="import_merge" name="import_merge" checked={merge} onChange={(e) => setMerge(e.target.checked)} /> <label htmlFor="import_merge">{t('manage.merge')}</label>
                  <br />
                  <br />
                  <input className="btn btn-primary" type="submit" name="submit_import" value={t('go')} />
                </form>
              </div>
            </div>
          </div>
          <div className="col-12 col-md-5">
            <div className="card mt-4">
              <div className="card-header">{t('manage.export')}</div>
              <div className="card-body">
                <form className="prefs-form" name="prefs_export" onSubmit={doExport}>
                  <div>
                    <input type="radio" id="export_text_file" name="export_type" value="text_file" checked={exportType === 'text_file'} onChange={() => setExportType('text_file')} /> <label htmlFor="export_text_file">{t('manage.export_file')}</label>
                    <br />
                    <input type="radio" id="export_local_storage" name="export_type" value="local_storage" checked={exportType === 'local_storage'} onChange={() => setExportType('local_storage')} /> <label htmlFor="export_local_storage">{t('manage.export_browser')}</label>
                  </div>
                  <div id="opts_export_local_storage" className={`prefsmanage_opts${exportType === 'local_storage' ? '' : ' disabled'}`}>
                    <span>
                      {t('manage.export_browser_help')}
                      {saved && (
                        <div>
                          <b>{t('manage.overwritten')}</b>
                        </div>
                      )}
                    </span>
                  </div>
                  <br />
                  <input className="btn btn-primary" type="submit" name="submit_export" value={t('go')} />
                </form>
              </div>
            </div>
            <div className="card mt-4">
              <div className="card-header">{t('manage.reset')}</div>
              <div className="card-body">
                <form className="prefs-form" name="prefs_reset" onSubmit={(e) => void doReset(e)}>
                  {t('manage.reset_help')}
                  <br />
                  <br />
                  <input className="btn btn-secondary" type="submit" name="submit_clear" value={t('reset')} />
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function readStorage(): { date: string; values: unknown } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as { date?: unknown; values?: unknown }) : null

    return parsed && typeof parsed.date === 'string' ? { date: parsed.date, values: parsed.values } : null
  } catch {
    return null
  }
}
