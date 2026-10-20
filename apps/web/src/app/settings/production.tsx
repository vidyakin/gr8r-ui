/* Settings → Production: источник цены материалов при расчёте себестоимости (настройка воркспейса, меняет admin и выше). */
import * as React from 'react';
import { Link } from 'react-router';
import { MATERIAL_PRICE_SOURCES, type MaterialPriceSource } from '@gr8r/shared';
import { Alert, Radio, Skeleton, toast } from '@/components/ui';
import { useIsAdmin } from '../catalog/data';
import { useProductionApi, useSnapshot } from '../production/data';
import { SettingsHead } from './parts';

const OPTIONS: Record<MaterialPriceSource, { title: string; desc: string; disabled?: boolean }> = {
  purchase: { title: 'Purchase price', desc: 'The purchase price from the product card. Best for costing: it is what the material costs you.' },
  price: { title: 'Sale price', desc: 'The sale price from the product card. Useful when you resell materials at list price.' },
  avg_cost: { title: 'Average warehouse cost', desc: 'Moving average cost of the stock. Available once the warehouse arrives; until then the purchase price is used.', disabled: true },
};

export function ProductionSection({ title }: { title: string }) {
  const isAdmin = useIsAdmin();
  const snap = useSnapshot();
  const api = useProductionApi();
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
        <h2>Work centers</h2>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Hourly rates of shops and crews live in <Link to="/work-centers" className="crm-link">Production → Work centers</Link>.
        </p>
      </div>
    </>
  );
}
