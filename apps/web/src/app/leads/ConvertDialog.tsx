/* Мастер конвертации лида (задача 1175): контрагент и контакт — найденные дубли подставляются сами, либо создать нового, либо пропустить;
   галочка «Создать сделку» с названием и суммой. Повторно конвертировать лид нельзя (сервер отвечает 409). */
import * as React from 'react';
import { Alert, Button, Checkbox, Dialog, DialogContent, Field, Input, Select, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { useLead, useLeadDuplicates, useLeadsApi, type ConvertBody, type ConvertTarget, type DuplicateMatch } from './data';

type Mode = 'none' | 'new' | 'existing';

function Target({ label, mode, onMode, name, onName, nameLabel, found }: { label: string; mode: Mode; onMode: (m: Mode) => void; name: string; onName: (s: string) => void; nameLabel: string; found: DuplicateMatch | undefined }) {
  const t = useT();
  const options = [
    ...(found ? [{ value: 'existing', label: t('leads.convert.modeExisting', { name: found.name }) }] : []),
    { value: 'new', label: t('leads.convert.modeNew') },
    { value: 'none', label: t('leads.convert.modeNone') },
  ];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label={label} hint={found && mode === 'existing' ? t('leads.convert.foundHint') : undefined}>{p => <Select {...p} value={mode} onValueChange={v => onMode(v as Mode)} options={options} />}</Field>
      {mode === 'new' && <Field label={nameLabel}>{p => <Input {...p} maxLength={200} value={name} onChange={e => onName(e.target.value)} />}</Field>}
    </div>
  );
}

export function ConvertDialog({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const t = useT();
  const api = useLeadsApi();
  const lead = useLead(leadId).data;
  const dups = useLeadDuplicates(leadId).data;
  const foundCompany = dups?.find(d => d.kind === 'company');
  const foundContact = dups?.find(d => d.kind === 'contact');
  const [company, setCompany] = React.useState<Mode | null>(null);
  const [contact, setContact] = React.useState<Mode | null>(null);
  const [companyName, setCompanyName] = React.useState('');
  const [contactName, setContactName] = React.useState('');
  const [deal, setDeal] = React.useState(false);
  const [dealName, setDealName] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // значения по умолчанию: найденный дубль, иначе создать нового (контрагента — только если у лида указана компания)
  const companyMode: Mode = company ?? (foundCompany ? 'existing' : lead?.companyName ? 'new' : 'none');
  const contactMode: Mode = contact ?? (foundContact ? 'existing' : 'new');
  const cName = companyName || lead?.companyName || '';
  const pName = contactName || lead?.name || '';
  const dName = dealName || lead?.name || '';

  const submit = async () => {
    const target = (mode: Mode, found: DuplicateMatch | undefined, name: string): ConvertTarget => (mode === 'existing' && found ? { mode: 'existing', id: found.id } : mode === 'new' ? { mode: 'new', name } : { mode: 'none' });
    const body: ConvertBody = {
      company: target(companyMode, foundCompany, cName),
      contact: target(contactMode, foundContact, pName),
      deal: deal ? { name: dName, ...(amount.trim() ? { amount: amount.trim().replace(',', '.') } : {}) } : null,
    };
    setBusy(true);
    const r = await api('POST', `/leads/${leadId}/convert`, body);
    setBusy(false);
    if (r) {
      toast.success(t('leads.convert.done'));
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent
        title={t('leads.convert.title')}
        description={lead?.name}
        footer={
          <Button variant="primary" disabled={busy || !lead || !!lead.convertedAt} onClick={() => void submit()}>
            {t('leads.convert.submit')}
          </Button>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          {lead?.convertedAt ? <Alert tone="info">{t('leads.convert.already')}</Alert> : <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('leads.convert.lead')}</p>}
          <Target label={t('leads.convert.company')} mode={companyMode} onMode={setCompany} name={cName} onName={setCompanyName} nameLabel={t('leads.convert.newCompanyName')} found={foundCompany} />
          <Target label={t('leads.convert.contact')} mode={contactMode} onMode={setContact} name={pName} onName={setContactName} nameLabel={t('leads.convert.newContactName')} found={foundContact} />
          <label className="row" style={{ gap: 8 }}>
            <Checkbox checked={deal} onChange={e => setDeal(e.target.checked)} aria-label={t('leads.convert.createDeal')} />
            {t('leads.convert.createDeal')}
          </label>
          {deal && (
            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <Field label={t('leads.convert.dealName')} className="grow">{p => <Input {...p} maxLength={200} value={dName} onChange={e => setDealName(e.target.value)} />}</Field>
              <Field label={t('leads.convert.dealAmount')}>{p => <Input {...p} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} style={{ width: 140 }} />}</Field>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
