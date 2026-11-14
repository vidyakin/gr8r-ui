/* Коды и номенклатура контрагентов (docs/architecture/counterparties.md): наш код у контрагента по каждой нашей организации
   и артикулы / наименования товаров у контрагента. Вкладка «Коды» карточки контрагента и блок «Артикулы контрагентов» карточки товара. */
import * as React from 'react';
import { Trash2 } from 'lucide-react';
import { DrawerSection } from '@/components/gr8r/entity-drawer';
import { IconButton, Input, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { unitSymbol, useIsAdmin, useUnits } from '../catalog/data';
import { useCanWrite } from '../meta/custom-fields';
import { useWsId } from '../meta/data';
import { searchProducts } from '../catalog/data';
import { useCompanyArticles, useCounterpartyCodes, useDocsApi, useProductArticles, useProductSupplierPrices, type CounterpartyCode } from './data';
import { Combo, CounterpartyPicker } from './pickers';

/** Поле кода одной организации: сохраняется при уходе фокуса, пустое значение удаляет код */
function CodeRow({ companyId, row, canEdit }: { companyId: string; row: CounterpartyCode; canEdit: boolean }) {
  const api = useDocsApi();
  const t = useT();
  const [v, setV] = React.useState(row.code ?? '');
  React.useEffect(() => setV(row.code ?? ''), [row.code]);
  const commit = async () => {
    const next = v.trim();
    if (next === (row.code ?? '')) return;
    const r = await api('PUT', `/companies/${companyId}/codes/${row.organizationId}`, { code: next });
    if (r) toast(next ? t('docs.partner.codeSaved') : t('docs.partner.codeCleared'));
    else setV(row.code ?? '');
  };
  return (
    <tr>
      <td>
        {row.organizationName} {row.isDefault && <span className="faint">· {t('docs.partner.defaultOrg')}</span>}
      </td>
      <td>
        <Input aria-label={row.organizationName} placeholder={t('docs.partner.codePlaceholder')} maxLength={64} disabled={!canEdit} value={v} onChange={e => setV(e.target.value)} onBlur={() => void commit()} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
      </td>
    </tr>
  );
}

/** Строка «товар ↔ контрагент»: артикул и наименование у контрагента, сохранение при уходе фокуса из пары полей */
function ArticleRow({ label, title, initial, canEdit, onSave, onRemove, priceCell }: { label: React.ReactNode; title: string; initial?: { article: string; name: string }; canEdit: boolean; onSave: (article: string, name: string) => Promise<boolean>; onRemove: () => void; priceCell?: React.ReactNode }) {
  const t = useT();
  const [article, setArticle] = React.useState(initial?.article ?? '');
  const [name, setName] = React.useState(initial?.name ?? '');
  React.useEffect(() => {
    setArticle(initial?.article ?? '');
    setName(initial?.name ?? '');
  }, [initial?.article, initial?.name]);
  const commit = async () => {
    const a = article.trim();
    const n = name.trim();
    if (a === (initial?.article ?? '') && n === (initial?.name ?? '')) return;
    if (!a && !n) return; // пустая новая строка не сохраняется; очистка существующей — кнопкой удаления
    const ok = await onSave(a, n);
    if (ok) toast(t('docs.partner.saved'));
  };
  return (
    <tr>
      <td>{label}</td>
      <td>
        <Input aria-label={t('docs.partner.colArticle')} placeholder={t('docs.partner.articlePlaceholder')} maxLength={100} disabled={!canEdit} value={article} onChange={e => setArticle(e.target.value)} onBlur={() => void commit()} />
      </td>
      <td>
        <Input aria-label={t('docs.partner.colName')} placeholder={t('docs.partner.namePlaceholder')} maxLength={300} disabled={!canEdit} value={name} onChange={e => setName(e.target.value)} onBlur={() => void commit()} />
      </td>
      {priceCell}
      <td>
        {canEdit && (
          <IconButton size="xs" label={t('docs.partner.remove', { name: title })} onClick={onRemove}>
            <Trash2 size={13} />
          </IconButton>
        )}
      </td>
    </tr>
  );
}

interface Draft {
  id: string;
  name: string;
}

/** Вкладка «Коды» карточки контрагента */
export function CompanyPartnerTab({ companyId }: { companyId: string }) {
  const t = useT();
  const ws = useWsId();
  const canWrite = useCanWrite();
  const api = useDocsApi();
  const codes = useCounterpartyCodes(companyId);
  const articles = useCompanyArticles(companyId);
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const saved = new Set((articles.data ?? []).map(a => a.productId));

  const save = async (productId: string, article: string, name: string) => {
    const r = await api('PUT', `/companies/${companyId}/articles/${productId}`, { article, name });
    if (r) setDrafts(d => d.filter(x => x.id !== productId));
    return !!r;
  };

  return (
    <div className="page" style={{ maxWidth: 980, paddingTop: 12 }}>
      <h3 style={{ margin: '0 0 4px' }}>{t('docs.partner.codesTitle')}</h3>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        {t('docs.partner.codesHint')}
      </p>
      {codes.isPending ? (
        <Skeleton w="100%" h={60} />
      ) : !codes.data?.length ? (
        <p className="faint">{t('docs.partner.noOrganizations')}</p>
      ) : (
        <table className="dtbl" aria-label={t('docs.partner.codesTitle')} style={{ marginBottom: 24 }}>
          <thead>
            <tr>
              <th style={{ width: '45%' }}>{t('docs.header.organization')}</th>
              <th>{t('docs.partner.codesTitle')}</th>
            </tr>
          </thead>
          <tbody>
            {codes.data.map(r => (
              <CodeRow key={r.organizationId} companyId={companyId} row={r} canEdit={canWrite} />
            ))}
          </tbody>
        </table>
      )}

      <h3 style={{ margin: '0 0 4px' }}>{t('docs.partner.articlesTitle')}</h3>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        {t('docs.partner.articlesHint')}
      </p>
      {articles.isPending ? (
        <Skeleton w="100%" h={80} />
      ) : (
        <>
          {!articles.data?.length && !drafts.length && <p className="faint">{t('docs.partner.noArticles')}</p>}
          {(!!articles.data?.length || !!drafts.length) && (
            <table className="dtbl" aria-label={t('docs.partner.articlesTitle')}>
              <thead>
                <tr>
                  <th>{t('docs.partner.colProduct')}</th>
                  <th style={{ width: 180 }}>{t('docs.partner.colArticle')}</th>
                  <th style={{ width: 260 }}>{t('docs.partner.colName')}</th>
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {articles.data?.map(a => (
                  <ArticleRow
                    key={a.productId}
                    title={a.productName}
                    label={
                      <>
                        {a.productName} {a.productSku && <span className="mono faint">{a.productSku}</span>}
                      </>
                    }
                    initial={a}
                    canEdit={canWrite}
                    onSave={(article, name) => save(a.productId, article, name)}
                    onRemove={() => void api('DELETE', `/companies/${companyId}/articles/${a.productId}`)}
                  />
                ))}
                {drafts.map(d => (
                  <ArticleRow key={d.id} label={d.name} title={d.name} canEdit onSave={(article, name) => save(d.id, article, name)} onRemove={() => setDrafts(x => x.filter(y => y.id !== d.id))} />
                ))}
              </tbody>
            </table>
          )}
          {canWrite && (
            <div style={{ maxWidth: 420, marginTop: 8 }}>
              <Combo
                value=""
                aria-label={t('docs.partner.addProduct')}
                placeholder={t('docs.partner.pickProduct')}
                openOnFocus={false}
                search={q => searchProducts(ws, q, undefined, 10)}
                itemKey={p => p.id}
                onPick={p => !saved.has(p.id) && setDrafts(d => (d.some(x => x.id === p.id) ? d : [...d, { id: p.id, name: p.name }]))}
                renderItem={p => (
                  <>
                    <span className="trunc grow">{p.name}</span>
                    {p.sku && <span className="mono faint" style={{ fontSize: 11 }}>{p.sku}</span>}
                  </>
                )}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Блок «Артикулы контрагентов» карточки товара */
export function ProductPartnerArticles({ productId, baseUnit = '796' }: { productId: string; baseUnit?: string }) {
  const t = useT();
  const canWrite = useCanWrite();
  const api = useDocsApi();
  const list = useProductArticles(productId);
  const isAdmin = useIsAdmin();
  const prices = useProductSupplierPrices(productId, isAdmin);
  const priceOf = (companyId: string) => prices.data?.find(p => p.companyId === companyId)?.price ?? null;
  const units = useUnits();
  // цена за упаковку прайса и справочно за базовую единицу: «1 500,00 / упак» и «15,00 / шт»
  const priceText = (companyId: string) => {
    const r = prices.data?.find(p => p.companyId === companyId);
    if (!r?.price) return '—';
    if (!r.unitPrice || !r.unitCode) return fmtAmount(r.price);
    return (
      <>
        {t('supplierPrices.page.perUnit', { price: fmtAmount(r.unitPrice), unit: unitSymbol(units.data, r.unitCode) })}
        <div className="faint" style={{ fontSize: 11.5 }}>
          {t('supplierPrices.page.perUnit', { price: fmtAmount(r.price), unit: unitSymbol(units.data, baseUnit) })}
        </div>
      </>
    );
  };
  const priceCell = (companyId?: string) => (isAdmin ? <td className="num">{companyId && priceOf(companyId) ? priceText(companyId) : '—'}</td> : undefined);
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const savedCompanies = new Set((list.data ?? []).map(a => a.companyId));

  const save = async (companyId: string, article: string, name: string) => {
    const r = await api('PUT', `/companies/${companyId}/articles/${productId}`, { article, name });
    if (r) setDrafts(d => d.filter(x => x.id !== companyId));
    return !!r;
  };

  return (
    <DrawerSection title={t('docs.partner.articlesTitle')} count={list.data?.length || undefined}>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        {t('docs.partner.articlesHint')}
      </p>
      {list.isPending ? (
        <p className="faint" style={{ margin: 0 }}>
          {t('common.loading')}
        </p>
      ) : (
        <>
          {!list.data?.length && !drafts.length && <p className="faint">{t('docs.partner.noProductArticles')}</p>}
          {(!!list.data?.length || !!drafts.length) && (
            <div className="table-wrap">
              <table className="dtbl" aria-label={t('docs.partner.articlesTitle')}>
                <thead>
                  <tr>
                    <th>{t('docs.partner.colCompany')}</th>
                    <th style={{ width: 130 }}>{t('docs.partner.colArticle')}</th>
                    <th style={{ width: 170 }}>{t('docs.partner.colName')}</th>
                    {isAdmin && <th className="num" style={{ width: 130 }}>{t('docs.partner.colPrice')}</th>}
                    <th style={{ width: 34 }} />
                  </tr>
                </thead>
                <tbody>
                  {list.data?.map(a => (
                    <ArticleRow key={a.companyId} label={a.companyName} title={a.companyName} initial={a} canEdit={canWrite} priceCell={priceCell(a.companyId)} onSave={(article, name) => save(a.companyId, article, name)} onRemove={() => void api('DELETE', `/companies/${a.companyId}/articles/${productId}`)} />
                  ))}
                  {drafts.map(d => (
                    <ArticleRow key={d.id} label={d.name} title={d.name} canEdit priceCell={priceCell(d.id)} onSave={(article, name) => save(d.id, article, name)} onRemove={() => setDrafts(x => x.filter(y => y.id !== d.id))} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canWrite && (
            <div style={{ marginTop: 8 }}>
              <CounterpartyPicker value="" placeholder={t('docs.partner.pickCompany')} onPick={c => !savedCompanies.has(c.id) && setDrafts(d => (d.some(x => x.id === c.id) ? d : [...d, { id: c.id, name: c.name }]))} />
            </div>
          )}
        </>
      )}
    </DrawerSection>
  );
}
