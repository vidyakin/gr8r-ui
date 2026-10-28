/* Публичная страница прайс-листа по ссылке (задача 1178): без входа, только то, что разрешено ссылкой. Вне оболочки приложения.
   Любая причина недоступности (отозвана, истёк срок, чужой токен) показывается одинаково. */
import * as React from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button, Input, Skeleton } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { fetchPublicPriceList } from './data';

export function PublicPricePage() {
  const tt = useT();
  const { token = '' } = useParams();
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const q = useQuery({ queryKey: ['public-price', token, debounced], queryFn: () => fetchPublicPriceList(token, debounced), retry: false, placeholderData: prev => prev });
  const data = q.data;

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px var(--gutter, 16px)' }}>
      {q.isError ? (
        <div className="stack" style={{ gap: 8, textAlign: 'center', padding: '64px 0' }}>
          <h1>{tt('pricing.public.unavailable')}</h1>
          <p className="muted">{tt('pricing.public.unavailableHint')}</p>
        </div>
      ) : !data ? (
        <Skeleton w="100%" h={120} />
      ) : (
        <>
          <header className="row" style={{ justifyContent: 'space-between', alignItems: 'end', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h1>{data.title}</h1>
              <p className="muted">{data.company} · {tt('pricing.public.asOf', { date: fmtDate(data.date, true) })}</p>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Input aria-label={tt('pricing.search')} placeholder={tt('pricing.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
              <Button onClick={() => window.print()}><Printer size={14} />{tt('pricing.list.print')}</Button>
            </div>
          </header>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="dtbl" aria-label={data.title}>
              <thead>
                <tr>
                  <th style={{ width: 120 }}>{tt('pricing.sku')}</th>
                  <th>{tt('pricing.product')}</th>
                  <th style={{ width: 60 }}>{tt('pricing.unit')}</th>
                  {data.kinds.map(k => <th key={k.id} style={{ width: 130 }} className="r">{k.name}</th>)}
                  <th style={{ width: 110 }}>{tt('pricing.public.availability')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r, i) => (
                  <tr key={`${r.sku}|${i}`}>
                    <td className="mono muted">{r.sku}</td>
                    <td>{r.name}{r.category ? <span className="faint"> · {r.category}</span> : null}</td>
                    <td className="muted">{r.unit}</td>
                    {data.kinds.map(k => <td key={k.id} className="r num">{r.prices[k.id] ? fmtAmount(r.prices[k.id]) : ''}</td>)}
                    <td className="muted">{r.inStock ? tt('pricing.public.inStock') : tt('pricing.public.onOrder')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.total > data.items.length && <p className="muted" style={{ marginTop: 8 }}>{tt('pricing.list.more', { shown: data.items.length, total: data.total })}</p>}
        </>
      )}
    </main>
  );
}
