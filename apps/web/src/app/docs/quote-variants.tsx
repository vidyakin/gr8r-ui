/* Варианты КП в КП и заказе покупателя (docs/architecture/quotes.md): открытый в форме вариант — основной, его строки и есть
   строки документа; выбор другого варианта делает его основным (сервер меняет их местами). Менять варианты можно только в черновике. */
import * as React from 'react';
import { Copy, FilePlus2, Layers, Pencil, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, Dialog, DialogClose, DialogContent, Field, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Select } from '@/components/ui';
import { fmtAmount } from '@/i18n/format';
import { useT } from '@/i18n';
import type { DocDetail } from './data';

type Api = <T>(method: string, path: string, json?: unknown) => Promise<T | null>;

export function QuoteVariants({ doc, editable, total, flush, api, onApplied }: { doc: DocDetail; editable: boolean; total: string; flush: () => Promise<boolean>; api: Api; onApplied: (d: DocDetail) => void }) {
  const t = useT();
  const variants = doc.variants ?? [];
  const mainName = doc.variantName ?? t('docs.quotes.firstVariant');
  const [rename, setRename] = React.useState<{ id: string | null; name: string } | null>(null);
  const [remove, setRemove] = React.useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** Перед операцией с вариантами черновик сохраняется: сервер снимает строки основного варианта из БД */
  const run = async (method: string, path: string, json?: unknown) => {
    if (busy || !(await flush())) return;
    setBusy(true);
    try {
      const r = await api<DocDetail>(method, path, json);
      if (r) onApplied(r);
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!rename || !rename.name.trim()) return;
    const name = rename.name.trim();
    if (rename.id) await run('PATCH', `/documents/${doc.id}/variants/${rename.id}`, { name });
    else await run('PATCH', `/documents/${doc.id}`, { variantName: name });
    setRename(null);
  };

  const options = [{ value: 'main', label: `${mainName} · ${fmtAmount(total)}` }, ...variants.map(v => ({ value: v.id, label: `${v.name} · ${fmtAmount(v.totals.total)}` }))];

  return (
    <section className="quote-variants" aria-label={t('docs.quotes.variantsAria')} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '4px 0 8px' }}>
      <Layers size={15} className="muted" aria-hidden />
      <span className="muted">{t('docs.quotes.variant')}</span>
      {variants.length ? (
        <div style={{ width: 300, maxWidth: '100%' }}>
        <Select
          size="sm"
          className="min-w-[220px]"
          aria-label={t('docs.quotes.variant')}
          disabled={!editable || busy}
          value="main"
          onValueChange={v => v !== 'main' && void run('POST', `/documents/${doc.id}/variants/${v}/activate`)}
          options={options}
        />
        </div>
      ) : (
        <span className="faint">{t('docs.quotes.single')}</span>
      )}
      {editable && (
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" disabled={busy}>
              <FilePlus2 size={14} />
              {t('docs.quotes.variantActions')}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Copy size={15} />} onSelect={() => void run('POST', `/documents/${doc.id}/variants`, { copy: true })}>
              {t('docs.quotes.addCopy')}
            </MenuItem>
            <MenuItem icon={<FilePlus2 size={15} />} onSelect={() => void run('POST', `/documents/${doc.id}/variants`, { copy: false })}>
              {t('docs.quotes.addEmpty')}
            </MenuItem>
            {!!variants.length && (
              <>
                <MenuSeparator />
                <MenuItem icon={<Pencil size={15} />} onSelect={() => setRename({ id: null, name: mainName })}>
                  {t('docs.quotes.renameVariant', { name: mainName })}
                </MenuItem>
                {variants.map(v => (
                  <MenuItem key={`r${v.id}`} icon={<Pencil size={15} />} onSelect={() => setRename({ id: v.id, name: v.name })}>
                    {t('docs.quotes.renameVariant', { name: v.name })}
                  </MenuItem>
                ))}
                <MenuSeparator />
                {variants.map(v => (
                  <MenuItem key={`d${v.id}`} danger icon={<Trash2 size={15} />} onSelect={() => setRemove({ id: v.id, name: v.name })}>
                    {t('docs.quotes.deleteVariant', { name: v.name })}
                  </MenuItem>
                ))}
              </>
            )}
          </MenuContent>
        </Menu>
      )}
      {!!variants.length && <span className="faint small">{t('docs.quotes.mainHint')}</span>}

      <Dialog open={!!rename} onOpenChange={o => !o && setRename(null)}>
        <DialogContent
          size="sm"
          title={t('docs.quotes.renameTitle')}
          footer={
            <>
              <DialogClose asChild>
                <Button>{t('common.cancel')}</Button>
              </DialogClose>
              <Button variant="primary" disabled={!rename?.name.trim() || busy} onClick={() => void saveName()}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <Field label={t('docs.quotes.variantName')}>
            {p => <Input {...p} autoFocus value={rename?.name ?? ''} maxLength={200} onChange={e => setRename(r => (r ? { ...r, name: e.target.value } : r))} onKeyDown={e => e.key === 'Enter' && void saveName()} />}
          </Field>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!remove}
        onOpenChange={o => !o && setRemove(null)}
        danger
        title={t('docs.quotes.deleteTitle', { name: remove?.name ?? '' })}
        description={t('docs.quotes.deleteHint')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => remove && void run('DELETE', `/documents/${doc.id}/variants/${remove.id}`)}
      />
    </section>
  );
}
