/* Contracts and tariff plans (stage 8 «UNF: Services»).
   Contracts are a common directory: with a customer, with a supplier, other. A service contract adds billing:
   a tariff plan, a periodicity (month / quarter / year), a billing day and a document package (invoice or invoice + act). */
import * as React from 'react';
import { CircleAlert, FileSignature, Plus, Trash2 } from 'lucide-react';
import { BILLING_PACKAGE_LABELS, BILLING_PACKAGES, BILLING_PERIODICITIES, BILLING_PERIODICITY_LABELS, CONTRACT_KIND_LABELS, CONTRACT_KINDS, EXTRA_PRODUCT_POLICIES, EXTRA_PRODUCT_POLICY_LABELS, type ContractKind, type ExtraProductPolicy } from '@gr8r/shared';
import { Alert, Badge, Button, Dialog, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { DataTable, columnsMenu, useDataTable, type Column } from '@/components/gr8r/data-table';
import { FilterBar, useFilterState } from '@/components/gr8r/filter-bar';
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
  const contracts = useContracts({ q: filters.q || undefined });
  const [creating, setCreating] = React.useState(false);

  const columns: Column<Contract>[] = [
    { id: 'number', header: 'Number', width: 140, value: c => c.number, cell: c => <span className="mono">{c.number || '—'}</span> },
    { id: 'company', header: 'Customer', width: 240, value: c => c.companyName, cell: c => <span className="trunc">{c.companyName}</span> },
    { id: 'kind', header: 'Kind', width: 110, value: c => CONTRACT_KIND_LABELS[c.kind], cell: c => <span className="muted">{CONTRACT_KIND_LABELS[c.kind]}</span> },
    { id: 'period', header: 'Valid', width: 200, value: c => `${c.validFrom}…${c.validTo ?? ''}`, cell: c => <span className="num muted">{c.validTo ? `${fmtDate(parse(c.validFrom))} — ${fmtDate(parse(c.validTo))}` : `${fmtDate(parse(c.validFrom))} — indefinite`}</span> },
    { id: 'service', header: 'Billing', width: 150, value: c => (c.isService ? c.periodicity ?? '' : ''), cell: c => (c.isService ? <Badge tone="accent">{c.periodicity ? BILLING_PERIODICITY_LABELS[c.periodicity] : 'Service'}</Badge> : <span className="faint">—</span>) },
    { id: 'signed', header: 'Signed', width: 100, value: c => (c.isSigned ? 'Yes' : 'No'), cell: c => (c.isSigned ? <Badge tone="green">Signed</Badge> : <span className="faint">No</span>) },
    { id: 'default', header: 'Default', width: 100, value: c => (c.isDefault ? 'Yes' : 'No'), cell: c => (c.isDefault ? <Badge tone="accent">Default</Badge> : <span className="faint">—</span>) },
  ];
  const table = useDataTable(columns, { sort: { id: 'number', dir: 1 } });

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Contracts</h1>
          <p>Contracts with customers and suppliers. A service contract bills regularly by its tariff plan.</p>
        </div>
        <div className="acts">
          {canWrite && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} />
              New contract
            </Button>
          )}
        </div>
      </div>
      <FilterBar
        search={{ value: filters.q, onChange: filters.setQ, placeholder: 'Search by number or category' }}
        filters={filters}
        sort={{ options: columns.filter(c => c.value).map(c => ({ id: c.id, name: c.header })), value: table.sort.id, dir: table.sort.dir, onChange: table.setSort }}
        columns={columnsMenu(columns, table)}
      />
      <div className="pane">
        {contracts.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : !contracts.data?.items.length ? (
          <EmptyState icon={<FileSignature size={20} />} title="No contracts yet" action={canWrite ? <Button onClick={() => setCreating(true)}>New contract</Button> : undefined}>
            A contract links documents with a customer and keeps the terms: payment days and price type.
          </EmptyState>
        ) : (
          <DataTable columns={columns} table={table} rows={contracts.data.items} getId={c => c.id} aria-label="Contracts" />
        )}
      </div>
      {creating && <ContractDialog api={api} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Диалог договора: реквизиты, срок действия и условия биллинга */
function ContractDialog({ api, onClose, contract }: { api: ReturnType<typeof useBillingApi>; onClose: () => void; contract?: Contract }) {
  const plans = useTariffPlans();
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
  const [priceType, setPriceType] = React.useState(contract?.priceType ?? '');
  const [isService, setIsService] = React.useState(contract?.isService ?? false);
  const [tariffPlanId, setTariffPlanId] = React.useState(contract?.tariffPlanId ?? '');
  const [periodicity, setPeriodicity] = React.useState(contract?.periodicity ?? 'month');
  const [billingDay, setBillingDay] = React.useState(String(contract?.billingDay ?? 1));
  const [documentPackage, setDocumentPackage] = React.useState<'invoice' | 'invoice_act'>(contract?.documentPackage ?? 'invoice');

  const save = async () => {
    if (!company) return toast.error('Select a customer');
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
      priceType: priceType.trim(),
      isService,
      tariffPlanId: isService ? tariffPlanId || null : null,
      periodicity: isService ? periodicity : null,
      billingDay: Number(billingDay) || 1,
      documentPackage,
    };
    const r = contract ? await api('PATCH', `/contracts/${contract.id}`, body) : await api('POST', '/contracts', body);
    if (r) {
      const warnings = (r as Contract).warnings ?? [];
      toast(warnings.length ? warnings[0]! : contract ? 'Contract saved' : 'Contract created');
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent title={contract ? 'Edit contract' : 'New contract'}>
        <div className="stack" style={{ gap: 12 }}>
          <Field label="Customer">{({ id }) => <CounterpartyPicker id={id} value={company?.name ?? ''} onPick={c => setCompany({ id: c.id, name: c.name })} />}</Field>
          <div className="row" style={{ gap: 8 }}>
            <Field label="Number">{({ id }) => <Input id={id} value={number} onChange={e => setNumber(e.target.value)} placeholder="Contract number" />}</Field>
            <Field label="Date">{({ id }) => <Input id={id} type="date" value={date} onChange={e => setDate(e.target.value)} />}</Field>
            <Field label="Kind">{({ id }) => <Select id={id} value={kind} onValueChange={v => setKind(v as ContractKind)} options={CONTRACT_KINDS.map(k => ({ value: k, label: CONTRACT_KIND_LABELS[k] }))} />}</Field>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Field label="Valid from">{({ id }) => <Input id={id} type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />}</Field>
            <Field label="Valid to" hint="Empty — indefinite">{({ id }) => <Input id={id} type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />}</Field>
            <Field label="Category">{({ id }) => <Input id={id} value={category} onChange={e => setCategory(e.target.value)} placeholder="Category" />}</Field>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Field label="Payment days">{({ id }) => <Input id={id} value={paymentDays} onChange={e => setPaymentDays(e.target.value)} />}</Field>
            <Field label="Price type">{({ id }) => <Input id={id} value={priceType} onChange={e => setPriceType(e.target.value)} placeholder="Price type" />}</Field>
          </div>
          <div className="row" style={{ gap: 16 }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={isSigned} onChange={e => setIsSigned(e.target.checked)} /> Signed
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Default for the customer
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={isService} onChange={e => setIsService(e.target.checked)} /> Service contract
            </label>
          </div>
          {isService && (
            <>
              <Alert tone="info">A service contract bills by its tariff plan: the subscription positions are issued every period, the works by fact.</Alert>
              <div className="row" style={{ gap: 8 }}>
                <Field label="Tariff plan">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={tariffPlanId}
                      onValueChange={v => setTariffPlanId(v)}
                      placeholder="Select a tariff plan"
                      options={(plans.data ?? []).map(p => ({ value: p.id, label: p.name }))}
                    />
                  )}
                </Field>
                <Field label="Periodicity">{({ id }) => <Select id={id} value={periodicity} onValueChange={v => setPeriodicity(v as (typeof BILLING_PERIODICITIES)[number])} options={BILLING_PERIODICITIES.map(p => ({ value: p, label: BILLING_PERIODICITY_LABELS[p] }))} />}</Field>
                <Field label="Billing day">{({ id }) => <Input id={id} value={billingDay} onChange={e => setBillingDay(e.target.value)} />}</Field>
                <Field label="Documents">{({ id }) => <Select id={id} value={documentPackage} onValueChange={v => setDocumentPackage(v as 'invoice' | 'invoice_act')} options={BILLING_PACKAGES.map(p => ({ value: p, label: BILLING_PACKAGE_LABELS[p] }))} />}</Field>
              </div>
            </>
          )}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              Save
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
  const [name, setName] = React.useState('');
  const [policy, setPolicy] = React.useState<ExtraProductPolicy>('allow');
  const [openId, setOpenId] = React.useState<string | null>(null);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>Tariff plans</h1>
          <p>Sets of products billed under a service contract. A subscription position is issued every period at the plan price.</p>
        </div>
      </div>
      <div className="pane">
        {plans.isPending ? (
          <Skeleton w="100%" h={120} />
        ) : !plans.data?.length ? (
          <EmptyState icon={<CircleAlert size={20} />} title="No tariff plans yet">
            Create a tariff plan and add the products a service contract bills.
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {plans.data.map(p => (
              <div key={p.id} className="sblock">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <b>{p.name}</b>{' '}
                    <Badge tone={p.extraProductPolicy === 'forbid' ? 'red' : p.extraProductPolicy === 'warn' ? 'amber' : 'gray'}>
                      Extra products: {EXTRA_PRODUCT_POLICY_LABELS[p.extraProductPolicy]}
                    </Badge>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {p.lines.length} positions
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                    {openId === p.id ? 'Hide positions' : 'Positions'}
                  </Button>
                </div>
                {openId === p.id && <TariffPlanLines plan={p} api={api} />}
              </div>
            ))}
          </div>
        )}
        <div className="doc-add">
          <Input aria-label="Tariff plan name" value={name} placeholder="Support plan" onChange={e => setName(e.target.value)} />
          <Select value={policy} onValueChange={v => setPolicy(v as ExtraProductPolicy)} options={EXTRA_PRODUCT_POLICIES.map(p => ({ value: p, label: EXTRA_PRODUCT_POLICY_LABELS[p] }))} />
          <Button
            size="sm"
            variant="ghost"
            disabled={!name.trim()}
            onClick={async () => {
              const r = await api('POST', '/tariff-plans', { name: name.trim(), extraProductPolicy: policy });
              if (r) {
                setName('');
                toast('Tariff plan created');
              }
            }}
          >
            <Plus size={13} />
            Add tariff plan
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Позиции тарифного плана: товар, количество, цена, абонплата и представление в счёте */
function TariffPlanLines({ plan, api }: { plan: TariffPlan; api: ReturnType<typeof useBillingApi> }) {
  const products = useProducts();
  const [lines, setLines] = React.useState(plan.lines);
  React.useEffect(() => setLines(plan.lines), [plan.id, plan.lines.length]);

  const save = async () => {
    const r = await api('POST', `/tariff-plans/${plan.id}/lines`, {
      lines: lines.map(l => ({ productId: l.productId, qty: l.qty, price: l.price, isSubscription: l.isSubscription, invoiceAsProductId: l.invoiceAsProductId ?? null })),
    });
    if (r) toast('Positions saved');
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
            placeholder="Select a product"
            options={(products.data ?? []).map(p => ({ value: p.id, label: p.name }))}
          />
          <Input aria-label="Qty" value={l.qty} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
          <Input aria-label="Price" value={l.price} onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
          <label className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={l.isSubscription}
              onChange={e => setLines(prev => prev.map((x, j) => (j === i ? { ...x, isSubscription: e.target.checked } : x)))}
            />
            Subscription
          </label>
          <IconButton label="Remove position" onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}>
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
          Add position
        </Button>
        <Button size="sm" variant="primary" onClick={() => void save()}>
          Save positions
        </Button>
        <span className="faint num" style={{ fontSize: 12 }}>
          {lines.length} positions
        </span>
      </div>
    </div>
  );
}
