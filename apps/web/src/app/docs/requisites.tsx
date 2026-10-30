/* Реквизиты: поля типа / ИНН / КПП / ОГРН / адресов с проверкой контрольных сумм на месте (та же validateRequisites, что на сервере)
   и редактор банковских счетов (БИК, р/с, к/с, банк) компании или организации. */
import * as React from 'react';
import { CircleAlert, Plus, Star, Trash2 } from 'lucide-react';
import { COMPANY_KINDS, COMPANY_KIND_LABELS, isValidAccount, isValidBik, validateRequisites, type CompanyKind } from '@gr8r/shared';
import { Badge, Button, Field, IconButton, Input, toast } from '@/components/ui';
import { tEnum, useT } from '@/i18n';
import { useDocsApi, useBankAccounts, type BankAccount } from './data';

export interface RequisitesValue {
  kind: CompanyKind;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
}

/** Ошибки реквизитов по полям (пустой объект — всё верно) */
export const checkRequisites = (v: RequisitesValue) => validateRequisites(v);

export function RequisitesFields({ value, onChange, errors, disabled }: { value: RequisitesValue; onChange: (patch: Partial<RequisitesValue>) => void; errors: Record<string, string>; disabled?: boolean }) {
  const t = useT();
  const innLen = value.kind === 'legal' ? 10 : 12;
  return (
    <>
      <div className="row req-row">
        <Field label={t('docs.requisites.kind')} className="grow">
          {p => (
            <select className="select" id={p.id} disabled={disabled} value={value.kind} onChange={e => onChange({ kind: e.target.value as CompanyKind })}>
              {COMPANY_KINDS.map(k => (
                <option key={k} value={k}>
                  {tEnum('companyKind', k, COMPANY_KIND_LABELS[k])}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('docs.requisites.inn')} className="grow" error={errors.inn} hint={t('docs.requisites.innHint', { n: innLen })}>
          {p => <Input {...p} inputMode="numeric" disabled={disabled} maxLength={12} value={value.inn} onChange={e => onChange({ inn: e.target.value.replace(/\D/g, '') })} />}
        </Field>
        {value.kind === 'legal' && (
          <Field label={t('docs.requisites.kpp')} className="grow" error={errors.kpp}>
            {p => <Input {...p} disabled={disabled} maxLength={9} value={value.kpp} onChange={e => onChange({ kpp: e.target.value.toUpperCase() })} />}
          </Field>
        )}
        {value.kind !== 'individual' && (
          <Field label={value.kind === 'legal' ? t('docs.requisites.ogrn') : t('docs.requisites.ogrnip')} className="grow" error={errors.ogrn}>
            {p => <Input {...p} inputMode="numeric" disabled={disabled} maxLength={15} value={value.ogrn} onChange={e => onChange({ ogrn: e.target.value.replace(/\D/g, '') })} />}
          </Field>
        )}
      </div>
      <Field label={t('docs.requisites.legalAddress')}>{p => <Input {...p} disabled={disabled} value={value.legalAddress} onChange={e => onChange({ legalAddress: e.target.value })} />}</Field>
      <Field label={t('docs.requisites.actualAddress')}>{p => <Input {...p} disabled={disabled} value={value.actualAddress} placeholder={t('docs.requisites.actualAddressPlaceholder')} onChange={e => onChange({ actualAddress: e.target.value })} />}</Field>
    </>
  );
}

const mask = (acc: string) => `${acc.slice(0, 5)} ${acc.slice(5, 8)} ${acc.slice(8, 9)} ${acc.slice(9, 13)} ${acc.slice(13)}`;

/** Банковские счета владельца: список, «по умолчанию», удаление и форма добавления */
export function BankAccountsEditor({ owner, ownerId, canEdit }: { owner: 'companies' | 'organizations'; ownerId: string; canEdit: boolean }) {
  const list = useBankAccounts(owner, ownerId);
  const api = useDocsApi();
  const t = useT();
  const [adding, setAdding] = React.useState(false);
  const [f, setF] = React.useState({ bik: '', account: '', corrAccount: '', bankName: '' });
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  const add = async () => {
    const e: Record<string, string> = {};
    if (!isValidBik(f.bik)) e.bik = t('docs.requisites.bikError');
    if (!isValidAccount(f.account)) e.account = t('docs.requisites.accountError');
    if (f.corrAccount && !isValidAccount(f.corrAccount)) e.corrAccount = t('docs.requisites.corrError');
    if (!f.bankName.trim()) e.bankName = t('docs.requisites.bankNameRequired');
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const r = await api('POST', `/${owner}/${ownerId}/bank-accounts`, { ...f, bankName: f.bankName.trim() });
    setBusy(false);
    if (r) {
      toast(t('docs.requisites.bankAdded'));
      setF({ bik: '', account: '', corrAccount: '', bankName: '' });
      setAdding(false);
    }
  };

  return (
    <div className="bank-editor">
      {list.isPending ? (
        <p className="faint">{t('common.loading')}</p>
      ) : list.isError ? (
        <p className="err">
          <CircleAlert size={12} /> {(list.error as Error).message}
        </p>
      ) : !list.data.length ? (
        <p className="faint">{t('docs.requisites.noAccounts')}</p>
      ) : (
        <ul className="bank-list">
          {list.data.map((b: BankAccount) => (
            <li key={b.id}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="trunc" style={{ fontWeight: 450 }}>
                  {b.bankName} {b.isDefault && <Badge tone="accent">{t('docs.requisites.default')}</Badge>}
                </div>
                <div className="faint mono" style={{ fontSize: 11.5 }}>
                  {t('docs.requisites.bik')} {b.bik} · {mask(b.account)}
                  {b.corrAccount ? ` · ${t('docs.requisites.corrShort')} ${b.corrAccount}` : ''}
                </div>
              </div>
              {canEdit && (
                <span className="row" style={{ gap: 2 }}>
                  {!b.isDefault && (
                    <IconButton size="xs" label={t('docs.requisites.makeDefault', { name: b.bankName })} onClick={() => void api('PATCH', `/bank-accounts/${b.id}`, { isDefault: true })}>
                      <Star size={13} />
                    </IconButton>
                  )}
                  <IconButton size="xs" label={t('docs.requisites.deleteAccount', { acc: b.account })} onClick={() => void api('DELETE', `/bank-accounts/${b.id}`)}>
                    <Trash2 size={13} />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit &&
        (adding ? (
          <form
            className="bank-form"
            noValidate
            onSubmit={e => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="row req-row">
              <Field label={t('docs.requisites.bik')} error={err.bik} className="grow">
                {p => <Input {...p} autoFocus inputMode="numeric" maxLength={9} value={f.bik} onChange={e => setF({ ...f, bik: e.target.value.replace(/\D/g, '') })} />}
              </Field>
              <Field label={t('docs.requisites.bankName')} error={err.bankName} className="grow" >
                {p => <Input {...p} value={f.bankName} onChange={e => setF({ ...f, bankName: e.target.value })} placeholder={t('docs.requisites.bankNamePlaceholder')} />}
              </Field>
            </div>
            <div className="row req-row">
              <Field label={t('docs.requisites.account')} error={err.account} className="grow">
                {p => <Input {...p} inputMode="numeric" maxLength={20} value={f.account} onChange={e => setF({ ...f, account: e.target.value.replace(/\D/g, '') })} />}
              </Field>
              <Field label={t('docs.requisites.corrAccount')} error={err.corrAccount} className="grow">
                {p => <Input {...p} inputMode="numeric" maxLength={20} value={f.corrAccount} onChange={e => setF({ ...f, corrAccount: e.target.value.replace(/\D/g, '') })} />}
              </Field>
            </div>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" onClick={() => (setAdding(false), setErr({}))}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {t('docs.requisites.addAccount')}
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            <Plus size={13} />
            {t('docs.requisites.addAccountBtn')}
          </Button>
        ))}
    </div>
  );
}
