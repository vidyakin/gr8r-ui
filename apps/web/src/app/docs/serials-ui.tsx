/* Ввод серийных номеров в строке документа или материала заказ-наряда (задача 1099). Номера — по одному в строке;
   у расходных документов под полем подсказка: номера, которые лежат на складе, добавляются кликом. */
import * as React from 'react';
import { ScanBarcode } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, IconButton, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDate, parse } from '../lib/dates';
import { useDocsApi, type DocDetail } from './data';
import { useSerials, type LineSerial } from './serials-data';

export function SerialsButton({ doc, lineId, materialId, productId, name, qty, serials, editable, warehouseId, incoming }: { doc: DocDetail; lineId?: string; materialId?: string; productId: string; name: string; qty: string; serials: LineSerial[]; editable: boolean; warehouseId: string | null; incoming: boolean }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const mine = serials.filter(s => (lineId ? s.lineId === lineId : s.materialId === materialId));
  const needed = Math.floor(Number(qty) || 0);
  const ok = mine.length === needed && needed > 0;
  return (
    <>
      <IconButton size="xs" label={t('serials.entry.buttonCount', { count: mine.length })} onClick={() => setOpen(true)}>
        <ScanBarcode size={13} style={{ color: ok ? 'var(--green)' : 'var(--amber)' }} />
      </IconButton>
      {open && <SerialsDialog doc={doc} lineId={lineId} materialId={materialId} productId={productId} name={name} needed={needed} current={mine} editable={editable} warehouseId={warehouseId} incoming={incoming} onClose={() => setOpen(false)} />}
    </>
  );
}

function SerialsDialog({ doc, lineId, materialId, productId, name, needed, current, editable, warehouseId, incoming, onClose }: { doc: DocDetail; lineId?: string; materialId?: string; productId: string; name: string; needed: number; current: LineSerial[]; editable: boolean; warehouseId: string | null; incoming: boolean; onClose: () => void }) {
  const t = useT();
  const api = useDocsApi();
  const [text, setText] = React.useState(current.map(s => s.serial).join('\n'));
  const entered = text.split('\n').map(s => s.trim()).filter(Boolean);
  // доступные номера: на складе документа (только для расходных документов)
  const stock = useSerials({ productId, warehouseId: warehouseId ?? undefined, status: 'in_stock', limit: 100 }, editable && !incoming && !!warehouseId);
  const add = (serial: string) => {
    if (entered.some(s => s.toLowerCase() === serial.toLowerCase())) return;
    setText(entered.concat(serial).join('\n'));
  };
  const save = async () => {
    const r = await api('PUT', `/documents/${doc.id}/serials`, { ...(lineId ? { lineId } : { materialId }), serials: entered });
    if (r) {
      toast(t('serials.entry.saved'));
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('serials.entry.title', { name })}
        description={editable ? t('serials.entry.hint') : t('serials.entry.posted')}
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            {editable && (
              <Button variant="primary" onClick={() => void save()}>
                {t('serials.entry.save')}
              </Button>
            )}
          </>
        }
      >
        {editable ? (
          <>
            <Textarea aria-label={t('serials.entry.button')} rows={8} value={text} onChange={e => setText(e.target.value)} placeholder={t('serials.entry.placeholder')} className="mono" />
            <p className="faint" style={{ margin: '6px 0' }} data-testid="serial-counter">
              {t('serials.entry.counter', { entered: entered.length, needed })}
            </p>
            {!!stock.data?.items.length && (
              <div>
                <p className="faint" style={{ margin: '6px 0' }}>
                  {t('serials.entry.available')} · {t('serials.entry.availableHint')}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflow: 'auto' }}>
                  {stock.data.items.map(s => (
                    <button key={s.id} type="button" className="chip mono" onClick={() => add(s.serial)}>
                      {s.serial}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {current.map(s => (
              <li key={s.serial}>
                <span className="mono">{s.serial}</span>{' '}
                {s.warrantyUntil && <Badge tone="green">{t('serials.col.warranty')}: {fmtDate(parse(s.warrantyUntil))}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
