import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Modal from '@/components/Modal'
import ObjectSection from '@/components/ObjectSection'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { urls, useLevel } from '@/level'
import { qualifiedName, quoteIdent } from '@sql/js/sql'
import { columns as columnsOf, policies as policiesOf, resolveRelation, rules as rulesOf, setTableTriggersEnabled, tables, triggerOptions, triggers as triggersOf, type Column, type Policy, type Rule, type Trigger, type TriggerOptions, type TriggerParent } from '../api'
import PolicyDialog from '../triggers/PolicyDialog'
import RuleDialog from '../triggers/RuleDialog'
import TriggerDialog from '../triggers/TriggerDialog'
import { viewColumns } from '@views/js/api'

interface Loaded {
  scid: number
  oid: number
  columns: Column[]
  triggers: Trigger[]
  rules: Rule[]
  policies: Policy[]
  /** Whether row level security is enabled, and forced on the owner (tables only). */
  rls: { enabled: boolean; forced: boolean } | null
}

/**
 * The relation's "Triggers" page, after phpMyAdmin's database/triggers/list.twig: the
 * triggers with their time and events, then (PostgreSQL's additions, in the same layout) the
 * rewrite rules and, for a table, the row security policies. Each section has the check-all /
 * Export / Drop group and a "Create new …" button; each row has Edit, Export (the CREATE
 * statement) and Drop, and the triggers and rules an enabled switch.
 */
export default function Triggers() {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const parent: TriggerParent = useLevel().kind === 'view' ? 'view' : 'table'
  const { data, error, reload } = useRequest(async (): Promise<Loaded> => {
    const { scid, oid } = await resolveRelation(db, schema, table, parent)
    const [cols, triggers, rules, policies, properties] = await Promise.all([
      parent === 'table' ? columnsOf(db, scid, oid).list() : viewColumns(db, scid, oid, 'view'),
      triggersOf(db, scid, parent, oid).list(),
      rulesOf(db, scid, parent, oid).list(),
      parent === 'table' ? policiesOf(db, scid, oid).list() : Promise.resolve([]),
      parent === 'table' ? tables(db, scid).properties(oid) : Promise.resolve(null),
    ])

    return { scid, oid, columns: cols, triggers, rules, policies, rls: properties ? { enabled: Boolean(properties.rlspolicy), forced: Boolean(properties.forcerlspolicy) } : null }
  }, [db, schema, table, parent])
  const [options, setOptions] = useState<TriggerOptions | null>(null)
  const [triggerDialog, setTriggerDialog] = useState<{ trigger: Trigger | null } | null>(null)
  const [ruleDialog, setRuleDialog] = useState<{ rule: Rule | null } | null>(null)
  const [policyDialog, setPolicyDialog] = useState<{ policy: Policy | null } | null>(null)
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void> } | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, oid } = data
  const relation = qualifiedName(schema, table)

  function loadOptions() {
    if (!options) void triggerOptions(db, scid, parent, oid).then(setOptions, () => setOptions({ functions: [], roles: [] }))
  }

  const changed = () => {
    treeState.refresh()
    reload()
  }

  /** The Export of phpMyAdmin's triggers page: the CREATE statement(s) in a dialog. */
  function exportSql(title: string, loads: Promise<string>[]) {
    setExported({ title, sql: null })
    Promise.all(loads).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function askDrop(statements: string[], run: () => Promise<void>) {
    setConfirm({ sql: statements, run })
  }

  async function dropAll(remove: (oid: number) => Promise<unknown>, oids: number[], message: string) {
    try {
      for (const id of oids) await remove(id)
      notifySuccess(message)
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      changed()
    }
  }

  /** pgAdmin's Trigger(s) → Enable All / Disable All: every trigger of the table, system ones too. */
  async function setAllTriggers(enable: boolean) {
    if (!data) return
    try {
      await setTableTriggersEnabled(db, data.scid, data.oid, enable)
      notifySuccess(t(enable ? 'triggers.enabled_all' : 'triggers.disabled_all'))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  async function toggleEnabled(kind: 'trigger' | 'rule', row: Trigger | Rule, enabled: boolean) {
    try {
      if (kind === 'trigger') await triggersOf(db, scid, parent, oid).update(row.oid, { is_enable_trigger: enabled ? 'O' : 'D' })
      else await rulesOf(db, scid, parent, oid).update(row.oid, { is_enable_rule: enabled ? 'O' : 'D' })
      notifySuccess(tApp('query_executed'))
      changed()
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  const labels = { name: t('triggers.columns.name'), edit: t('triggers.actions.edit'), export: t('triggers.actions.export'), drop: t('triggers.actions.drop') }

  /** The state the policies depend on, with the way to the switch when they are in force for nobody yet. */
  const rlsNotice = data.rls && (
    <div className={`alert ${!data.rls.enabled && data.policies.length > 0 ? 'alert-warning' : 'alert-info'} d-print-none`} role="alert" id="rls_state">
      {data.rls.enabled ? t(data.rls.forced ? 'triggers.rls_forced' : 'triggers.rls_enabled') : t(data.policies.length > 0 ? 'triggers.rls_disabled' : 'triggers.rls_disabled_none')}{' '}
      <Link to={`${urls.relation(db, schema, table, 'table')}/operations`}>{t(data.rls.enabled ? 'triggers.rls_change' : 'triggers.rls_switch')}</Link>
    </div>
  )
  const triggerUrl = triggersOf(db, scid, parent, oid)
  const ruleUrl = rulesOf(db, scid, parent, oid)
  const policyUrl = policiesOf(db, scid, oid)

  return (
    <>
      <ObjectSection<Trigger>
        id="triggers"
        icon="b_triggers"
        title={t('triggers.title')}
        rows={data.triggers}
        empty={t('triggers.none')}
        createLabel={t('triggers.create_new')}
        createIcon="b_trigger_add"
        onCreate={() => { loadOptions(); setTriggerDialog({ trigger: null }) }}
        columns={[
          { label: t('triggers.columns.time'), render: (row) => row.fires },
          { label: t('triggers.columns.event'), render: (row) => [row.evnt_insert && 'INSERT', row.evnt_update && (row.columns.length ? `UPDATE OF ${row.columns.join(', ')}` : 'UPDATE'), row.evnt_delete && 'DELETE', row.evnt_truncate && 'TRUNCATE'].filter(Boolean).join(' OR ') },
          { label: t('triggers.columns.level'), render: (row) => (row.is_row_trigger ? 'ROW' : 'STATEMENT') },
          { label: t('triggers.columns.function'), render: (row) => <code>{`${row.tfunction}(${row.tgargs ?? ''})`}</code> },
          // Uncontrolled, keyed on the state: the box flips at once and the reload re-mounts it with the server's answer.
          { label: t('triggers.columns.enabled'), render: (row) => (
              <>
                <input key={`${row.oid}-${row.is_enable_trigger}`} type="checkbox" defaultChecked={row.is_enable_trigger !== 'D'} onChange={(e) => void toggleEnabled('trigger', row, e.target.checked)} aria-label={t('triggers.columns.enabled')} />
                {(row.is_enable_trigger === 'R' || row.is_enable_trigger === 'A') && <> {t(`triggers.enable_mode.${row.is_enable_trigger}`)}</>}
              </>
            ) },
        ]}
        onEdit={(row) => { loadOptions(); setTriggerDialog({ trigger: row }) }}
        onExport={(rows) => exportSql(rows.length === 1 ? t('triggers.export_title', { name: rows[0].name }) : t('triggers.export_title_many'), rows.map((row) => triggerUrl.sql(row.oid)))}
        onDrop={(rows) => askDrop(rows.map((row) => `DROP TRIGGER ${quoteIdent(row.name)} ON ${relation};`), () => dropAll((id) => triggerUrl.remove(id), rows.map((r) => r.oid), rows.length === 1 ? t('triggers.dropped', { name: rows[0].name }) : t('triggers.dropped_many', { count: rows.length })))}
        noneSelected={t('triggers.none_selected')}
        labels={labels}
      />

      {parent === 'table' && data.triggers.length > 0 && (
        <p className="d-print-none" id="triggers_all">
          {t('triggers.all')}{' '}
          <a href="#enable-all" onClick={(e) => { e.preventDefault(); void setAllTriggers(true) }}>{t('triggers.enable_all')}</a>
          {' | '}
          <a
            href="#disable-all"
            onClick={(e) => {
              e.preventDefault()
              // DISABLE TRIGGER ALL switches off the foreign key triggers too: asked first, with the statement.
              setConfirm({ sql: [`ALTER TABLE ${relation} DISABLE TRIGGER ALL;`], run: () => setAllTriggers(false) })
            }}
          >{t('triggers.disable_all')}</a>
        </p>
      )}

      <ObjectSection<Rule>
        id="rules"
        icon="b_triggers"
        title={t('triggers.rules_title')}
        rows={data.rules}
        empty={t('triggers.rules_none')}
        createLabel={t('triggers.rule_create_new')}
        createIcon="b_plus"
        onCreate={() => setRuleDialog({ rule: null })}
        columns={[
          { label: t('triggers.columns.event'), render: (row) => row.event },
          { label: t('triggers.columns.condition'), render: (row) => <code>{row.condition}</code> },
          { label: t('triggers.columns.instead'), render: (row) => (row.do_instead ? tApp('yes') : tApp('no')) },
          { label: t('triggers.columns.commands'), render: (row) => <code>{row.statements}</code> },
          { label: t('triggers.columns.enabled'), render: (row) => <input key={`${row.oid}-${row.is_enable_rule}`} type="checkbox" defaultChecked={row.is_enable_rule !== 'D'} onChange={(e) => void toggleEnabled('rule', row, e.target.checked)} aria-label={t('triggers.columns.enabled')} /> },
        ]}
        onEdit={(row) => setRuleDialog({ rule: row })}
        onExport={(rows) => exportSql(rows.length === 1 ? t('triggers.export_title', { name: rows[0].name }) : t('triggers.export_title_many'), rows.map((row) => ruleUrl.sql(row.oid)))}
        onDrop={(rows) => askDrop(rows.map((row) => `DROP RULE ${quoteIdent(row.name)} ON ${relation};`), () => dropAll((id) => ruleUrl.remove(id), rows.map((r) => r.oid), rows.length === 1 ? t('triggers.rule_dropped', { name: rows[0].name }) : t('triggers.dropped_many', { count: rows.length })))}
        noneSelected={t('triggers.none_selected')}
        labels={labels}
      />

      {parent === 'table' && (
        <ObjectSection<Policy>
          id="policies"
          icon="s_rights"
          title={t('triggers.policies_title')}
          notice={rlsNotice}
          rows={data.policies}
          empty={t('triggers.policies_none')}
          createLabel={t('triggers.policy_create_new')}
          createIcon="b_plus"
          onCreate={() => { loadOptions(); setPolicyDialog({ policy: null }) }}
          columns={[
            { label: t('triggers.columns.command'), render: (row) => row.event },
            { label: t('triggers.columns.type'), render: (row) => row.type },
            { label: t('triggers.columns.roles'), render: (row) => row.policyowner.join(', ') },
            { label: t('triggers.columns.using'), render: (row) => <code>{row.using ?? ''}</code> },
            { label: t('triggers.columns.with_check'), render: (row) => <code>{row.withcheck ?? ''}</code> },
          ]}
          onEdit={(row) => { loadOptions(); setPolicyDialog({ policy: row }) }}
          onExport={(rows) => exportSql(rows.length === 1 ? t('triggers.export_title', { name: rows[0].name }) : t('triggers.export_title_many'), rows.map((row) => policyUrl.sql(row.oid)))}
          onDrop={(rows) => askDrop(rows.map((row) => `DROP POLICY ${quoteIdent(row.name)} ON ${relation};`), () => dropAll((id) => policyUrl.remove(id), rows.map((r) => r.oid), rows.length === 1 ? t('triggers.policy_dropped', { name: rows[0].name }) : t('triggers.dropped_many', { count: rows.length })))}
          noneSelected={t('triggers.none_selected')}
          labels={labels}
        />
      )}

      <TriggerDialog show={triggerDialog !== null} db={db} scid={scid} parent={parent} relOid={oid} columns={data.columns} options={options} trigger={triggerDialog?.trigger ?? null} onClose={() => setTriggerDialog(null)} onSaved={() => { setTriggerDialog(null); changed() }} />
      <RuleDialog show={ruleDialog !== null} db={db} scid={scid} parent={parent} relOid={oid} rule={ruleDialog?.rule ?? null} onClose={() => setRuleDialog(null)} onSaved={() => { setRuleDialog(null); changed() }} />
      {parent === 'table' && <PolicyDialog show={policyDialog !== null} db={db} scid={scid} tid={oid} options={options} policy={policyDialog?.policy ?? null} onClose={() => setPolicyDialog(null)} onSaved={() => { setPolicyDialog(null); changed() }} />}

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>
      <ConfirmQuery show={confirm !== null} sql={confirm?.sql ?? ''} confirmLabel={tApp('ok')} onClose={() => setConfirm(null)} onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }} />
    </>
  )
}
