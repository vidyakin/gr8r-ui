/* Вкладка «Прайсы» карточки контрагента: форматы файлов, список прайсов, загрузка (этап 6 проекта
   docs/superpowers/specs/2026-11-11-supplier-price-upload-design.md). Экран разбора — supplier-price-page.tsx. */
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { Download, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { DateInput } from '@/components/gr8r/date-picker';
import { NumberField } from '@/components/gr8r/number-field';
import { useT } from '@/i18n';
import { fmtDateTime, fmtNumber } from '@/i18n/format';
import { cn } from '@/lib/utils';
import { errorMessage } from '../data/api';
import { fmtBytes } from '../data/attachments';
import { fmtDate } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { SECTIONS } from '../routes';
import { useSupplierPrices, useSupplierPricesApi, useSupplierProfiles, type ProfilePreview, type SupplierPrice, type SupplierProfile } from './supplier-prices-data';

const today = () => new Date().toISOString().slice(0, 10);
const MAX_GRID_COLS = 30;

export const supplierPricePath = (companyId: string, priceId: string) => `${SECTIONS.crmCompanies.path}/${companyId}/prices/${priceId}`;

/** Вкладка «Прайсы» (видна admin+: цены поставщиков скрыты от участников) */
export function CompanySupplierPricesTab({ companyId }: { companyId: string }) {
  const t = useT();
  const canWrite = useCanWrite();
  const profiles = useSupplierProfiles(companyId);
  const prices = useSupplierPrices(companyId);
  const [profileDlg, setProfileDlg] = React.useState<SupplierProfile | 'new' | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const noProfiles = !profiles.isPending && !profiles.data?.length;

  return (
    <div className="page" style={{ maxWidth: 1100, paddingTop: 12 }}>
      <div className="row" style={{ gap: 8, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>{t('supplierPrices.tab.title')}</h3>
        <span className="sp" />
        {canWrite && (
          <Button variant="primary" size="sm" disabled={noProfiles || profiles.isPending} title={noProfiles ? t('supplierPrices.tab.needFormat') : undefined} onClick={() => setUploadOpen(true)}>
            <FileUp size={13} />
            {t('supplierPrices.tab.upload')}
          </Button>
        )}
      </div>
      <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
        {t('supplierPrices.tab.hint')}
      </p>
      <PricesList companyId={companyId} canWrite={canWrite} loading={prices.isPending} items={prices.data ?? []} emptyHint={noProfiles} />

      <div className="row" style={{ gap: 8, margin: '26px 0 4px' }}>
        <h3 style={{ margin: 0 }}>{t('supplierPrices.formats.title')}</h3>
        <span className="sp" />
        {canWrite && (
          <Button size="sm" onClick={() => setProfileDlg('new')}>
            <Plus size={13} />
            {t('supplierPrices.formats.setup')}
          </Button>
        )}
      </div>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
        {t('supplierPrices.formats.hint')}
      </p>
      <ProfilesList items={profiles.data ?? []} loading={profiles.isPending} canWrite={canWrite} onEdit={setProfileDlg} />

      {profileDlg && <ProfileDialog companyId={companyId} profile={profileDlg === 'new' ? null : profileDlg} onClose={() => setProfileDlg(null)} />}
      {uploadOpen && <UploadDialog companyId={companyId} profiles={profiles.data ?? []} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

/* ---------------- список прайсов ---------------- */

function PricesList({ companyId, canWrite, loading, items, emptyHint }: { companyId: string; canWrite: boolean; loading: boolean; items: SupplierPrice[]; emptyHint: boolean }) {
  const t = useT();
  const api = useSupplierPricesApi();
  const [removing, setRemoving] = React.useState<SupplierPrice | null>(null);

  const download = async (p: SupplierPrice) => {
    if (!p.attachmentId) return;
    try {
      await api.download(p.attachmentId, p.fileName);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const remove = async (p: SupplierPrice) => {
    try {
      await api.deletePrice(p.id);
      toast(t('supplierPrices.tab.deleted'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (loading) return <Skeleton w="100%" h={80} />;
  if (!items.length)
    return (
      <EmptyState icon={<FileUp size={20} />} title={t('supplierPrices.tab.empty')} size="sm">
        {emptyHint ? t('supplierPrices.tab.emptyHint') : undefined}
      </EmptyState>
    );
  return (
    <>
      <table className="dtbl" aria-label={t('supplierPrices.tab.title')}>
        <thead>
          <tr>
            <th>{t('supplierPrices.tab.colName')}</th>
            <th style={{ width: 130 }}>{t('supplierPrices.tab.colDate')}</th>
            <th style={{ width: 120 }}>{t('supplierPrices.tab.colStatus')}</th>
            <th style={{ width: 300 }}>{t('supplierPrices.tab.colLines')}</th>
            <th style={{ width: 80 }} />
          </tr>
        </thead>
        <tbody>
          {items.map(p => (
            <tr key={p.id}>
              <td>
                <Link to={supplierPricePath(companyId, p.id)} style={{ fontWeight: 500 }}>
                  {p.name}
                </Link>
                <div className="faint" style={{ fontSize: 11.5 }}>
                  {p.fileName}
                  {' · '}
                  {fmtDateTime(p.createdAt)}
                </div>
              </td>
              <td>{fmtDate(p.date)}</td>
              <td>
                <Badge tone={p.status === 'applied' ? 'green' : 'amber'}>{t(`supplierPrices.tab.status.${p.status}` as const)}</Badge>
              </td>
              <td>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Badge tone="green">
                    {t('supplierPrices.tab.found')}: {fmtNumber(p.linesMatched)}
                  </Badge>
                  <Badge tone={p.linesUnmatched ? 'red' : 'gray'}>
                    {t('supplierPrices.tab.notFound')}: {fmtNumber(p.linesUnmatched)}
                  </Badge>
                  <Badge tone={p.linesConflict ? 'amber' : 'gray'}>
                    {t('supplierPrices.tab.conflict')}: {fmtNumber(p.linesConflict)}
                  </Badge>
                </span>
              </td>
              <td>
                <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                  {p.attachmentId && (
                    <IconButton size="xs" label={t('supplierPrices.tab.download')} onClick={() => void download(p)}>
                      <Download size={13} />
                    </IconButton>
                  )}
                  {canWrite && p.status === 'draft' && (
                    <IconButton size="xs" label={t('supplierPrices.tab.delete')} onClick={() => setRemoving(p)}>
                      <Trash2 size={13} />
                    </IconButton>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={v => !v && setRemoving(null)}
        danger
        title={t('supplierPrices.tab.deleteTitle')}
        description={removing ? t('supplierPrices.tab.deleteText', { name: removing.name }) : undefined}
        confirmLabel={t('pricing.delete')}
        cancelLabel={t('pricing.cancel')}
        onConfirm={() => removing && void remove(removing)}
      />
    </>
  );
}

/* ---------------- форматы файлов ---------------- */

function ProfilesList({ items, loading, canWrite, onEdit }: { items: SupplierProfile[]; loading: boolean; canWrite: boolean; onEdit: (p: SupplierProfile) => void }) {
  const t = useT();
  const api = useSupplierPricesApi();
  const [removing, setRemoving] = React.useState<SupplierProfile | null>(null);
  if (loading) return <Skeleton w="100%" h={50} />;
  if (!items.length) return <p className="faint">{t('supplierPrices.formats.empty')}</p>;
  const remove = async (p: SupplierProfile) => {
    try {
      await api.deleteProfile(p.id);
      toast(t('supplierPrices.formats.deleted'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <table className="dtbl" aria-label={t('supplierPrices.formats.title')}>
        <tbody>
          {items.map(p => (
            <tr key={p.id}>
              <td style={{ width: 240, fontWeight: 500 }}>{p.name}</td>
              <td className="muted" style={{ fontSize: 12.5 }}>
                {profileSummary(t, p)}
              </td>
              <td style={{ width: 80 }}>
                {canWrite && (
                  <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                    <IconButton size="xs" label={t('supplierPrices.formats.edit')} onClick={() => onEdit(p)}>
                      <Pencil size={13} />
                    </IconButton>
                    <IconButton size="xs" label={t('supplierPrices.formats.delete')} onClick={() => setRemoving(p)}>
                      <Trash2 size={13} />
                    </IconButton>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={v => !v && setRemoving(null)}
        danger
        title={t('supplierPrices.formats.deleteTitle')}
        description={removing ? t('supplierPrices.formats.deleteText', { name: removing.name }) : undefined}
        confirmLabel={t('pricing.delete')}
        cancelLabel={t('pricing.cancel')}
        onConfirm={() => removing && void remove(removing)}
      />
    </>
  );
}

function profileSummary(t: ReturnType<typeof useT>, p: SupplierProfile) {
  const col = (n: number | null) => (n ? String(n) : t('supplierPrices.formats.none'));
  return t('supplierPrices.formats.summary', { row: p.firstRow, article: col(p.articleCol), name: col(p.nameCol), net: col(p.priceNetCol), gross: col(p.priceGrossCol), unit: col(p.unitCol) });
}

/* ---------------- настройка формата по файлу-образцу ---------------- */

type Role = 'article' | 'name' | 'priceNet' | 'priceGross' | 'unit';
const ROLES: Role[] = ['article', 'name', 'priceNet', 'priceGross', 'unit'];
type Cols = Record<Role, number | null>;
const SAMPLE_ROWS = 10;
const NONE = 'none';

/** Номер колонки (1-based) → буква как в таблицах: 1 → A, 27 → AA */
const colLetter = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const clip = (v: string, n = 36) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

function ProfileDialog({ companyId, profile, onClose }: { companyId: string; profile: SupplierProfile | null; onClose: () => void }) {
  const t = useT();
  const api = useSupplierPricesApi();
  const [name, setName] = React.useState(profile?.name ?? '');
  const [firstRow, setFirstRow] = React.useState(profile?.firstRow ?? 2);
  const [cols, setCols] = React.useState<Cols>({ article: profile?.articleCol ?? null, name: profile?.nameCol ?? null, priceNet: profile?.priceNetCol ?? null, priceGross: profile?.priceGrossCol ?? null, unit: profile?.unitCol ?? null });
  const [preview, setPreview] = React.useState<ProfilePreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setPreview(await api.previewFile(file));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  /** Колонка для поля: одна колонка файла — одно поле, прежнее поле этой колонки освобождается */
  const setCol = (role: Role, col: number | null) =>
    setCols(c => {
      const next = { ...c };
      if (col !== null) for (const r of ROLES) if (next[r] === col) next[r] = null;
      next[role] = col;
      return next;
    });
  const roleOf = (col: number): Role | null => ROLES.find(r => cols[r] === col) ?? null;

  const missing = !name.trim() ? t('supplierPrices.profile.needName') : !cols.article || (!cols.priceNet && !cols.priceGross) ? t('supplierPrices.profile.needArticlePrice') : null;
  const save = async () => {
    if (missing || !cols.article) return;
    setBusy(true);
    try {
      await api.saveProfile({ id: profile?.id, companyId, name: name.trim(), firstRow, articleCol: cols.article, nameCol: cols.name, priceNetCol: cols.priceNet, priceGrossCol: cols.priceGross, unitCol: cols.unit });
      toast(t('supplierPrices.formats.saved'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const gridCols = preview ? Math.min(preview.columns, MAX_GRID_COLS) : 0;
  const sampleRows = preview ? preview.rows.slice(0, SAMPLE_ROWS) : [];
  /** Подпись колонки в списке: заголовок (строка перед первой строкой данных) или первое непустое значение данных */
  const colTitle = (ci: number): string => {
    const head = firstRow > 1 ? (sampleRows[firstRow - 2]?.[ci] ?? '').trim() : '';
    if (head) return head;
    for (let ri = firstRow - 1; ri < sampleRows.length; ri++) {
      const v = (sampleRows[ri]?.[ci] ?? '').trim();
      if (v) return v;
    }
    return '';
  };
  const colOptions = [
    { value: NONE, label: t('supplierPrices.profile.none') },
    ...Array.from({ length: gridCols }, (_, i) => ({ value: String(i + 1), label: `${colLetter(i + 1)}${colTitle(i) ? ` — ${clip(colTitle(i))}` : ''}` })),
  ];
  const roleLabel = (r: Role) => t(`supplierPrices.profile.role.${r}` as const);
  const roleField = (role: Role, optional?: boolean) => (
    <Field label={roleLabel(role) + (optional ? ` (${t('supplierPrices.profile.optional')})` : '')} key={role}>
      {f => <Select id={f.id} size="sm" value={cols[role] ? String(cols[role]) : NONE} onValueChange={v => setCol(role, v === NONE ? null : Number(v))} options={colOptions} />}
    </Field>
  );

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        size="lg"
        title={profile ? t('supplierPrices.profile.titleEdit') : t('supplierPrices.profile.titleNew')}
        footer={
          <>
            {missing && <span className="muted" style={{ fontSize: 12.5 }}>{missing}</span>}
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">{t('pricing.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" loading={busy} disabled={!!missing} onClick={() => void save()}>
              {t('supplierPrices.profile.save')}
            </Button>
          </>
        }
      >
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
          <Field label={t('supplierPrices.profile.name')} className="grow">
            {f => <Input {...f} maxLength={200} placeholder={t('supplierPrices.profile.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />}
          </Field>
          <Field label={t('supplierPrices.profile.firstRow')}>{f => <NumberField id={f.id} value={firstRow} min={1} onChange={setFirstRow} aria-label={t('supplierPrices.profile.firstRow')} />}</Field>
          <div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => void pickFile(e.target.files?.[0])} />
            <Button loading={busy && !preview} onClick={() => fileRef.current?.click()}>
              <FileUp size={13} />
              {preview ? t('supplierPrices.profile.changeFile') : t('supplierPrices.profile.pickFile')}
            </Button>
          </div>
        </div>
        {!preview ? (
          <p className="muted" style={{ fontSize: 12.5 }}>
            {profile ? t('supplierPrices.profile.editNoFile', { summary: profileSummary(t, profile) }) : t('supplierPrices.profile.sampleHint')}
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 10 }}>
              {roleField('article')}
              {roleField('name')}
              {roleField('priceNet')}
              {roleField('priceGross')}
              {roleField('unit', true)}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
              {preview.fileName}. {t('supplierPrices.profile.gridHint', { n: SAMPLE_ROWS })}
            </p>
            <div style={{ overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              <table className="dtbl" aria-label={t('supplierPrices.profile.sample')} style={{ minWidth: 'max-content', fontSize: 12 }}>
                <thead style={{ background: 'var(--surface)' }}>
                  <tr>
                    <th style={{ width: 44 }}>{t('supplierPrices.profile.row')}</th>
                    {Array.from({ length: gridCols }, (_, i) => {
                      const r = roleOf(i + 1);
                      return (
                        <th key={i} style={{ minWidth: 90, background: r ? 'var(--accent-soft)' : undefined }}>
                          <div>{colLetter(i + 1)}</div>
                          {r && <div style={{ fontWeight: 500, fontSize: 11 }}>{roleLabel(r)}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((r, ri) => {
                    const rowNo = ri + 1;
                    return (
                      <tr key={ri} onClick={() => setFirstRow(rowNo)} style={{ cursor: 'pointer', outline: rowNo === firstRow ? '2px solid var(--accent)' : undefined, outlineOffset: -2 }} className={cn(rowNo < firstRow && 'faint')} aria-selected={rowNo === firstRow}>
                        <td className="faint">{rowNo}</td>
                        {Array.from({ length: gridCols }, (_, ci) => (
                          <td key={ci} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: rowNo >= firstRow && roleOf(ci + 1) ? 'var(--accent-soft)' : undefined }}>
                            {r[ci] ?? ''}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- загрузка прайса ---------------- */

function UploadDialog({ companyId, profiles, onClose }: { companyId: string; profiles: SupplierProfile[]; onClose: () => void }) {
  const t = useT();
  const api = useSupplierPricesApi();
  const navigate = useNavigate();
  const [profileId, setProfileId] = React.useState(profiles[0]?.id ?? '');
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');
  const [date, setDate] = React.useState(today());
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file || !profileId || !date) return;
    setBusy(true);
    try {
      const r = await api.upload({ companyId, profileId, date, name: name || file.name.replace(/\.[^.]+$/, ''), file });
      toast(t('supplierPrices.upload.uploaded'));
      onClose();
      navigate(supplierPricePath(companyId, r.price.id));
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent
        title={t('supplierPrices.upload.title')}
        footer={
          <>
            <span className="sp" />
            <DialogClose asChild>
              <Button variant="ghost">{t('pricing.cancel')}</Button>
            </DialogClose>
            <Button variant="primary" loading={busy} disabled={!file || !profileId || !date} onClick={() => void submit()}>
              {t('supplierPrices.upload.submit')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ display: 'grid', gap: 12 }}>
          <Field label={t('supplierPrices.upload.profile')}>{f => <Select id={f.id} value={profileId} onValueChange={setProfileId} options={profiles.map(p => ({ value: p.id, label: p.name }))} />}</Field>
          <Field label={t('supplierPrices.upload.file')} hint={file ? fmtBytes(file.size, t) : undefined}>
            {() => (
              <div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <Button onClick={() => fileRef.current?.click()}>
                  <FileUp size={13} />
                  {file ? file.name : t('supplierPrices.upload.pickFile')}
                </Button>
              </div>
            )}
          </Field>
          <Field label={t('supplierPrices.upload.name')}>{f => <Input {...f} maxLength={200} placeholder={file ? file.name.replace(/\.[^.]+$/, '') : t('supplierPrices.upload.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />}</Field>
          <Field label={t('supplierPrices.upload.date')}>{f => <DateInput id={f.id} required value={date} onChange={setDate} />}</Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
