/* Settings → Production: источник цены материалов при расчёте себестоимости (настройка воркспейса, меняет admin и выше). */
import * as React from 'react';
import { Link } from 'react-router';
import { MATERIAL_PRICE_SOURCES, type MaterialPriceSource } from '@gr8r/shared';
import { Alert, Button, Field, Input, Radio, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { useProductionApi, useSnapshot } from '../production/data';
import { usePeriods, usePeriodSettings } from '../production/closing-data';
import { SettingsHead, Toggle } from './parts';

const OPTIONS: Record<MaterialPriceSource, { title: string; desc: string; disabled?: boolean }> = {
  purchase: { title: 'Purchase price', desc: 'The purchase price from the product card. Best for costing: it is what the material costs you.' },
  price: { title: 'Sale price', desc: 'The sale price from the product card. Useful when you resell materials at list price.' },
  avg_cost: { title: 'Average warehouse cost', desc: 'Moving average cost of the stock, weighted across warehouses. A material that is not in stock yet is priced at its purchase price.' },
};

export function ProductionSection({ title }: { title: string }) {
  const isAdmin = useIsAdmin();
  const snap = useSnapshot();
  const api = useProductionApi();
  const periods = usePeriods();
  const lock = usePeriodSettings();
  const saved = snap.data?.settings.materialPriceSource;
  // Выбор виден сразу, не дожидаясь ответа сервера; при ошибке возвращается сохранённое значение
  const [picked, setPicked] = React.useState<MaterialPriceSource | null>(null);
  const current = picked ?? saved;

  const choose = async (v: MaterialPriceSource) => {
    if (v === current) return;
    setPicked(v);
    const ok = await api('PATCH', '/production/settings', { materialPriceSource: v });
    if (ok) toast('Material price source saved', { duration: 1500 });
    setPicked(null);
  };

  return (
    <>
      <SettingsHead title={title} lead="How the cost of your products is calculated." />
      <div className="sblock">
        <h2>Material price source</h2>
        <p className="muted" style={{ margin: '4px 0 12px' }}>
          Used for every material line of every bill of materials. Costs of all products are recalculated at once.
        </p>
        {snap.isPending ? (
          <Skeleton w="100%" h={90} />
        ) : (
          <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label="Material price source">
            {MATERIAL_PRICE_SOURCES.map(v => (
              <label key={v} className="srow" style={{ cursor: OPTIONS[v].disabled || !isAdmin ? 'default' : 'pointer', opacity: OPTIONS[v].disabled ? 0.6 : 1 }}>
                <div>
                  <div className="t">{OPTIONS[v].title}</div>
                  <div className="d">{OPTIONS[v].desc}</div>
                </div>
                <div className="row">
                  <Radio name="price-source" value={v} aria-label={OPTIONS[v].title} checked={current === v} disabled={OPTIONS[v].disabled || !isAdmin} onChange={() => void choose(v)} />
                </div>
              </label>
            ))}
          </div>
        )}
        {!isAdmin && (
          <Alert tone="info" className="mt-3">
            Only admins can change this setting.
          </Alert>
        )}
      </div>
      <div className="sblock">
        <h2>Period closing</h2>
        <p className="muted" style={{ margin: '4px 0 12px' }}>
          Documents dated not later than the closed-through date cannot be posted, unposted or edited. Admins move the date forward, only the owner can move it back and cancel a closing.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          <Field label="Documents up to this date are locked">
            {p => (
              <div className="row" style={{ gap: 8 }}>
                <Input {...p} type="date" value={periods.data?.closedThrough ?? ''} disabled={!isAdmin} onChange={e => void lock.mutateAsync({ closedThrough: e.target.value || null }).catch(err => toast.error(err.message))} />
                <Button size="sm" disabled={!isAdmin || !periods.data?.closedThrough} onClick={() => void lock.mutateAsync({ closedThrough: null }).then(() => toast('Period unlocked', { duration: 1500 }))}>
                  Unlock
                </Button>
              </div>
            )}
          </Field>
          <label className="srow">
            <div>
              <div className="t">Move the locked date when a month is closed</div>
              <div className="d">A successful closing moves the date to the last day of the closed month</div>
            </div>
            <Toggle
              checked={periods.data?.closeMovesLock ?? false}
              label="Move the locked date when a month is closed"
              onChange={v => void lock.mutateAsync({ closeMovesLock: v }).then(() => toast('Saved', { duration: 1200 }))}
            />
          </label>
        </div>
        <p className="muted" style={{ margin: '10px 0 0' }}>
          <Link to="/production/closing" className="crm-link">
            Production → Month closing
          </Link>{' '}
          — close a month or a period, see the allocation of indirect costs and cancel a closing.
        </p>
      </div>
      <div className="sblock">
        <h2>Work centers</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Hourly rates of shops and crews live in <Link to="/work-centers" className="crm-link">Production → Work centers</Link>.
        </p>
      </div>
    </>
  );
}
