/* Боковая карточка «Сводка о ходе работ» объекта (открывается из шапки объекта) (задача 1277, docs/architecture/construction.md):
   включение, день недели и время в часовом поясе воркспейса, получатели — участники воркспейса,
   последняя отправка и кнопка «Отправить сейчас». Рядом — печать отчёта для заказчика (почта отложена, задача 1092).
   Расписание правит admin и выше или ответственный объекта; кнопка «Отправить сейчас» — member и выше. */
import * as React from 'react';
import { Send, Printer } from 'lucide-react';
import { Button, Checkbox, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { EntityDrawer } from '@/components/gr8r/entity-drawer';
import { fmtDateTime, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { useSession } from '../data/session';
import { useObjectReportApi, useObjectReportSchedule } from './report-data';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function ReportPanel({ objectId, objectName, objectNumber, managerId, canWrite, onPrint, onClose }: {
  objectId: string;
  objectName: string;
  objectNumber: string;
  managerId: string | null;
  canWrite: boolean;
  onPrint: () => void;
  onClose: () => void;
}) {
  const tt = useT();
  const ws = useWorkspace().data;
  const role = useSession().active?.role ?? 'guest';
  const schedule = useObjectReportSchedule(objectId);
  const api = useObjectReportApi(objectId);
  const members = ws.members.filter(m => m.status === 'active');
  // правит admin и выше или ответственный объекта — остальным поля только для чтения
  const canEdit = canWrite && canEditSchedule(ws.me, managerId, role);
  const [form, setForm] = React.useState<{ enabled: boolean; weekday: number; time: string; recipientIds: string[] }>({ enabled: false, weekday: 1, time: '09:00', recipientIds: [] });
  const [busy, setBusy] = React.useState(false);
  const loadedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    const d = schedule.data;
    if (!d || loadedFor.current === `${d.objectId}:${d.enabled}:${d.weekday}:${d.time}:${d.lastSentAt}:${d.recipientIds.join(',')}`) return;
    loadedFor.current = `${d.objectId}:${d.enabled}:${d.weekday}:${d.time}:${d.lastSentAt}:${d.recipientIds.join(',')}`;
    setForm({ enabled: d.enabled, weekday: d.weekday, time: d.time, recipientIds: d.recipientIds });
  }, [schedule.data]);

  const save = async () => {
    setBusy(true);
    try {
      await api.saveSchedule.mutateAsync({ enabled: form.enabled, weekday: form.weekday, time: form.time, recipientIds: form.recipientIds });
      toast(tt('objects.common.saved'), { duration: 1500 });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    setBusy(true);
    try {
      const res = await api.sendNow.mutateAsync();
      toast(tt('objects.report.sent', { count: res.notifications }), { duration: 2000 });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntityDrawer
      label={`${tt('objects.report.title')}: ${objectName}`}
      crumb={<span className="mono faint">{objectNumber}</span>}
      title={tt('objects.report.title')}
      subtitle={objectName}
      actions={
        canEdit && (
          <Button size="sm" variant="primary" disabled={busy || schedule.isPending} onClick={() => void save()}>
            {tt('objects.common.save')}
          </Button>
        )
      }
      onClose={onClose}
    >
      <p className="faint" style={{ fontSize: 12, marginTop: 8 }}>
        {tt('objects.report.hint')}
      </p>
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button variant="secondary" disabled={busy || !canWrite} onClick={() => void sendNow()}>
          <Send size={14} />
          {tt('objects.report.sendNow')}
        </Button>
        <Button variant="ghost" onClick={onPrint} title={tt('objects.report.printHint')} aria-label={`${tt('objects.report.print')}: ${objectName}`}>
          <Printer size={14} />
          {tt('objects.report.print')}
        </Button>
      </div>
      {schedule.isPending ? (
        <div style={{ marginTop: 12 }}>
          <Skeleton w="100%" h={90} />
        </div>
      ) : (
        <div className="doc-head obj-edit">
          <Field label={tt('objects.report.enabled')} hint={tt('objects.report.enabledHint')}>
            {() => (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <Checkbox checked={form.enabled} disabled={!canEdit} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
                {tt('objects.report.enabledLabel')}
              </label>
            )}
          </Field>
          <Field label={tt('objects.report.lastSent')}>
            {() => <div className="doc-ro">{schedule.data?.lastSentAt ? fmtDateTime(schedule.data.lastSentAt) : tt('objects.report.neverSent')}</div>}
          </Field>
          <Field label={tt('objects.report.weekday')}>
            {p => (
              <Select
                id={p.id}
                disabled={!canEdit}
                value={String(form.weekday)}
                onValueChange={v => setForm(f => ({ ...f, weekday: Number(v) }))}
                options={WEEKDAYS.map(d => ({ value: String(d), label: tt(`objects.report.weekdays.${d}`) }))}
                aria-label={tt('objects.report.weekday')}
              />
            )}
          </Field>
          <Field label={tt('objects.report.time')} hint={tt('objects.report.timeHint', { timezone: schedule.data?.timezone ?? 'UTC' })}>
            {p => <Input {...p} type="time" disabled={!canEdit} value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value || '09:00' }))} />}
          </Field>
          <div className="doc-wide">
            <Field label={tt('objects.report.recipients')} hint={tt('objects.report.recipientsHint')}>
              {() => (
                <div className="col" style={{ gap: 4 }}>
                  {members.map(m => (
                    <label key={m.id} className="row" style={{ gap: 8, fontSize: 13 }}>
                      <Checkbox
                        checked={form.recipientIds.includes(m.id)}
                        disabled={!canEdit}
                        onChange={e => setForm(f => ({ ...f, recipientIds: e.target.checked ? [...f.recipientIds, m.id] : f.recipientIds.filter(x => x !== m.id) }))}
                      />
                      {m.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          </div>
        </div>
      )}
      {canEdit && (
        <div className="row obj-edit-f">
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>
            {tt('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy || schedule.isPending} onClick={() => void save()}>
            {tt('objects.common.save')}
          </Button>
        </div>
      )}
    </EntityDrawer>
  );
}

/** Править расписание может owner/admin или ответственный объектов; остальным — только чтение */
function canEditSchedule(meId: string | undefined, managerId: string | null, role: string): boolean {
  return role === 'owner' || role === 'admin' || (!!meId && meId === managerId);
}
