/* Реквизиты контрагента: вкладка в карточке компании. */
import { useState } from 'react';
import { useHiddenFields } from '../positions/data';
import { Button, Dialog, DialogClose, DialogContent, Skeleton, toast } from '@/components/ui';
import { COMPANY_KIND_LABELS, getCountryPack, type CountryCode, type CountryRequisites } from '@erp/shared';
import { tEnum, useT } from '@/i18n';
import { BankAccountsEditor, CountryField, CountryRequisiteFields, RequisitesFields, checkCountryRequisiteFields, checkRequisites, useCountryRequisiteLabel, type RequisitesValue } from './requisites';
import { useCanWrite } from '../meta/custom-fields';
import { useCompanyRequisites, useDocsApi, type CompanyRequisites } from './data';

export function CompanyRequisitesTab({ companyId }: { companyId: string }) {
  const hidden = useHiddenFields();
  const showRequisites = !hidden.includes('company.requisites');
  const showBanks = !hidden.includes('company.bankAccounts');
  const canEdit = useCanWrite();
  const reqs = useCompanyRequisites(showRequisites ? companyId : undefined);
  const [editing, setEditing] = useState(false);
  const t = useT();
  const label = useCountryRequisiteLabel();
  if (showRequisites && reqs.isPending) return <Skeleton w="100%" h={160} />;
  const r = reqs.data;
  const pack = getCountryPack(r?.country);
  return (
    <div className="page" style={{ maxWidth: 980, paddingTop: 12 }}>
      {showRequisites && r && <>
        {canEdit && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{t('docs.requisites.edit')}</Button>}
        <dl className="kv">
          <dt>{t('docs.requisites.country')}</dt>
          <dd>{t(`docs.requisites.countries.${pack.code}`)}</dd>
          <dt>{t('docs.requisites.kind')}</dt>
          <dd>{tEnum('companyKind', r.kind, COMPANY_KIND_LABELS[r.kind])}</dd>
          <dt>{t('docs.requisites.fullName')}</dt>
          <dd>{r.name}</dd>
          {pack.code === 'RU' ? <>
            {r.inn && <><dt>{t('docs.requisites.inn')}</dt><dd className="mono">{r.inn}</dd></>}
            {r.kpp && <><dt>{t('docs.requisites.kpp')}</dt><dd className="mono">{r.kpp}</dd></>}
            {r.ogrn && <><dt>{t(r.kind === 'sole_proprietor' ? 'docs.requisites.ogrnip' : 'docs.requisites.ogrn')}</dt><dd className="mono">{r.ogrn}</dd></>}
          </> : pack.requisiteFields.map(field => {
            const value = r.requisites?.[field.key];
            return value && <div key={field.key} className="contents"><dt>{label(field)}</dt><dd className="mono">{value}</dd></div>;
          })}
          {r.legalAddress && <><dt>{t('docs.requisites.legalAddress')}</dt><dd>{r.legalAddress}</dd></>}
          {r.actualAddress && <><dt>{t('docs.requisites.actualAddress')}</dt><dd>{r.actualAddress}</dd></>}
        </dl>
        {canEdit && editing && <CompanyRequisitesDialog record={r} onClose={() => setEditing(false)} />}
      </>}
      {showBanks && pack.code === 'RU' && <BankAccountsEditor owner="companies" ownerId={companyId} canEdit={canEdit} />}
    </div>
  );
}

function CompanyRequisitesDialog({ record, onClose }: { record: CompanyRequisites; onClose: () => void }) {
  const t = useT();
  const api = useDocsApi();
  const [country, setCountry] = useState<CountryCode>(record.country ?? 'RU');
  const [value, setValue] = useState<RequisitesValue>(() => ({
    kind: record.kind,
    inn: record.inn,
    kpp: record.kpp,
    ogrn: record.ogrn,
    legalAddress: record.legalAddress,
    actualAddress: record.actualAddress,
  }));
  const [requisitesByCountry, setRequisitesByCountry] = useState<Partial<Record<CountryCode, CountryRequisites>>>(() => ({ [country]: record.requisites }));
  const requisites = requisitesByCountry[country] ?? {};
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const issues = country === 'RU' ? checkRequisites(value) : checkCountryRequisiteFields(country, requisites, t('docs.requisites.countryFieldInvalid'));
    setErrors(issues);
    if (Object.keys(issues).length) return;
    setBusy(true);
    const saved = await api('PATCH', `/companies/${record.id}`, { ...value, country, requisites });
    setBusy(false);
    if (saved) {
      toast(t('docs.requisites.saved'));
      onClose();
    }
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent size="lg" title={t('docs.requisites.edit')} footer={
        <>
          <DialogClose asChild><Button variant="secondary">{t('common.cancel')}</Button></DialogClose>
          <Button variant="primary" disabled={busy} onClick={submit}>{t('common.save')}</Button>
        </>
      }>
        <form className="stack" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
          <CountryField value={country} onChange={next => { setCountry(next); setErrors({}); }} />
          <RequisitesFields value={value} country={country} errors={errors} onChange={patch => {
            setValue(current => ({ ...current, ...patch }));
            setErrors({});
          }} />
          {country !== 'RU' && <CountryRequisiteFields country={country} value={requisites} errors={errors} onChange={next => {
            setRequisitesByCountry(current => ({ ...current, [country]: next }));
            setErrors({});
          }} />}
          <button type="submit" hidden />
        </form>
      </DialogContent>
    </Dialog>
  );
}
