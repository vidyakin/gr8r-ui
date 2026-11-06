/* Бейдж и рабочие без входа (задача 1271): в карточке участника — табельный номер, выпуск и перевыпуск бейджа
   и печать страницы бейджей; в списке участников — кнопка «Рабочий без входа» (участник без user_id и без membership).
   Выпуск, табельный номер и печать — только admin и выше (маршруты /members/workers и /members/:id/badge). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Barcode, Printer, UserPlus } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Field, Input, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { useIsAdmin } from '../catalog/data';
import { openBadgesPrint, useCreateWorker, useIssueBadge } from '../objects/shifts-data';

/** Данные бейджа участника: GET /members/:id (crud участников) */
interface MemberBadge {
  id: string;
  name: string;
  personnelNumber: string | null;
  badgeCode: string | null;
  status: string;
  userId: string | null;
}

/** Табельный номер, бейдж и печать — блок в карточке участника */
export function BadgePanel({ memberId }: { memberId: string }) {
  const tt = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const admin = useIsAdmin();
  const issue = useIssueBadge();
  const member = useQuery({
    queryKey: ['ws', ws, 'members', 'badge', memberId],
    queryFn: () => call<MemberBadge>(ws, 'GET', `/members/${memberId}`),
  });
  const [number, setNumber] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (member.data) setNumber(member.data.personnelNumber ?? '');
  }, [member.data]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'members'] });
  };

  const saveNumber = async () => {
    setBusy(true);
    try {
      // пустое поле очищает табельный номер
      await call(ws, 'PATCH', `/members/${memberId}`, { personnelNumber: number.trim() || null });
      await refresh();
      toast(tt('shifts.member.saved'), { duration: 1500 });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (member.isError) return <p className="faint">{errorMessage(member.error)}</p>;
  if (!member.data) return <Skeleton w="100%" h={80} />;

  return (
    <section className="panel panel-b stack" aria-label={tt('shifts.member.title')} style={{ gap: 10 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{tt('shifts.member.title')}</h3>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <Field label={tt('shifts.member.personnelNumber')}>
            {p => <Input {...p} value={number} placeholder={tt('shifts.member.personnelPlaceholder')} disabled={!admin || busy} onChange={e => setNumber(e.target.value)} />}
          </Field>
        </div>
        {admin && (
          <Button variant="secondary" disabled={busy} onClick={() => void saveNumber()}>
            {tt('common.save')}
          </Button>
        )}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="faint" style={{ fontSize: 12 }}>
          {tt('shifts.member.badge')}:
        </span>
        {member.data.badgeCode ? <Badge tone="gray">{member.data.badgeCode}</Badge> : <span className="faint" style={{ fontSize: 12 }}>{tt('shifts.member.noBadge')}</span>}
      </div>
      {admin && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            disabled={issue.isPending}
            onClick={async () => {
              try {
                const badge = await issue.mutateAsync({ memberId, personnelNumber: number.trim() || null });
                await refresh();
                toast(tt('shifts.member.issued', { code: badge.badgeCode }), { duration: 2500 });
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <Barcode size={14} />
            {member.data.badgeCode ? tt('shifts.member.reissue') : tt('shifts.member.issue')}
          </Button>
          <Button
            variant="secondary"
            disabled={!member.data.badgeCode}
            onClick={async () => {
              try {
                await openBadgesPrint(ws, [memberId]);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            <Printer size={14} />
            {tt('shifts.member.print')}
          </Button>
        </div>
      )}
      <p className="faint" style={{ margin: 0, fontSize: 11 }}>
        {tt('shifts.member.printHint')}
      </p>
    </section>
  );
}

/** Кнопки «Рабочий без входа» и «Печать бейджей» в списке участников (только admin и выше) */
export function WorkerDialog() {
  const tt = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const create = useCreateWorker();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [number, setNumber] = React.useState('');

  const submit = async () => {
    if (!name.trim()) {
      toast.error(tt('shifts.worker.empty'));
      return;
    }
    try {
      await create.mutateAsync({ name: name.trim(), personnelNumber: number.trim() || undefined });
      toast(tt('shifts.worker.created'), { duration: 1500 });
      setOpen(false);
      setName('');
      setNumber('');
      await qc.invalidateQueries({ queryKey: ['ws', ws, 'members'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const print = async () => {
    try {
      await openBadgesPrint(ws);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <UserPlus size={14} />
        {tt('shifts.worker.title')}
      </Button>
      <Button variant="secondary" onClick={() => void print()}>
        <Printer size={14} />
        {tt('shifts.member.print')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={tt('shifts.worker.title')}
          description={tt('shifts.worker.hint')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {tt('common.cancel')}
              </Button>
              <Button variant="primary" disabled={create.isPending} onClick={() => void submit()}>
                {tt('shifts.worker.create')}
              </Button>
            </>
          }
        >
          <div className="stack" style={{ gap: 10 }}>
            <Field label={tt('shifts.worker.name')}>{p => <Input {...p} value={name} onChange={e => setName(e.target.value)} />}</Field>
            <Field label={tt('shifts.worker.personnelNumber')}>{p => <Input {...p} value={number} onChange={e => setNumber(e.target.value)} />}</Field>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
