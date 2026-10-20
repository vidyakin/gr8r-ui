/* Формы CRM «New deal», «New company», «New contact» — Dialog в стиле формы новой задачи (overlays/task-form.tsx) */
import * as React from 'react';
import { CircleAlert, DollarSign } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogClose, DialogContent, Input } from '@/components/ui';
import { useWorkspace } from '../data/store';
import { dOff } from '../lib/dates';
import { MOD } from '../lib/platform';
import { INDUSTRIES, OPEN_STAGES, SIZES } from './stages';
import { company as findCompany, contactsOfCompany } from './selectors';
import { newCrmId, useCrm } from './store';
import type { DealDefaults } from './ui-context';
import type { StageId } from './types';

/** Поле формы: подпись, содержимое и ошибка */
function FormField({ id, label, error, grow, children }: { id: string; label: string; error?: string; grow?: boolean; children: React.ReactNode }) {
  return (
    <div className="field" style={grow ? { flex: 1, minWidth: 150 } : undefined}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error && (
        <span className="err">
          <CircleAlert size={12} />
          {error}
        </span>
      )}
    </div>
  );
}

function OwnerSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { data } = useWorkspace();
  return (
    <select className="select" id={id} value={value} onChange={e => onChange(e.target.value)}>
      {data.members
        .filter(m => m.status === 'active')
        .map(m => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.id === data.me ? ' (you)' : ''}
          </option>
        ))}
    </select>
  );
}

/** Каркас окна: заголовок, форма (Enter и Ctrl/Cmd+Enter отправляют) и подвал с кнопками */
function FormDialog({ title, description, submitLabel, onSubmit, onClose, children }: { title: string; description: string; submitLabel: string; onSubmit: () => void; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={title}
        description={description}
        className="[&>.modal-b]:!gap-3"
        onOpenAutoFocus={e => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-af]')?.focus();
        }}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        footer={
          <>
            <span className="sp" />
            <span className="faint hide-m" style={{ fontSize: 11.5 }}>
              <kbd>{MOD}</kbd> <kbd>↵</kbd>
            </span>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button variant="primary" onClick={onSubmit}>
              {submitLabel}
            </Button>
          </>
        }
      >
        <form
          className="contents"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {children}
          {/* Enter в полях ввода отправляет форму, как в остальных окнах приложения */}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- сделка ---------- */

export function DealFormDialog({ defaults, onClose, onCreated }: { defaults: DealDefaults; onClose: () => void; onCreated: (id: string) => void }) {
  const { data: ws } = useWorkspace();
  const { data, dispatch } = useCrm();
  const [f, setF] = React.useState({
    name: '',
    company: defaults.company ?? '',
    amount: '',
    stage: (defaults.stage && defaults.stage !== 'won' && defaults.stage !== 'lost' ? defaults.stage : 'lead') as StageId,
    close: dOff(30),
    owner: defaults.owner ?? ws.me,
    contacts: [] as string[],
  });
  const [err, setErr] = React.useState<{ name?: string; company?: string; amount?: string }>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const people = f.company ? contactsOfCompany(data, f.company) : [];

  const submit = () => {
    const e: typeof err = {};
    if (!f.name.trim()) e.name = 'Give the deal a name';
    if (!f.company) e.company = 'Choose a company';
    const amount = Number(f.amount);
    if (!(amount > 0)) e.amount = 'Enter an amount above zero';
    setErr(e);
    if (Object.keys(e).length) return;
    const id = newCrmId('d');
    dispatch({ type: 'deal/create', deal: { id, name: f.name.trim(), company: f.company, amount, stage: f.stage, closeDate: f.close, owner: f.owner, contacts: f.contacts } });
    onClose();
    onCreated(id);
  };

  return (
    <FormDialog title="New deal" description="Deals move through the pipeline from Lead to Won." submitLabel="Create deal" onSubmit={submit} onClose={onClose}>
      <FormField id="nd-name" label="Deal name" error={err.name}>
        <Input id="nd-name" data-af size="lg" invalid={!!err.name} placeholder="e.g. Fleet analytics rollout" value={f.name} style={{ fontSize: 15, fontWeight: 500 }} onChange={e => set('name', e.target.value)} />
      </FormField>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FormField id="nd-company" label="Company" error={err.company} grow>
          <select
            className={`select${err.company ? ' is-error' : ''}`}
            id="nd-company"
            value={f.company}
            onChange={e => setF(s => ({ ...s, company: e.target.value, contacts: [], owner: findCompany(data, e.target.value)?.owner ?? s.owner }))}
          >
            <option value="">Select a company…</option>
            {[...data.companies]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </FormField>
        <FormField id="nd-amount" label="Amount (USD)" error={err.amount} grow>
          <Input id="nd-amount" type="number" min={0} step={500} icon={<DollarSign size={14} />} invalid={!!err.amount} placeholder="0" value={f.amount} onChange={e => set('amount', e.target.value)} />
        </FormField>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FormField id="nd-stage" label="Stage" grow>
          <select className="select" id="nd-stage" value={f.stage} onChange={e => set('stage', e.target.value as StageId)}>
            {OPEN_STAGES.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="nd-close" label="Expected close" grow>
          <input type="date" className="input" id="nd-close" value={f.close} onChange={e => e.target.value && set('close', e.target.value)} />
        </FormField>
        <FormField id="nd-owner" label="Owner" grow>
          <OwnerSelect id="nd-owner" value={f.owner} onChange={v => set('owner', v)} />
        </FormField>
      </div>
      {!!people.length && (
        <div className="field">
          <span className="label">Contacts</span>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
            {people.map(p => (
              <label key={p.id} className="row" style={{ gap: 7, cursor: 'pointer', fontSize: 13 }}>
                <Checkbox checked={f.contacts.includes(p.id)} onChange={() => set('contacts', f.contacts.includes(p.id) ? f.contacts.filter(x => x !== p.id) : [...f.contacts, p.id])} />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </FormDialog>
  );
}

/* ---------- компания ---------- */

export function CompanyFormDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: ws } = useWorkspace();
  const { dispatch } = useCrm();
  const [f, setF] = React.useState({ name: '', industry: INDUSTRIES[0], size: SIZES[2], owner: ws.me, website: '', city: '' });
  const [err, setErr] = React.useState<string>();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));

  const submit = () => {
    const name = f.name.trim();
    if (!name) return setErr('Give the company a name');
    const id = newCrmId('co');
    dispatch({ type: 'company/create', company: { id, name, industry: f.industry, size: f.size, owner: f.owner, website: f.website.trim() || undefined, city: f.city.trim() } });
    onClose();
    onCreated(id);
  };

  return (
    <FormDialog title="New company" description="Companies group the contacts and deals you work on together." submitLabel="Create company" onSubmit={submit} onClose={onClose}>
      <FormField id="nc-name" label="Company name" error={err}>
        <Input
          id="nc-name"
          data-af
          size="lg"
          invalid={!!err}
          placeholder="e.g. Northwind Logistics"
          value={f.name}
          style={{ fontSize: 15, fontWeight: 500 }}
          onChange={e => {
            set('name', e.target.value);
            if (err && e.target.value.trim()) setErr(undefined);
          }}
        />
      </FormField>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FormField id="nc-industry" label="Industry" grow>
          <select className="select" id="nc-industry" value={f.industry} onChange={e => set('industry', e.target.value)}>
            {INDUSTRIES.map(i => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </FormField>
        <FormField id="nc-size" label="Size" grow>
          <select className="select" id="nc-size" value={f.size} onChange={e => set('size', e.target.value)}>
            {SIZES.map(i => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </FormField>
        <FormField id="nc-owner" label="Owner" grow>
          <OwnerSelect id="nc-owner" value={f.owner} onChange={v => set('owner', v)} />
        </FormField>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FormField id="nc-web" label="Website" grow>
          <Input id="nc-web" placeholder="company.com" value={f.website} onChange={e => set('website', e.target.value)} />
        </FormField>
        <FormField id="nc-city" label="City" grow>
          <Input id="nc-city" placeholder="e.g. Berlin" value={f.city} onChange={e => set('city', e.target.value)} />
        </FormField>
      </div>
    </FormDialog>
  );
}

/* ---------- контакт ---------- */

export function ContactFormDialog({ defaults, onClose, onCreated }: { defaults: { company?: string }; onClose: () => void; onCreated: (id: string) => void }) {
  const { data: ws } = useWorkspace();
  const { data, dispatch } = useCrm();
  const [f, setF] = React.useState({ name: '', company: defaults.company ?? '', title: '', email: '', phone: '', owner: findCompany(data, defaults.company)?.owner ?? ws.me });
  const [err, setErr] = React.useState<{ name?: string; company?: string }>({});
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));

  const submit = () => {
    const e: typeof err = {};
    if (!f.name.trim()) e.name = 'Enter the contact’s name';
    if (!f.company) e.company = 'Choose a company';
    setErr(e);
    if (Object.keys(e).length) return;
    const id = newCrmId('ct');
    dispatch({ type: 'contact/create', contact: { id, name: f.name.trim(), company: f.company, owner: f.owner, title: f.title.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() } });
    onClose();
    onCreated(id);
  };

  return (
    <FormDialog title="New contact" description="People you talk to at a company." submitLabel="Create contact" onSubmit={submit} onClose={onClose}>
      <FormField id="nk-name" label="Full name" error={err.name}>
        <Input id="nk-name" data-af size="lg" invalid={!!err.name} placeholder="e.g. Henrik Visser" value={f.name} style={{ fontSize: 15, fontWeight: 500 }} onChange={e => set('name', e.target.value)} />
      </FormField>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FormField id="nk-company" label="Company" error={err.company} grow>
          <select
            className={`select${err.company ? ' is-error' : ''}`}
            id="nk-company"
            value={f.company}
            onChange={e => setF(s => ({ ...s, company: e.target.value, owner: findCompany(data, e.target.value)?.owner ?? s.owner }))}
          >
            <option value="">Select a company…</option>
            {[...data.companies]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </FormField>
        <FormField id="nk-title" label="Job title" grow>
          <Input id="nk-title" placeholder="e.g. VP Operations" value={f.title} onChange={e => set('title', e.target.value)} />
        </FormField>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <FormField id="nk-email" label="Email" grow>
          <Input id="nk-email" type="email" placeholder="name@company.com" value={f.email} onChange={e => set('email', e.target.value)} />
        </FormField>
        <FormField id="nk-phone" label="Phone" grow>
          <Input id="nk-phone" placeholder="+1 555 0100" value={f.phone} onChange={e => set('phone', e.target.value)} />
        </FormField>
        <FormField id="nk-owner" label="Owner" grow>
          <OwnerSelect id="nk-owner" value={f.owner} onChange={v => set('owner', v)} />
        </FormField>
      </div>
    </FormDialog>
  );
}
