/* Карточка объекта объектного учёта (задача 1268): шапка с полями и вкладки «Смета», «Вехи», «Бюджет», «Табель», «Задачи», «Документы», «Платежи», «Склад».
   Деньги в вкладках видят owner и admin (их маскирует сервер); создание объекта заводит проект задач.
   Смета (задача 1269) — отдельная вкладка: основная смета, допработы, редактор позиций и заказы.
   Процент выполнения и вехи (задача 1272): индикатор и способ расчёта в шапке, вехи — отдельная вкладка.
   Табель (задача 1271): смены по датам и табель работников за месяц — отдельная вкладка ShiftsTab. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Archive, CircleAlert, Save } from 'lucide-react';
import { BUDGET_POLICIES, OBJECT_PROGRESS_MODES, OBJECT_STATUSES, REVENUE_MODES, type BudgetPolicy, type ObjectProgressMode, type ObjectStatus, type RevenueMode } from '@gr8r/shared';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, Field, Input, Progress, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useSession } from '../data/session';
import { useWorkspace } from '../data/store';
import { statusName } from '../data/selectors';
import { useCompanies } from '../catalog/data';
import { useWarehouses } from '../docs/data';
import { DocTabs } from '../docs/doc-tabs';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { useObject, useObjectApi, useObjectProgress, useObjectSummary, useObjectTasks, type ObjectInput } from './data';
import { useObjectEstimates } from './estimates-data';
import { EstimateTab } from './EstimateTab';
import { MilestonesTab } from './MilestonesTab';
import { BudgetTab } from './BudgetTab';
import { ShiftsTab } from './ShiftsTab';
import { ActsTab } from './ActsTab';

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): ObjectInput => ({ number: '', name: '', customerId: null, address: '', startDate: today(), dueDate: null, status: 'planning', managerId: null, revenueMode: 'acts', overheadPct: '', customerHourRate: '', budgetPolicy: 'warn', progressMode: 'tasks_closed', progressManual: '', projectId: null, warehouseId: null, note: '', foremen: [], contracts: [] });
const trim = (v: string | null | undefined) => (v == null ? '' : v.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'));

export function ObjectPage() {
  const tt = useT();
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  // отмена подписи акта — admin и выше (задача 1273)
  const canAdmin = ['owner', 'admin'].includes(useSession().active?.role ?? '');
  const api = useObjectApi();
  const doc = useObject(isNew ? undefined : id);
  const detail = isNew ? null : doc.data;
  const summary = useObjectSummary(isNew ? undefined : id);
  const progress = useObjectProgress(isNew ? undefined : id);
  const tasks = useObjectTasks(isNew ? undefined : id);
  const estimates = useObjectEstimates(isNew ? undefined : id);
  const companies = useCompanies();
  const warehouses = useWarehouses();
  const wsData = useWorkspace().data;
  const members = wsData.members.filter(m => m.status === 'active');
  const statuses = wsData.statuses;
  const [form, setForm] = React.useState<ObjectInput>(blank);
  const [busy, setBusy] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!detail || loadedFor.current === detail.id + detail.updatedAt) return;
    loadedFor.current = detail.id + detail.updatedAt;
    setForm({
      number: detail.number,
      name: detail.name,
      customerId: detail.customerId,
      address: detail.address,
      startDate: detail.startDate,
      dueDate: detail.dueDate,
      status: detail.status,
      managerId: detail.managerId,
      revenueMode: detail.revenueMode,
      overheadPct: trim(detail.overheadPct),
      customerHourRate: trim(detail.customerHourRate),
      budgetPolicy: detail.budgetPolicy,
      progressMode: detail.progressMode,
      progressManual: trim(detail.progressManual),
      projectId: detail.projectId,
      warehouseId: detail.warehouseId,
      note: detail.note,
      foremen: detail.foremen,
      contracts: detail.contractIds,
    });
  }, [detail]);

  const set = <K extends keyof ObjectInput>(k: K, v: ObjectInput[K]) => setForm(f => ({ ...f, [k]: v }));
  const archived = !!detail?.archivedAt;
  const editable = canWrite && !archived;

  const save = async () => {
    if (!form.number.trim() || !form.name.trim()) {
      toast.error(tt('objects.field.number'));
      return;
    }
    setBusy(true);
    try {
      const body: ObjectInput = {
        ...form,
        overheadPct: form.overheadPct || undefined,
        customerHourRate: form.customerHourRate?.trim() ? form.customerHourRate.trim() : null,
        progressManual: form.progressManual?.trim() ? form.progressManual.trim() : null,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
        customerId: form.customerId || null,
        managerId: form.managerId || null,
        warehouseId: form.warehouseId || null,
      };
      if (detail) await api.update(detail.id, body);
      else {
        const created = await api.create(body);
        await navigate(`/objects/${created.id}`, { replace: true });
      }
      toast(tt('objects.common.saved'), { duration: 1500 });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!detail) return;
    setArchiving(false);
    setBusy(true);
    try {
      await api.archive(detail.id);
      await navigate('/objects', { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && doc.isPending)
    return (
      <div className="page flush">
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={40} />
        </div>
      </div>
    );
  if (!isNew && doc.isError)
    return (
      <div className="page flush">
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('objects.common.error')} action={<Button size="sm" onClick={() => doc.refetch()}>{tt('objects.common.retry')}</Button>}>
          {(doc.error as Error).message}
        </EmptyState>
      </div>
    );

  const s = summary.data;
  // ширина полосы — только показ: процент приходит строкой с одним знаком после запятой
  const progressPct = progress.data?.percent == null ? 0 : Number(progress.data.percent);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{isNew ? tt('objects.list.new') : form.name || tt('objects.list.title')}</h1>
          <p className="faint">
            {!isNew && <span className="mono">{form.number}</span>}
            {!isNew && detail?.status && (
              <Badge tone={detail.status === 'active' ? 'green' : detail.status === 'hold' ? 'amber' : detail.status === 'done' || detail.status === 'closed' ? 'neutral' : 'gray'} dot>
                {tt(`objects.status.${detail.status}`)}
              </Badge>
            )}
          </p>
        </div>
        <div className="acts">
          {!isNew && (
            <div className="row" style={{ gap: 8, alignItems: 'center', minWidth: 200 }} title={tt('objects.progress.title')}>
              <Progress value={progressPct} tone={progressPct >= 100 ? 'green' : undefined} aria-label={tt('objects.progress.title')} />
              <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>
                {progress.data?.percent == null ? '—' : `${progress.data.percent}%`}
              </span>
              <span className="faint" style={{ fontSize: 11 }}>
                {progress.data?.percent == null ? tt('objects.progress.empty') : tt(`objects.progress.mode.${progress.data.mode}`)}
              </span>
            </div>
          )}
          {archived && <Badge tone="neutral">{tt('objects.common.archived')}</Badge>}
          {editable && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setArchiving(true)}>
                <Archive size={14} />
                {tt('objects.common.archive')}
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void save()}>
                <Save size={14} />
                {tt('objects.common.save')}
              </Button>
            </>
          )}
          {isNew && (
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              <Save size={14} />
              {tt('objects.common.save')}
            </Button>
          )}
        </div>
      </div>

      <section className="doc-head panel" aria-label={tt('objects.list.title')}>
        <Field label={tt('objects.field.number')}>{p => <Input {...p} disabled={!editable} value={form.number} onChange={e => set('number', e.target.value)} />}</Field>
        <Field label={tt('objects.field.name')}>{p => <Input {...p} disabled={!editable} value={form.name} onChange={e => set('name', e.target.value)} />}</Field>
        <Field label={tt('objects.field.customer')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={form.customerId ?? ''}
              onValueChange={v => set('customerId', v || null)}
              options={[{ value: '', label: tt('objects.field.none') }, ...(companies.data ?? []).map(c => ({ value: c.id, label: c.name }))]}
              aria-label={tt('objects.field.customer')}
            />
          )}
        </Field>
        <Field label={tt('objects.field.status')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={form.status ?? 'planning'}
              onValueChange={v => set('status', v as ObjectStatus)}
              options={OBJECT_STATUSES.map(x => ({ value: x, label: tt(`objects.status.${x}`) }))}
              aria-label={tt('objects.field.status')}
            />
          )}
        </Field>
        <Field label={tt('objects.field.manager')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={form.managerId ?? ''}
              onValueChange={v => set('managerId', v || null)}
              options={[{ value: '', label: tt('objects.field.none') }, ...members.map(m => ({ value: m.id, label: m.name }))]}
              aria-label={tt('objects.field.manager')}
            />
          )}
        </Field>
        <Field label={tt('objects.field.startDate')}>{p => <Input {...p} type="date" disabled={!editable} value={form.startDate ?? ''} onChange={e => set('startDate', e.target.value || null)} />}</Field>
        <Field label={tt('objects.field.dueDate')}>{p => <Input {...p} type="date" disabled={!editable} value={form.dueDate ?? ''} onChange={e => set('dueDate', e.target.value || null)} />}</Field>
        <Field label={tt('objects.field.revenueMode')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={form.revenueMode ?? 'acts'}
              onValueChange={v => set('revenueMode', v as RevenueMode)}
              options={REVENUE_MODES.map(x => ({ value: x, label: tt(`objects.revenue.${x}`) }))}
              aria-label={tt('objects.field.revenueMode')}
            />
          )}
        </Field>
        <Field label={tt('objects.field.overheadPct')} hint={tt('objects.field.overheadHint')}>
          {p => <Input {...p} inputMode="decimal" disabled={!editable} value={form.overheadPct ?? ''} onChange={e => set('overheadPct', e.target.value)} />}
        </Field>
        {/* Ставка часа для заказчика (задача 1273): выручка «по часам» = подтверждённые часы смен × ставка */}
        <Field label={tt('objects.field.customerHourRate')} hint={tt('objects.field.customerHourRateHint')}>
          {p => <Input {...p} inputMode="decimal" disabled={!editable} value={form.customerHourRate ?? ''} onChange={e => set('customerHourRate', e.target.value)} />}
        </Field>
        <Field label={tt('objects.field.budgetPolicy')} hint={tt('objects.field.budgetPolicyHint')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={form.budgetPolicy ?? 'warn'}
              onValueChange={v => set('budgetPolicy', v as BudgetPolicy)}
              options={BUDGET_POLICIES.map(x => ({ value: x, label: tt(`objects.budgetPolicy.${x}`) }))}
              aria-label={tt('objects.field.budgetPolicy')}
            />
          )}
        </Field>
        <Field label={tt('objects.field.progressMode')} hint={tt('objects.field.progressModeHint')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={form.progressMode ?? 'tasks_closed'}
              onValueChange={v => set('progressMode', v as ObjectProgressMode)}
              options={OBJECT_PROGRESS_MODES.map(x => ({ value: x, label: tt(`objects.progress.mode.${x}`) }))}
              aria-label={tt('objects.field.progressMode')}
            />
          )}
        </Field>
        {form.progressMode === 'manual' && (
          <Field label={tt('objects.field.progressManual')} hint={tt('objects.field.progressManualHint')}>
            {p => <Input {...p} inputMode="decimal" disabled={!editable} value={form.progressManual ?? ''} onChange={e => set('progressManual', e.target.value)} />}
          </Field>
        )}
        <Field label={tt('objects.field.warehouse')}>
          {p => (
            <Select
              id={p.id}
              disabled={!editable}
              value={form.warehouseId ?? ''}
              onValueChange={v => set('warehouseId', v || null)}
              options={[{ value: '', label: tt('objects.field.none') }, ...(warehouses.data ?? []).filter(w => !w.archivedAt || w.id === form.warehouseId).map(w => ({ value: w.id, label: w.name }))]}
              aria-label={tt('objects.field.warehouse')}
            />
          )}
        </Field>
        <Field label={tt('objects.field.address')}>{p => <Input {...p} disabled={!editable} value={form.address ?? ''} onChange={e => set('address', e.target.value)} />}</Field>
        {!isNew && form.projectId && (
          <Field label={tt('objects.field.project')}>
            {() => (
              <div className="doc-ro">
                <Link className="crm-link" to={`/projects/${form.projectId}`}>
                  {detail?.projectName ?? form.projectId}
                </Link>
              </div>
            )}
          </Field>
        )}
        <Field label={tt('objects.field.foremen')}>
          {() => (
            <div className="col" style={{ gap: 4 }}>
              {members.map(m => (
                <label key={m.id} className="row" style={{ gap: 8, fontSize: 13 }}>
                  <Checkbox
                    checked={(form.foremen ?? []).includes(m.id)}
                    disabled={!editable}
                    onChange={e => set('foremen', e.target.checked ? [...(form.foremen ?? []), m.id] : (form.foremen ?? []).filter(x => x !== m.id))}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          )}
        </Field>
        <Field label={tt('objects.field.note')}>{p => <Input {...p} disabled={!editable} value={form.note ?? ''} onChange={e => set('note', e.target.value)} />}</Field>
      </section>

      {!isNew && (
        <div style={{ padding: '0 var(--gutter)' }}>
          {s && !s.canSeeCost && <p className="faint" style={{ fontSize: 12 }}>{tt('objects.common.hiddenAmounts')}</p>}
          <DocTabs
            label={tt('objects.list.title')}
            tabs={[
              {
                id: 'estimate',
                label: tt('estimates.title'),
                count: estimates.data?.length,
                content: <EstimateTab objectId={detail!.id} objectName={detail!.name} canWrite={canWrite && !archived} />,
              },
              {
                id: 'acts',
                label: tt('objects.acts.title'),
                count: undefined,
                content: <ActsTab objectId={detail!.id} canWrite={canWrite && !archived} canAdmin={canAdmin} />,
              },
              {
                id: 'milestones',
                label: tt('objects.milestones.title'),
                count: undefined,
                content: <MilestonesTab objectId={detail!.id} canWrite={canWrite && !archived} />,
              },
              // Табель прораба (задача 1271): смены по датам и табель за месяц
              {
                id: 'shifts',
                label: tt('shifts.tab.title'),
                count: undefined,
                content: <ShiftsTab objectId={detail!.id} />,
              },
              {
                id: 'budget',
                label: tt('objects.budget.title'),
                content: <BudgetTab objectId={detail!.id} />,
              },
              {
                id: 'tasks',
                label: tt('objects.tabs.tasks'),
                count: s?.taskCount,
                content: (tasks.data?.items.length ?? 0) ? (
                  <div className="table-wrap">
                    <table className="dtbl">
                      <thead>
                        <tr>
                          <th style={{ width: 120 }}>#</th>
                          <th>{tt('objects.field.name')}</th>
                          <th style={{ width: 140 }}>{tt('objects.field.status')}</th>
                          <th style={{ width: 120 }}>{tt('objects.field.dueDate')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.data!.items.map(x => (
                          <tr key={x.id}>
                            <td className="mono">{x.key}</td>
                            <td>{x.title}</td>
                            <td className="muted">{statusName(statuses.find(st => st.id === x.status) ?? { id: x.status, name: x.status })}</td>
                            <td className="muted">{x.dueDate ? fmtDate(x.dueDate) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="faint" style={{ padding: '12px 0' }}>{tt('objects.tasks.empty')}</p>
                ),
              },
              {
                id: 'documents',
                label: tt('objects.tabs.documents'),
                count: s?.documents.length,
                content: s?.documents.length ? (
                  <div className="table-wrap">
                    <table className="dtbl">
                      <thead>
                        <tr>
                          <th style={{ width: 140 }}>{tt('objects.documents.type')}</th>
                          <th style={{ width: 140 }}>{tt('objects.documents.number')}</th>
                          <th style={{ width: 120 }}>{tt('objects.documents.date')}</th>
                          <th style={{ width: 140 }} className="r">{tt('objects.documents.amount')}</th>
                          <th style={{ width: 120 }}>{tt('objects.documents.status')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.documents.map(x => (
                          <tr key={x.id}>
                            <td>{x.type}</td>
                            <td className="mono">
                              <Link className="crm-link" to={`/documents/${x.id}`}>
                                {x.number ?? '—'}
                              </Link>
                            </td>
                            <td className="muted">{fmtDate(x.date)}</td>
                            <td className="r num">{x.total == null ? '—' : fmtAmount(x.total)}</td>
                            <td className="muted">{x.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="faint" style={{ padding: '12px 0' }}>{tt('objects.documents.empty')}</p>
                ),
              },
              {
                id: 'payments',
                label: tt('objects.tabs.payments'),
                count: s?.payments.length,
                content: s?.payments.length ? (
                  <div className="table-wrap">
                    <table className="dtbl">
                      <thead>
                        <tr>
                          <th style={{ width: 160 }}>{tt('objects.payments.document')}</th>
                          <th style={{ width: 120 }}>{tt('objects.payments.date')}</th>
                          <th style={{ width: 140 }} className="r">{tt('objects.payments.amount')}</th>
                          <th>{tt('objects.payments.comment')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.payments.map(x => (
                          <tr key={x.id}>
                            <td className="mono">
                              <Link className="crm-link" to={`/money/${x.documentId}`}>
                                {x.documentNumber ?? x.documentType}
                              </Link>
                            </td>
                            <td className="muted">{fmtDate(x.documentDate)}</td>
                            <td className="r num">{x.amount == null ? '—' : fmtAmount(x.amount)}</td>
                            <td className="muted">{x.comment || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="faint" style={{ padding: '12px 0' }}>{tt('objects.payments.empty')}</p>
                ),
              },
              {
                id: 'stock',
                label: tt('objects.tabs.stock'),
                count: s?.stock.length,
                content: s?.stock.length ? (
                  <div className="table-wrap">
                    <table className="dtbl">
                      <thead>
                        <tr>
                          <th>{tt('objects.stock.product')}</th>
                          <th style={{ width: 140 }}>{tt('objects.stock.sku')}</th>
                          <th style={{ width: 120 }} className="r">{tt('objects.stock.qty')}</th>
                          <th style={{ width: 140 }} className="r">{tt('objects.stock.cost')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.stock.map(x => (
                          <tr key={x.productId}>
                            <td>{x.name}</td>
                            <td className="mono muted">{x.sku}</td>
                            <td className="r num">
                              {x.qty} {x.unitCode}
                            </td>
                            <td className="r num">{x.avgCost == null ? '—' : fmtAmount(x.avgCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="faint" style={{ padding: '12px 0' }}>{tt('objects.stock.empty')}</p>
                ),
              },
            ]}
          />
        </div>
      )}

      {archiving && detail && (
        <ConfirmDialog
          open
          danger
          title={tt('objects.common.archive')}
          confirmLabel={tt('objects.common.archive')}
          onOpenChange={open => !open && setArchiving(false)}
          onConfirm={() => void archive()}
          description=""
        />
      )}
    </div>
  );
}
