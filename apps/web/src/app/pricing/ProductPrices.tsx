/* Цены товара по видам цен и история (задача 1178): блок в карточке товара каталога. Цены правит документ «Установка цен»;
   «Розничную» и «Закупочную» можно править и в самой карточке — это запись истории на сегодня. */
import * as React from 'react';
import { Button } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { usePriceHistory, useProductPrices } from './data';

export function ProductPricesBlock({ productId }: { productId: string }) {
  const tt = useT();
  const [open, setOpen] = React.useState(false);
  const prices = useProductPrices(productId);
  const history = usePriceHistory(productId, open);
  const rows = prices.data ?? [];
  return (
    <div className="stack" style={{ gap: 4 }}>
      {rows.map(r => (
        <div key={r.priceKindId} className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <span className="muted">{r.name}</span>
          <span className="num">
            {r.price === null ? '—' : fmtAmount(r.price)}
            {r.source && r.source !== 'manual' ? <span className="faint"> · {tt(`pricing.card.source.${r.source}`)}</span> : null}
          </span>
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => setOpen(v => !v)}>{tt('pricing.card.history')}</Button>
      </div>
      {open && (history.data?.length ? (
        <table className="dtbl" aria-label={tt('pricing.card.history')}>
          <tbody>
            {history.data.map(h => (
              <tr key={h.id}>
                <td className="muted">{fmtDate(h.date)}</td>
                <td>{h.priceKindName}</td>
                <td className="r num">{fmtAmount(h.price)}</td>
                <td className="muted">{h.number ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <span className="faint">{tt('pricing.card.noHistory')}</span>)}
    </div>
  );
}
