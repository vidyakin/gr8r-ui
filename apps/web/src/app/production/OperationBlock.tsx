/* Блок операции в карточке задачи: исполнитель отмечает выполненное количество — строка попадает
   в его сдельный наряд за день (мастер проверяет и проводит наряд). */
import * as React from 'react';
import { Factory } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { usePieceworkApi, useOperation, type AssignmentRow } from './piecework-data';

export function OperationBlock({ assignmentId }: { assignmentId: string }) {
  const op = useOperation(assignmentId);
  const api = usePieceworkApi();
  const [qty, setQty] = React.useState('');
  const data = op.data;

  if (op.isPending) return null;
  if (op.isError || !data) return null;

  const left = Number(data.leftQty);
  const submit = () => {
    if (!qty.trim() || Number(qty) <= 0) return;
    api.markDone.mutate({ assignmentId, qty: qty.trim() });
    setQty('');
  };

  return (
    <div className="dsec">
      <div className="dsec-h">
        <h3>Production operation</h3>
        <span className="cnt">
          <Factory size={13} /> {data.operationName}
        </span>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <Field label="Planned" className="grow">
          {p => <Input {...p} readOnly value={data.plannedQty} />}
        </Field>
        <Field label="Done" className="grow">
          {p => <Input {...p} readOnly value={data.doneQty} />}
        </Field>
        <Field label="Left" className="grow">
          {p => <Input {...p} readOnly value={data.leftQty} />}
        </Field>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
        <Field label="Mark as done" className="grow" hint="Goes to the piecework order of the day">
          {p => <Input {...p} inputMode="decimal" value={qty} placeholder={left > 0 ? String(left) : '0'} onChange={e => setQty(e.target.value)} />}
        </Field>
        <Button size="sm" variant="primary" disabled={!qty.trim() || Number(qty) <= 0 || left <= 0} onClick={submit}>
          Mark done
        </Button>
      </div>
    </div>
  );
}

export type { AssignmentRow };
