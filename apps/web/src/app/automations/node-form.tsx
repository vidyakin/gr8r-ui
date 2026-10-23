/* Форма параметров узла, построенная из его zod-схемы (JSON Schema + подсказки `ui` из .meta()).
   Новый узел получает форму автоматически: типы string / number / integer / boolean / enum и подсказки
   entity, field, value, member, project, textarea, cron, url. */
import * as React from 'react';
import { Braces } from 'lucide-react';
import { AUTOMATION_SYSTEM_ENTITIES, BUILTIN_FIELDS, nodeParamsJsonSchema, type AnyNodeDef, type FieldOptions, type FieldType } from '@gr8r/shared';
import { IconButton, Input, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Select, Switch, Textarea } from '@/components/ui';
import { useT } from '@/i18n';
import { useWorkspace } from '../data/store';
import { activeFields, useEntities, type MetaEntity } from '../meta/data';
import { humanize } from './node-meta';

interface Prop {
  type?: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  ui?: string;
  dependsOn?: string;
  writableOnly?: boolean;
  placeholder?: string;
}

type Params = Record<string, unknown>;

/** Окружение формы: справочники воркспейса */
export interface FormEnv {
  entities: { key: string; name: string; fields: { key: string; name: string; type: FieldType; options: FieldOptions; builtin: boolean; writable: boolean }[] }[];
  members: { id: string; name: string }[];
  projects: { id: string; name: string; key: string }[];
  statuses: { id: string; name: string }[];
  /** Сущность триггера flow — для списка подстановок */
  triggerEntity?: string;
  /** Узлы, выходы которых можно подставлять */
  stepIds: { id: string; label: string }[];
}

export function useFormEnv(triggerEntity: string | undefined, stepIds: FormEnv['stepIds']): FormEnv {
  const metas = useEntities();
  const { data } = useWorkspace();
  return React.useMemo<FormEnv>(() => {
    const byKey = new Map<string, MetaEntity>(metas.map(e => [e.key, e]));
    const keys = [...AUTOMATION_SYSTEM_ENTITIES.map(e => e.key), ...metas.filter(e => e.kind === 'custom').map(e => e.key)];
    const entities = keys.map(key => {
      const meta = byKey.get(key);
      return {
        key,
        name: meta?.name ?? AUTOMATION_SYSTEM_ENTITIES.find(e => e.key === key)?.name ?? key,
        fields: [
          ...(BUILTIN_FIELDS[key] ?? []).map(f => ({ key: f.key, name: f.name, type: f.type, options: f.options ?? {}, builtin: true, writable: f.writable })),
          ...activeFields(meta).map(f => ({ key: f.key, name: f.name, type: f.type, options: f.options, builtin: false, writable: true })),
        ],
      };
    });
    return {
      entities,
      members: data.members.filter(m => m.status !== 'deactivated').map(m => ({ id: m.id, name: m.name })),
      projects: data.projects.filter(p => !p.archived).map(p => ({ id: p.id, name: p.name, key: p.key })),
      statuses: data.statuses.map(s => ({ id: s.id, name: s.name })),
      triggerEntity,
      stepIds,
    };
  }, [metas, data.members, data.projects, data.statuses, triggerEntity, stepIds]);
}

/* ---------------- подстановки ---------------- */

/** Переменные, доступные шаблонам `{{…}}` в этом flow */
export function templateVariables(env: FormEnv, triggerField?: string): { group: string; items: string[] }[] {
  const t = useT();
  const out: { group: string; items: string[] }[] = [];
  const e = env.entities.find(x => x.key === env.triggerEntity);
  const trig = ['trigger.recordId', 'trigger.entity'];
  if (triggerField) trig.push(`trigger.changes.${triggerField}.from`, `trigger.changes.${triggerField}.to`);
  out.push({ group: t('automations.nodeForm.varGroups.trigger'), items: trig });
  if (e) {
    const system = e.key !== undefined && e.fields.some(f => f.builtin);
    out.push({ group: t('automations.nodeForm.varGroups.record', { name: e.name }), items: e.fields.map(f => (f.builtin || !system ? `trigger.record.${f.key}` : `trigger.record.custom.${f.key}`)) });
    if (e.key === 'task') out.push({ group: t('automations.nodeForm.varGroups.projectOfTask'), items: ['trigger.project.name', 'trigger.project.key', 'trigger.project.leadId'] });
  }
  if (env.stepIds.length) out.push({ group: t('automations.nodeForm.varGroups.previousSteps'), items: env.stepIds.map(s => `steps.${s.id}.`) });
  out.push({ group: t('automations.nodeForm.varGroups.flow'), items: ['flow.name', 'run.id', 'now'] });
  return out;
}

function VarMenu({ env, triggerField, onPick }: { env: FormEnv; triggerField?: string; onPick: (v: string) => void }) {
  const t = useT();
  const groups = React.useMemo(() => templateVariables(env, triggerField), [env, triggerField, t]);
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton size="xs" label={t('automations.nodeForm.insertVariable')} type="button">
          <Braces size={13} />
        </IconButton>
      </MenuTrigger>
      <MenuContent className="min-w-[250px]" style={{ maxHeight: 340, overflow: 'auto' }}>
        {groups.map(g => (
          <React.Fragment key={g.group}>
            <MenuLabel>{g.group}</MenuLabel>
            {g.items.map(v => (
              <MenuItem key={v} onSelect={() => onPick(`{{${v}}}`)}>
                <span className="mono">{v}</span>
              </MenuItem>
            ))}
          </React.Fragment>
        ))}
      </MenuContent>
    </Menu>
  );
}

/* ---------------- поля ---------------- */

const CUSTOM = '__custom__';

/** Выбор из списка или своё значение (идентификатор / подстановка {{…}}) */
function PickOrType({ id, value, options, onChange, placeholder, env, label, triggerField }: { id: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; placeholder?: string; env: FormEnv; label: string; triggerField?: string }) {
  const t = useT();
  const known = options.some(o => o.value === value);
  const [custom, setCustom] = React.useState(!!value && !known);
  const showInput = custom || (!!value && !known);
  return (
    <div className="col" style={{ gap: 6 }}>
      <Select
        id={id}
        aria-label={label}
        value={showInput ? CUSTOM : value || ''}
        onValueChange={v => {
          if (v === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(v);
        }}
        placeholder={placeholder ?? t('automations.nodeForm.chooseGeneric')}
        options={[...options, { value: CUSTOM, label: t('automations.nodeForm.customValue') }]}
      />
      {showInput && (
        <div className="row" style={{ gap: 4 }}>
          <Input className="mono" aria-label={`${label} (custom)`} value={value} placeholder={t('automations.nodeForm.idPlaceholder')} onChange={e => onChange(e.target.value)} />
          <VarMenu env={env} triggerField={triggerField} onPick={v => onChange(value + v)} />
        </div>
      )}
    </div>
  );
}

function TextWithVars({ id, value, onChange, env, multiline, placeholder, invalid, triggerField, mono }: { id: string; value: string; onChange: (v: string) => void; env: FormEnv; multiline?: boolean; placeholder?: string; invalid?: boolean; triggerField?: string; mono?: boolean }) {
  return (
    <div className="row" style={{ gap: 4, alignItems: multiline ? 'flex-start' : 'center' }}>
      {multiline ? (
        <Textarea id={id} rows={4} className={mono ? 'mono' : undefined} value={value} placeholder={placeholder} invalid={invalid} onChange={e => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} placeholder={placeholder} invalid={invalid} onChange={e => onChange(e.target.value)} />
      )}
      <VarMenu env={env} triggerField={triggerField} onPick={v => onChange(value + v)} />
    </div>
  );
}

const CRON_PRESETS = (t: (k: any) => string): [string, string][] => [
  ['0 9 * * 1-5', t('automations.nodeForm.cronPresets.weekdays9')],
  ['0 * * * *', t('automations.nodeForm.cronPresets.hour')],
  ['*/15 * * * *', t('automations.nodeForm.cronPresets.every15')],
  ['0 0 * * *', t('automations.nodeForm.cronPresets.daily')],
];

interface FormProps {
  def: AnyNodeDef;
  params: Params;
  env: FormEnv;
  onChange: (next: Params) => void;
  /** Ошибки по именам параметров (из проверки схемой) */
  errors?: Record<string, string>;
  readOnly?: boolean;
}

export function ParamsForm({ def, params, env, onChange, errors = {}, readOnly }: FormProps) {
  const t = useT();
  const schema = nodeParamsJsonSchema(def) as { properties?: Record<string, Prop>; required?: string[] };
  const props = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const uid = React.useId();
  const set = (k: string, v: unknown) => {
    const next = { ...params };
    if (v === undefined || (v === '' && !required.has(k) && !('default' in (schema.properties?.[k] ?? {})))) delete next[k];
    else next[k] = v;
    // Зависимые параметры сбрасываются: смена сущности — поле, смена поля — значение
    for (const [dk, dp] of props) if (dp.dependsOn === k) delete next[dk];
    onChange(next);
  };
  const triggerField = typeof params.field === 'string' && def.category === 'trigger' ? params.field : undefined;
  const cronPresets = React.useMemo(() => CRON_PRESETS(t), [t]);

  return (
    <fieldset disabled={readOnly} className="pform">
      {props.map(([key, p]) => {
        const id = `${uid}-${key}`;
        const raw = params[key];
        const str = typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw);
        const label = (p.title ?? humanize(key)) + (required.has(key) && p.default === undefined ? ' *' : '');
        const hint = p.description;
        const err = errors[key];
        let control: React.ReactNode;

        if (p.ui === 'entity') {
          const optional = !required.has(key) && p.default === undefined;
          control = (
            <Select
              id={id}
              aria-label={label}
              value={str || (optional ? '__none__' : '')}
              onValueChange={v => set(key, v === '__none__' ? undefined : v)}
              placeholder={t('automations.nodeForm.chooseEntity')}
              invalid={!!err}
              options={[...(optional ? [{ value: '__none__', label: t('automations.nodeForm.noneOption') }] : []), ...env.entities.map(e => ({ value: e.key, label: e.name }))]}
            />
          );
        } else if (p.ui === 'field') {
          const ent = env.entities.find(e => e.key === params[p.dependsOn ?? 'entity']);
          const list = (ent?.fields ?? []).filter(f => !p.writableOnly || f.writable);
          control = (
            <Select
              id={id}
              aria-label={label}
              value={str}
              onValueChange={v => set(key, v)}
              placeholder={ent ? t('automations.nodeForm.chooseField') : t('automations.nodeForm.chooseEntityFirst')}
              invalid={!!err}
              disabled={!ent}
              options={list.map(f => ({ value: f.key, label: f.builtin ? f.name : `${f.name} · ${t('automations.nodeForm.customField')}` }))}
            />
          );
        } else if (p.ui === 'value') {
          const ent = env.entities.find(e => e.key === params.entity);
          const fkey = typeof params[p.dependsOn ?? 'field'] === 'string' ? (params[p.dependsOn ?? 'field'] as string) : '';
          const f = ent?.fields.find(x => x.key === fkey);
          let options: { value: string; label: string }[] | null = null;
          if (f?.options.choices?.length && (f.type === 'select' || f.type === 'multi_select')) options = f.options.choices.map(c => ({ value: c.value, label: c.label }));
          else if (f?.type === 'boolean') options = [{ value: 'true', label: t('automations.nodeForm.yesValue') }, { value: 'false', label: t('automations.nodeForm.noValue') }];
          else if (f?.type === 'user') options = env.members.map(m => ({ value: m.id, label: m.name }));
          else if (ent?.key === 'task' && fkey === 'status') options = env.statuses.map(s => ({ value: s.id, label: s.name }));
          control = options && f?.type !== 'multi_select' ? (
            <PickOrType id={id} value={str} options={options} onChange={v => set(key, v)} env={env} label={label} placeholder={t('automations.nodeForm.chooseValue')} />
          ) : (
            <TextWithVars id={id} value={str} onChange={v => set(key, v)} env={env} invalid={!!err} placeholder={f?.type === 'date' ? t('automations.nodeForm.datePlaceholder') : f?.type === 'multi_select' ? t('automations.nodeForm.multiPlaceholder') : undefined} />
          );
        } else if (p.ui === 'member') {
          const presets = [
            { value: '{{trigger.project.leadId}}', label: t('automations.nodeForm.memberPresets.projectLead') },
            { value: '{{trigger.record.assigneeId}}', label: t('automations.nodeForm.memberPresets.taskAssignee') },
            { value: '{{trigger.record.ownerId}}', label: t('automations.nodeForm.memberPresets.recordOwner') },
          ];
          control = <PickOrType id={id} value={str} options={[...presets, ...env.members.map(m => ({ value: m.id, label: m.name }))]} onChange={v => set(key, v)} env={env} label={label} placeholder={t('automations.nodeForm.chooseMember')} />;
        } else if (p.ui === 'project') {
          const presets = [{ value: '{{trigger.record.projectId}}', label: t('automations.nodeForm.projectPresets.fromTask') }];
          control = <PickOrType id={id} value={str} options={[...presets, ...env.projects.map(pr => ({ value: pr.id, label: `${pr.key} · ${pr.name}` }))]} onChange={v => set(key, v)} env={env} label={label} placeholder={t('automations.nodeForm.chooseProject')} />;
        } else if (p.ui === 'cron') {
          control = (
            <div className="col" style={{ gap: 6 }}>
              <Input id={id} className="mono" value={str} invalid={!!err} onChange={e => set(key, e.target.value)} />
              <div className="row wrap" style={{ gap: 4 }}>
                {cronPresets.map(([c, name]) => (
                  <button key={c} type="button" className="chip-btn" onClick={() => set(key, c)}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          );
        } else if (p.enum) {
          control = <Select id={id} aria-label={label} value={str} onValueChange={v => set(key, v)} options={p.enum.map(v => ({ value: v, label: humanize(v) }))} invalid={!!err} />;
        } else if (p.type === 'boolean') {
          control = <Switch id={id} checked={!!raw} onChange={e => set(key, e.target.checked)} aria-label={label} />;
        } else if (p.type === 'number' || p.type === 'integer') {
          control = <Input id={id} type="number" min={p.minimum} max={p.maximum} value={str} invalid={!!err} onChange={e => set(key, e.target.value === '' ? undefined : Number(e.target.value))} />;
        } else {
          control = <TextWithVars id={id} value={str} onChange={v => set(key, v)} env={env} multiline={p.ui === 'textarea'} mono={p.ui === 'textarea' && key === 'headers'} placeholder={p.placeholder} invalid={!!err} triggerField={triggerField} />;
        }

        return (
          <div key={key} className="field">
            <label className="label" htmlFor={id}>
              {label}
            </label>
            {control}
            {err ? <span className="err">{err}</span> : hint && <span className="hint">{hint}</span>}
          </div>
        );
      })}
    </fieldset>
  );
}
