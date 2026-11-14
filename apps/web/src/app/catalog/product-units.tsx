/* Упаковки товара в карточке (docs/plans/2026-11-14-product-packages.md): базовая единица и единицы с коэффициентом.
   Список правится черновиком и сохраняется целиком (PUT /products/:id/units). */
import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, toast } from '@/components/ui';
import { DrawerSection } from '@/components/gr8r/entity-drawer';
import { fmtNumber, useT } from '@/i18n';
import { parseNumber } from '@/i18n/format';
import { useCanWrite } from '../meta/custom-fields';
import { unitSymbol, useProductUnits, useSaveProductUnits, useUnits, type Product } from './data';

interface Draft {
  key: number;
  unitCode: string;
  factor: string;
}

/** Коэффициент из поля ввода → строка для API («100», «0.5»); null — не число > 0 */
const factorValue = (s: string): string | null => {
  const n = parseNumber(s);
  return Number.isFinite(n) && n > 0 ? String(Number(n.toFixed(6))) : null;
};

export function ProductUnitsSection({ product: p }: { product: Product }) {
  const t = useT();
  const canWrite = useCanWrite();
  const units = useUnits();
  const list = useProductUnits(p.id);
  const save = useSaveProductUnits(p.id);
  const [draft, setDraft] = React.useState<Draft[] | null>(null);
  const keyRef = React.useRef(0);
  const sym = (code: string) => unitSymbol(units.data, code);
  const rows = draft ?? (list.data?.items ?? []).map(u => ({ key: ++keyRef.current, unitCode: u.unitCode, factor: fmtNumber(u.factor, { maximumFractionDigits: 6, useGrouping: false }) }));
  const edit = (next: Draft[]) => setDraft(next);
  const free = (units.data ?? []).filter(u => u.code !== p.unitCode && !rows.some(r => r.unitCode === u.code));

  const submit = () => {
    const items = rows.map(r => ({ unitCode: r.unitCode, factor: factorValue(r.factor) }));
    if (items.some(i => i.factor === null)) return void toast.error(t('catalog.packs.invalidFactor'));
    save.mutate(items as { unitCode: string; factor: string }[], { onSuccess: () => (setDraft(null), toast(t('catalog.packs.saved'))) });
  };

  return (
    <DrawerSection title={t('catalog.packs.title')} count={list.data?.items.length || undefined}>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        {t('catalog.packs.hint')}
      </p>
      <p style={{ margin: '0 0 8px' }}>
        <span className="faint">{t('catalog.packs.base')}:</span> <b>{sym(p.unitCode)}</b>
      </p>
      {!rows.length && <p className="faint" style={{ margin: '0 0 8px' }}>{t('catalog.packs.none')}</p>}
      {!!rows.length && (
        <div className="table-wrap">
          <table className="dtbl" aria-label={t('catalog.packs.title')}>
            <thead>
              <tr>
                <th>{t('catalog.packs.unit')}</th>
                <th className="num" style={{ width: 150 }}>{t('catalog.packs.factor')}</th>
                <th>{canWrite ? '' : ' '}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td>
                    {canWrite ? (
                      <select className="select" aria-label={t('catalog.packs.unit')} value={r.unitCode} onChange={e => edit(rows.map((x, j) => (j === i ? { ...x, unitCode: e.target.value } : x)))}>
                        {(units.data ?? [])
                          .filter(u => u.code === r.unitCode || free.some(f => f.code === u.code))
                          .map(u => (
                            <option key={u.code} value={u.code}>
                              {u.symbol} — {u.name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      t('catalog.packs.equals', { unit: sym(r.unitCode), factor: r.factor, base: sym(p.unitCode) })
                    )}
                  </td>
                  <td className="num">
                    {canWrite ? (
                      <Input aria-label={t('catalog.packs.factor')} inputMode="decimal" value={r.factor} onChange={e => edit(rows.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} />
                    ) : (
                      r.factor
                    )}
                  </td>
                  <td style={{ width: 34 }}>
                    {canWrite && (
                      <IconButton label={t('catalog.packs.remove', { unit: sym(r.unitCode) })} onClick={() => edit(rows.filter((_, j) => j !== i))}>
                        <Trash2 size={14} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && (
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Button size="sm" variant="secondary" disabled={!free.length} onClick={() => edit([...rows, { key: ++keyRef.current, unitCode: free.find(u => u.code === '778')?.code ?? free[0]!.code, factor: '' }])}>
            <Plus size={14} />
            {t('catalog.packs.add')}
          </Button>
          {draft && (
            <Button size="sm" disabled={save.isPending} onClick={submit}>
              {t('catalog.packs.save')}
            </Button>
          )}
        </div>
      )}
    </DrawerSection>
  );
}
