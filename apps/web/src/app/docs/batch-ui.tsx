/* Ввод партии в строке приходного документа (задача 1187): номер партии, дата выработки и годен до.
   Партия без номера не создаётся — сервер отклоняет проведение прихода товара с партионным учётом без номера. */
import * as React from 'react';
import { Package } from 'lucide-react';
import { Button, Dialog, DialogContent, IconButton, Input } from '@/components/ui';
import { DateInput } from '@/components/gr8r/date-picker';
import { useT } from '@/i18n';

export interface BatchLine {
  batchNumber: string;
  batchProducedAt: string;
  batchExpiresAt: string;
}

export function BatchButton({ line, onChange }: { line: BatchLine; onChange: (patch: Partial<BatchLine>) => void }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const ok = line.batchNumber.trim().length > 0;
  return (
    <>
      <IconButton size="xs" label={t('batches.entry.button')} onClick={() => setOpen(true)}>
        <Package size={13} style={{ color: ok ? 'var(--green)' : 'var(--amber)' }} />
      </IconButton>
      {open && (
        <Dialog open onOpenChange={o => !o && setOpen(false)}>
          <DialogContent
            title={t('batches.entry.title')}
            description={t('batches.entry.hint')}
            footer={
              <Button onClick={() => setOpen(false)}>{t('common.done')}</Button>
            }
          >
            <div className="col" style={{ gap: 10 }}>
              <label className="col" style={{ gap: 4 }}>
                <span className="muted">{t('batches.entry.number')}</span>
                <Input value={line.batchNumber} maxLength={100} onChange={e => onChange({ batchNumber: e.target.value })} autoFocus />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="muted">{t('batches.entry.producedAt')}</span>
                <DateInput value={line.batchProducedAt} onChange={v => onChange({ batchProducedAt: v })} />
              </label>
              <label className="col" style={{ gap: 4 }}>
                <span className="muted">{t('batches.entry.expiresAt')}</span>
                <DateInput value={line.batchExpiresAt} onChange={v => onChange({ batchExpiresAt: v })} />
              </label>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
