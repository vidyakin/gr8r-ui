/* Contracts and tariff plans (stage 8 «UNF: Services»).
   Contracts are a common directory: with a customer, with a supplier, other. A service contract adds billing:
   a tariff plan, a periodicity (month / quarter / year), a billing day and a document package (invoice or invoice + act). */
import { usePriceKinds } from '../pricing/data';
import * as React from 'react';
import { CircleAlert, FileSignature, Plus, Trash2 } from 'lucide-react';
import { BILLING_PACKAGE_LABELS, BILLING_PACKAGES, BILLING_PERIODICITIES, BILLING_PERIODICITY_LABELS, CONTRACT_KIND_LABELS, CONTRACT_KINDS, EXTRA_PRODUCT_POLICIES, EXTRA_PRODUCT_POLICY_LABELS, type ContractKind, type ExtraProductPolicy } from '@gr8r/shared';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
import { tEnum, useT } from '@/i18n';
import { useCanWrite } from '../meta/custom-fields';
import { fmtDate, parse } from '../lib/dates';
import { useBillingApi, useContracts, useTariffPlans, type Contract, type TariffPlan } from './billing-data';
import { CounterpartyPicker } from './pickers';
import { useProducts } from '../catalog/data';

/* ---------------- contracts ---------------- */

export function ContractsPage() {
  const canWrite = useCanWrite();
  const api = useBillingApi();
  const filters = useFilterState();
  const t = useT();
  const contracts = useContracts({ q: filters.q || undefined });
  const [creating, setCreating] = React.useState(false);

  const columns: Column<Contract>[] = [
    { id: 'number', header: t('docs.contracts.col.number'), width: 140, value: c => c.number, cell: c => <span className="mono">{c.number || '—'}</span> },
    { id: 'company', header: t('docs.contracts.col.counterparty'), width: 240, value: c => c.companyName, cell: c => <span className="trunc">{c.companyName}</span> },
    { id: 'kind', header: t('docs.contracts.col.kind'), width: 110, value: c => tEnum('contractKind', 'k_' + c.kind, CONTRACT_KIND_LABELS[c.kind]), cell: c => <span className="muted">{tEnum('contractKind', 'k_' + c.kind, CONTRACT_KIND_LABELS[c.kind])}</span> },
    { id: 'period', header: t('docs.contracts.col.valid'), width: 200, value: c => `${c.validFrom}…${c.validTo ?? ''}`, cell: c => <span className="num muted">{c.validTo ? `${fmtDate(parse(c.validFrom))} — ${fmtDate(parse(c.validTo))}` : `${fmtDate(parse(c.validFrom))} — ${t('docs.contracts.indefiniteShort')}`}</span> },
    { id: 'service', header: t('docs.contracts.periodicity'), width: 150, value: c => (c.isService ? c.periodicity ?? '' : ''), cell: c => (c.isService ? <Badge tone="accent">{c.periodicity ? tEnum('periodicity', c.periodicity, BILLING_PERIODICITY_LABELS[c.periodicity]) : t('docs.contracts.isService')}</Badge> : <span className="faint">—</span>) },
    { id: 'signed', header: t('docs.contracts.col.signed'), width: 100, value: c => (c.isSigned ? t('common.yes') : t('common.no')), cell: c => (c.isSigned ? <Badge tone="green">{t('docs.contracts.signed')}</Badge> : <span className="faint">{t('common.no')}</span>) },
    { id: 'default', header: t('docs.contracts.defaultForCustomer'), width: 100, value: c => (c.isDefault ? t('common.yes') : t('common.no')), cell: c => (c.isDefault ? <Badge tone="accent">{t('docs.contracts.defaultShort')}</Badge> : <span className="faint">—</span>) },
  ];
  const table = useDataTable(columns, { sort: { id: 'number', dir: 1 } });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.contracts.title')}</h1>
          <p>{t('docs.contracts.contractsLead')}</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} />
              {t('docs.contracts.newContract')}
            </Button>
          )}
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: t('docs.contracts.searchPlaceholder') }}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      <div className="pane">
        {contracts.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : !contracts.data?.items.length ? (
          <EmptyState icon={<FileSignature size={20} />} title={t('docs.contracts.emptyTitle')} action={canWrite ? <Button onClick={() => setCreating(true)}>{t('docs.contracts.newContract')}</Button> : undefined}>
            {t('docs.contracts.emptyHint')}
          </EmptyState>
        ) : (
          <DataTable columns={columns} table={table} rows={contracts.data.items} getId={c => c.id} aria-label={t('docs.contracts.contractsAria')} />
        )}
      </div>
      {creating && <ContractDialog api={api} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Диалог договора: реквизиты, срок действия и условия биллинга */
function ContractDialog({ api, onClose, contract }: { api: ReturnType<typeof useBillingApi>; onClose: () => void; contract?: Contract }) {
  const plans = useTariffPlans();
  const t = useT();
  const [company, setCompany] = React.useState<{ id: string; name: string } | null>(contract ? { id: contract.companyId, name: contract.companyName } : null);
  const [number, setNumber] = React.useState(contract?.number ?? '');
  const [date, setDate] = React.useState(contract?.date ?? new Date().toISOString().slice(0, 10));
  const [kind, setKind] = React.useState<ContractKind>(contract?.kind ?? 'customer');
  const [category, setCategory] = React.useState(contract?.category ?? '');
  const [isSigned, setIsSigned] = React.useState(contract?.isSigned ?? false);
  const [isDefault, setIsDefault] = React.useState(contract?.isDefault ?? false);
  const [validFrom, setValidFrom] = React.useState(contract?.validFrom ?? new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = React.useState(contract?.validTo ?? '');
  const [paymentDays, setPaymentDays] = React.useState(String(contract?.paymentDays ?? 0));
  const [priceKindId, setPriceKindId] = React.useState(contract?.priceKindId ?? '');
  const priceKinds = usePriceKinds();
  const [isService, setIsService] = React.useState(contract?.isService ?? false);
  const [tariffPlanId, setTariffPlanId] = React.useState(contract?.tariffPlanId ?? '');
  const [periodicity, setPeriodicity] = React.useState(contract?.periodicity ?? 'month');
  const [billingDay, setBillingDay] = React.useState(String(contract?.billingDay ?? 1));
  const [documentPackage, setDocumentPackage] = React.useState<'invoice' | 'invoice_act'>(contract?.documentPackage ?? 'invoice');

  const save = async () => {
    if (!company) return toast.error(t('docs.contracts.chooseCustomer'));
    const body = {
      companyId: company.id,
      number: number.trim(),
      date,
      kind,
      category: category.trim(),
      isSigned,
      isDefault,
      validFrom,
      validTo: validTo || null,
      paymentDays: Number(paymentDays) || 0,
      priceKindId: priceKindId || null,
      isService,
      tariffPlanId: isService ? tariffPlanId || null : null,
      periodicity: isService ? periodicity : null,
      billingDay: Number(billingDay) || 1,
      documentPackage,
    };
    const r = contract ? await api('PATCH', `/contracts/${contract.id}`, body) : await api('POST', '/contracts', body);
    if (r) {
      const warnings = (r as Contract).warnings ?? [];
      toast(warnings.length ? warnings[0]! : contract ? t('docs.contracts.contractSaved') : t('docs.contracts.contractCreated'));
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent title={contract ? t('docs.contracts.editContract') : t('docs.contracts.newContract')}>
        <div className="stack" style={{ gap: 12 }}>
          <Field label={t('docs.contracts.counterparty')}>{({ id }) => <CounterpartyPicker id={id} value={company?.name ?? ''} onPick={c => setCompany({ id: c.id, name: c.name })} />}</Field>
          <div className="row" style={{ gap: 8 }}>
            <Field label={t('docs.contracts.number')}>{({ id }) => <Input id={id} value={number} onChange={e => setNumber(e.target.value)} placeholder={t('docs.contracts.numberPlaceholder')} />}</Field>
            <Field label={t('docs.contracts.date')}>{({ id }) => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} />}</Field>
            <Field label={t('docs.contracts.kind')}>{({ id }) => <Select id={id} value={kind} onValueChange={v => setKind(v as ContractKind)} options={CONTRACT_KINDS.map(k => ({ value: k, label: tEnum('contractKind', 'k_' + k, CONTRACT_KIND_LABELS[k]) }))} />}</Field>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Field label={t('docs.contracts.validFrom')}>{({ id }) => <Input id={id} type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />}</Field>
            <Field label={t('docs.contracts.validTo')}>{({ id }) => (<Input id={id} type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />)}</Field>
            <Field label={t('docs.contracts.category')}>{({ id }) => <Input id={id} value={category} onChange={e => setCategory(e.target.value)} placeholder={t('docs.contracts.categoryPlaceholder')} />}</Field>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Field label={t('docs.contracts.paymentDays')}>{({ id }) => (<Input id={id} value={paymentDays} onChange={e => setPaymentDays(e.target.value)} />)}</Field>
            <Field label={t('docs.contracts.priceType')}>{({ id }) => <Select id={id} value={priceKindId} placeholder={t('pricing.doc.auto')} onValueChange={setPriceKindId} options={[{ value: '', label: t('pricing.doc.auto') }, ...(priceKinds.data ?? []).map(k => ({ value: k.id, label: k.name }))]} />}</Field>
          </div>
          <div className="row" style={{ gap: 16 }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={isSigned} onChange={e => setIsSigned(e.target.checked)} /> {t('docs.contracts.signed')}
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> {t('docs.contracts.defaultForCustomerLong')}
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={isService} onChange={e => setIsService(e.target.checked)} /> {t('docs.contracts.isService')}
            </label>
          </div>
          {isService && (
            <>
              <Alert tone="info">{t('docs.contracts.serviceHint')}</Alert>
              <div className="row" style={{ gap: 8 }}>
                <Field label={t('docs.contracts.tariffPlan')}>
                  {({ id }) => (
                    <Select
                      id={id}
                      value={tariffPlanId}
                      onValueChange={v => setTariffPlanId(v)}
                      placeholder={t('docs.contracts.tariffPlanPlaceholder')}
                      options={(plans.data ?? []).map(p => ({ value: p.id, label: p.name }))}
                    />
                  )}
                </Field>
                <Field label={t('docs.contracts.periodicity')}>{({ id }) => <Select id={id} value={periodicity} onValueChange={v => setPeriodicity(v as (typeof BILLING_PERIODICITIES)[number])} options={BILLING_PERIODICITIES.map(p => ({ value: p, label: tEnum('periodicity', p, BILLING_PERIODICITY_LABELS[p]) }))} />}</Field>
                <Field label={t('docs.contracts.billingDay')}>{({ id }) => (<Input id={id} value={billingDay} onChange={e => setBillingDay(e.target.value)} />)}</Field>
                <Field label={t('docs.contracts.documents')}>{({ id }) => <Select id={id} value={documentPackage} onValueChange={v => setDocumentPackage(v as 'invoice' | 'invoice_act')} options={BILLING_PACKAGES.map(p => ({ value: p, label: tEnum('billingPackage', p, BILLING_PACKAGE_LABELS[p]) }))} />}</Field>
              </div>
            </>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- tariff plans ---------------- */

export function TariffPlansPage() {
  const api = useBillingApi();
  const plans = useTariffPlans();
  const t = useT();
  const [name, setName] = React.useState('');
  const [policy, setPolicy] = React.useState<ExtraProductPolicy>('allow');
  const [openId, setOpenId] = React.useState<string | null>(null);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.contracts.tariffTitle')}</h1>
          <p>{t('docs.contracts.tariffLead')}</p>
        </div>
      </div>
      <div className="pane">
        {plans.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : !plans.data?.length ? (
          <EmptyState icon={<CircleAlert size={20} />} title={t('docs.contracts.tariffEmptyTitle')}>
            {t('docs.contracts.tariffEmptyHint')}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {plans.data.map(p => (
              <div key={p.id} className="sblock">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <b>{p.name}</b>{' '}
                    <Badge tone={p.extraProductPolicy === 'forbid' ? 'red' : p.extraProductPolicy === 'warn' ? 'amber' : 'gray'}>
                      {t('docs.contracts.extraProducts')}: {tEnum('extraPolicy', p.extraProductPolicy, EXTRA_PRODUCT_POLICY_LABELS[p.extraProductPolicy])}
                    </Badge>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {t('docs.contracts.positionsCount', { n: p.lines.length })}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                    {openId === p.id ? t('docs.contracts.hidePositions') : t('docs.contracts.showPositions')}
                  </Button>
                </div>
                {openId === p.id && <TariffPlanLines plan={p} api={api} />}
              </div>
            ))}
          </div>
        )}
        <div className="doc-add">
          <Input aria-label={t('docs.contracts.tariffNameAria')} value={name} placeholder={t('docs.contracts.tariffNamePlaceholder')} onChange={e => setName(e.target.value)} />
          <Select value={policy} onValueChange={v => setPolicy(v as ExtraProductPolicy)} options={EXTRA_PRODUCT_POLICIES.map(p => ({ value: p, label: tEnum('extraPolicy', p, EXTRA_PRODUCT_POLICY_LABELS[p]) }))} />
          <Button
            size="sm"
            variant="ghost"
            disabled={!name.trim()}
            onClick={async () => {
              const r = await api('POST', '/tariff-plans', { name: name.trim(), extraProductPolicy: policy });
              if (r) {
                setName('');
                toast(t('docs.contracts.tariffCreated'));
              }
            }}
          >
            <Plus size={13} />
            {t('docs.contracts.addTariff')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Позиции тарифного плана: товар, количество, цена, абонплата и представление в счёте */
function TariffPlanLines({ plan, api }: { plan: TariffPlan; api: ReturnType<typeof useBillingApi> }) {
  const products = useProducts();
  const t = useT();
  const [lines, setLines] = React.useState(plan.lines);
  React.useEffect(() => setLines(plan.lines), [plan.id, plan.lines.length]);

  const save = async () => {
    const r = await api('POST', `/tariff-plans/${plan.id}/lines`, {
      lines: lines.map(l => ({ productId: l.productId, qty: l.qty, price: l.price, isSubscription: l.isSubscription, invoiceAsProductId: l.invoiceAsProductId ?? null })),
    });
    if (r) toast(t('docs.contracts.linesSaved'));
  };

  return (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      {lines.map((l, i) => (
        <div key={l.id || i} className="row" style={{ gap: 8 }}>
          <Select
            value={l.productId}
            onValueChange={v => {
              const p = (products.data ?? []).find(x => x.id === v);
              setLines(prev => prev.map((x, j) => (j === i ? { ...x, productId: v, productName: p?.name ?? x.productName, unitCode: p?.unitCode ?? x.unitCode, vatRate: p?.vatRate ?? x.vatRate } : x)));
            }}
            placeholder={t('docs.contracts.chooseProduct')}
            options={(products.data ?? []).map(p => ({ value: p.id, label: p.name }))}
          />
          <Input aria-label={t('docs.contracts.col.qty')} inputMode="decimal" value={l.qty} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
          <Input aria-label={t('docs.contracts.col.price')} inputMode="decimal" value={l.price} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
          <label className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={l.isSubscription}
              onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, isSubscription: e.target.checked } : x)))}
            />
            {t('docs.contracts.subscription')}
          </label>
          <IconButton label={t('docs.contracts.removePosition')} onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <div className="row" style={{ gap: 8 }}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setLines(prev => [
              ...prev,
              { id: `new-${prev.length}`, productId: '', productName: '', sku: '', unitCode: '796', vatRate: '20', qty: '1', price: '0', isSubscription: false, invoiceAsProductId: null, invoiceAsProductName: null },
            ])
          }
        >
          <Plus size={13} />
          {t('docs.contracts.addPosition')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()}>
          {t('docs.contracts.savePositions')}
        </Button>
        <span className="faint num" style={{ fontSize: 12 }}>
          {t('docs.contracts.positionsCount', { n: lines.length })}
        </span>
      </div>
    </div>
  );
}
