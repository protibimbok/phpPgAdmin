import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { ATTRIBUTES, type Attribute, type Membership, type RoleOptions, type RoleVariable } from './api'

/** The editable part of a role, as the forms hold it. */
export interface RoleForm {
  attributes: Record<Attribute, boolean>
  connlimit: string
  validUntil: string
  memberOf: Membership[]
  members: Membership[]
  variables: RoleVariable[]
}

/** The attribute groups of the "Role attributes" fieldset, as phpMyAdmin groups global privileges. */
const GROUPS: { key: string; attributes: Attribute[] }[] = [
  { key: 'login', attributes: ['rolcanlogin', 'rolinherit'] },
  { key: 'administration', attributes: ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls'] },
]

/** The keyword each attribute is written as in CREATE ROLE. */
const KEYWORDS: Record<Attribute, string> = {
  rolcanlogin: 'LOGIN',
  rolinherit: 'INHERIT',
  rolsuper: 'SUPERUSER',
  rolcreatedb: 'CREATEDB',
  rolcreaterole: 'CREATEROLE',
  rolreplication: 'REPLICATION',
  rolbypassrls: 'BYPASSRLS',
}

export const NO_ATTRIBUTES = Object.fromEntries(ATTRIBUTES.map((a) => [a, a === 'rolinherit'])) as Record<Attribute, boolean>

/** The attribute keywords a role has, for the overview's "Attributes" column. */
export function attributeKeywords(role: Record<Attribute, boolean>): string[] {
  return ATTRIBUTES.filter((a) => role[a]).map((a) => KEYWORDS[a])
}

interface FieldsProps {
  form: RoleForm
  onChange: (patch: Partial<RoleForm>) => void
}

/**
 * phpMyAdmin's "Global privileges" fieldset with PostgreSQL's role attributes: a Check all in
 * the legend, a group per kind with its own Check all, each attribute a checkbox with its
 * keyword in <code><dfn>, then the resource limits.
 */
export function AttributesFieldset({ form, onChange }: FieldsProps) {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const set = (attributes: Attribute[], value: boolean) => onChange({ attributes: { ...form.attributes, ...Object.fromEntries(attributes.map((a) => [a, value])) } })
  const all = ATTRIBUTES.every((a) => form.attributes[a])

  return (
    <fieldset className="pma-fieldset" id="fieldset_user_global_rights">
      <legend>
        {t('attributes.title')}{' '}
        <input type="checkbox" id="addUsersForm_checkall" className="checkall_box" title={tApp('check_all')} checked={all} onChange={(e) => set([...ATTRIBUTES], e.target.checked)} />
        <label htmlFor="addUsersForm_checkall">{tApp('check_all')}</label>
      </legend>
      <p>
        <small>
          <em>{t('attributes.note')}</em>
        </small>
      </p>

      {GROUPS.map((group) => (
        <fieldset className="pma-fieldset" key={group.key}>
          <legend>
            <input
              type="checkbox"
              className="sub_checkall_box"
              id={`checkall_${group.key}_priv`}
              title={tApp('check_all')}
              checked={group.attributes.every((a) => form.attributes[a])}
              onChange={(e) => set(group.attributes, e.target.checked)}
            />
            <label htmlFor={`checkall_${group.key}_priv`}>{t(`attributes.${group.key}`)}</label>
          </legend>
          {group.attributes.map((attribute) => (
            <div className="item" key={attribute}>
              <input type="checkbox" className="checkall" name={attribute} id={`checkbox_${attribute}`} title={t(`attributes.hint.${attribute}`)} checked={form.attributes[attribute]} onChange={(e) => set([attribute], e.target.checked)} />
              <label htmlFor={`checkbox_${attribute}`}>
                <code>
                  <dfn title={t(`attributes.hint.${attribute}`)}>{KEYWORDS[attribute]}</dfn>
                </code>
              </label>
            </div>
          ))}
        </fieldset>
      ))}

      <fieldset className="pma-fieldset">
        <legend>{t('attributes.limits')}</legend>
        <p>
          <small>
            <em>{t('attributes.limits_note')}</em>
          </small>
        </p>
        <div className="item">
          <label htmlFor="text_rolconnlimit">
            <code>
              <dfn title={t('attributes.hint.connlimit')}>CONNECTION LIMIT</dfn>
            </code>
          </label>{' '}
          <input type="number" name="rolconnlimit" id="text_rolconnlimit" min={-1} value={form.connlimit} placeholder="-1" title={t('attributes.hint.connlimit')} onChange={(e) => onChange({ connlimit: e.target.value })} />
        </div>
        <div className="item">
          <label htmlFor="text_rolvaliduntil">
            <code>
              <dfn title={t('attributes.hint.valid_until')}>VALID UNTIL</dfn>
            </code>
          </label>{' '}
          <input type="text" name="rolvaliduntil" id="text_rolvaliduntil" value={form.validUntil} placeholder="infinity" title={t('attributes.hint.valid_until')} onChange={(e) => onChange({ validUntil: e.target.value })} />
        </div>
      </fieldset>

      <div className="clearfloat" />
    </fieldset>
  )
}

/** Both directions of membership: the roles this one is a member of, and its members. */
export function MembershipFieldset({ form, onChange, options, self }: FieldsProps & { options: RoleOptions; self: string }) {
  const { t } = useTranslation('roles')

  return (
    <fieldset className="pma-fieldset" id="fieldset_role_membership">
      <legend>{t('membership.title')}</legend>
      <MembershipTable id="member_of" title={t('membership.member_of')} rows={form.memberOf} options={options} self={self} onChange={(memberOf) => onChange({ memberOf })} />
      <MembershipTable id="members" title={t('membership.members')} rows={form.members} options={options} self={self} onChange={(members) => onChange({ members })} />
      <div className="clearfloat" />
    </fieldset>
  )
}

function MembershipTable({ id, title, rows, options, self, onChange }: { id: string; title: string; rows: Membership[]; options: RoleOptions; self: string; onChange: (rows: Membership[]) => void }) {
  const { t } = useTranslation('roles')
  const taken = new Set([self, ...rows.map((row) => row.role)])
  const flags: (keyof Omit<Membership, 'role'>)[] = options.membership_options ? ['admin', 'inherit', 'set'] : ['admin']
  const update = (index: number, patch: Partial<Membership>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <fieldset className="pma-fieldset">
      <legend>{title}</legend>
      <table className="table table-borderless table-sm w-auto mb-0" id={`table_${id}`}>
        <thead>
          <tr>
            <th>{t('membership.role')}</th>
            {flags.map((flag) => (
              <th key={flag} title={t(`membership.hint.${flag}`)}>
                <code>{flag.toUpperCase()}</code>
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.role}>
              <td>{row.role}</td>
              {flags.map((flag) => (
                <td key={flag} className="text-center">
                  <input type="checkbox" checked={row[flag]} title={t(`membership.hint.${flag}`)} aria-label={`${row.role} ${flag.toUpperCase()}`} onChange={(e) => update(index, { [flag]: e.target.checked })} />
                </td>
              ))}
              <td>
                <a href="#" onClick={(e) => { e.preventDefault(); onChange(rows.filter((_, i) => i !== index)) }}>
                  <Icon name="b_drop" title={t('membership.remove')} />
                </a>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={flags.length + 2}>
              <select value="" aria-label={t('membership.add')} onChange={(e) => e.target.value && onChange([...rows, { role: e.target.value, admin: false, inherit: true, set: true }])}>
                <option value="">{t('membership.add')}</option>
                {options.roles.filter((role) => !taken.has(role)).map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </fieldset>
  )
}

/** The configuration parameters set for the role, each in every database or in one (ALTER ROLE ... SET). */
export function VariablesFieldset({ form, onChange, options }: FieldsProps & { options: RoleOptions }) {
  const { t } = useTranslation('roles')
  const rows = form.variables
  const update = (index: number, patch: Partial<RoleVariable>) => onChange({ variables: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) })

  return (
    <fieldset className="pma-fieldset" id="fieldset_role_variables">
      <legend>{t('variables.title')}</legend>
      <table className="table table-borderless table-sm w-auto mb-0">
        <thead>
          <tr>
            <th>{t('variables.name')}</th>
            <th>{t('variables.value')}</th>
            <th>{t('variables.database')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td>
                <select value={row.name} aria-label={t('variables.name')} onChange={(e) => update(index, { name: e.target.value })}>
                  <option value="" />
                  {[...new Set([row.name, ...options.variables.map((v) => v.name)])].filter(Boolean).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input type="text" value={row.value} aria-label={t('variables.value')} title={options.variables.find((v) => v.name === row.name)?.short_desc} onChange={(e) => update(index, { value: e.target.value })} />
              </td>
              <td>
                <select value={row.database ?? ''} aria-label={t('variables.database')} onChange={(e) => update(index, { database: e.target.value || null })}>
                  <option value="">{t('variables.all_databases')}</option>
                  {options.databases.map((database) => (
                    <option key={database} value={database}>
                      {database}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <a href="#" onClick={(e) => { e.preventDefault(); onChange({ variables: rows.filter((_, i) => i !== index) }) }}>
                  <Icon name="b_drop" title={t('variables.remove')} />
                </a>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>
              <input type="button" className="btn btn-secondary" value={t('variables.add')} onClick={() => onChange({ variables: [...rows, { name: '', value: '', database: null }] })} />
            </td>
          </tr>
        </tbody>
      </table>
    </fieldset>
  )
}

/** phpMyAdmin's password row pair: the choice in a select, the field and its re-type; typing picks "Use text field". */
export function PasswordItems({ mode, choice, password, retype, onChange }: { mode: 'create' | 'edit'; choice: PasswordChoice; password: string; retype: string; onChange: (patch: { choice?: PasswordChoice; password?: string; retype?: string }) => void }) {
  const { t } = useTranslation('roles')
  const typed = choice === 'userdefined'

  return (
    <>
      <div className="item">
        <label htmlFor="select_pred_password">{t('login.password')}</label>
        <span className="options">
          <select name="pred_password" id="select_pred_password" title={t('login.password_title')} value={choice} onChange={(e) => onChange({ choice: e.target.value as PasswordChoice })}>
            {mode === 'edit' && <option value="keep">{t('login.keep_password')}</option>}
            <option value="none">{t('login.no_password')}</option>
            <option value="userdefined">{t('login.use_text_field')}</option>
          </select>
        </span>
        <input type="password" spellCheck={false} id="text_pma_pw" name="pma_pw" title={t('login.password_title')} value={password} required={typed} autoComplete="new-password" onChange={(e) => onChange({ choice: 'userdefined', password: e.target.value })} />
      </div>
      <div className="item" id="div_element_before_generate_password">
        <label htmlFor="text_pma_pw2">{t('login.retype')}</label>
        <span className="options">&nbsp;</span>
        <input type="password" spellCheck={false} name="pma_pw2" id="text_pma_pw2" title={t('login.retype_title')} value={retype} required={typed} autoComplete="new-password" onChange={(e) => onChange({ choice: 'userdefined', retype: e.target.value })} />
      </div>
    </>
  )
}

export type PasswordChoice = 'keep' | 'none' | 'userdefined'

/** The password as the API takes it: '' keeps it, null removes it; undefined when the two fields differ. */
export function passwordValue(choice: PasswordChoice, password: string, retype: string): string | null | undefined {
  if (choice === 'keep') return ''
  if (choice === 'none') return null

  return password === retype ? password : undefined
}
