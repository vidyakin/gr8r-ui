/* Вкладка «Requisites» карточки компании CRM: тип, ИНН / КПП / ОГРН с проверкой контрольной суммы, адреса и банковские счета.
   Эти данные попадают в счета, УПД и акты, когда компания выбрана контрагентом документа. */
import * as React from 'react';
import { Button, Skeleton, toast } from '@/components/ui';
import { Panel } from '@/components/gr8r/panel';
import { useCanWrite } from '../meta/custom-fields';
import { useCompanyRequisites, useDocsApi } from './data';
import { BankAccountsEditor, RequisitesFields, checkRequisites, type RequisitesValue } from './requisites';

export function CompanyRequisitesTab({ companyId }: { companyId: string }) {
  const q = useCompanyRequisites(companyId);
  const api = useDocsApi();
  const canWrite = useCanWrite();
  const [v, setV] = React.useState<RequisitesValue | null>(null);
  const [err, setErr] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (q.data && !v) setV({ kind: q.data.kind, inn: q.data.inn, kpp: q.data.kpp, ogrn: q.data.ogrn, legalAddress: q.data.legalAddress, actualAddress: q.data.actualAddress });
  }, [q.data, v]);

  if (!v || !q.data)
    return (
      <div className="page" style={{ maxWidth: 820, paddingTop: 22 }}>
        <Skeleton w="100%" h={160} />
      </div>
    );

  const saved = q.data;
  const changed = (Object.keys(v) as (keyof RequisitesValue)[]).some(k => v[k] !== saved[k]);
  const save = async () => {
    const errs = checkRequisites(v);
    setErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const r = await api('PATCH', `/companies/${companyId}`, v);
    setBusy(false);
    if (r) toast('Requisites saved');
  };

  return (
    <div className="page" style={{ maxWidth: 820, paddingTop: 22 }}>
      <div className="stack" style={{ gap: 16 }}>
        <Panel title="Requisites" actions={canWrite && <Button size="sm" variant="primary" disabled={busy || !changed} onClick={save}>Save</Button>}>
          <div className="panel-b stack" style={{ gap: 12 }}>
            <RequisitesFields value={v} errors={err} disabled={!canWrite} onChange={patch => (setV(x => ({ ...x!, ...patch })), setErr({}))} />
          </div>
        </Panel>
        <Panel title="Bank accounts">
          <div className="panel-b">
            <BankAccountsEditor owner="companies" ownerId={companyId} canEdit={canWrite} />
          </div>
        </Panel>
      </div>
    </div>
  );
}
