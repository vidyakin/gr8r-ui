/* Шаблоны КП (как справочник 1С:УНФ «Шаблоны КП и договоров»): /crm/quote-templates. Список слева, редактор справа:
   текст с простой разметкой (# заголовок, **жирный**, пустая строка — абзац), параметры {{…}} и блоки вставляются кнопками
   в позицию курсора. «Используется» — шаблон в меню «Печать» КП и заказа; «Только автор» — видит и печатает только автор.
   Правит и удаляет автор или admin+ (проверяет сервер). Рендер — packages/shared/src/print/quote.ts. */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileStack, Plus, Save, Trash2 } from 'lucide-react';
import { DEFAULT_QUOTE_TEMPLATE, QUOTE_TEMPLATE_BLOCKS, QUOTE_TEMPLATE_PARAMS } from '@gr8r/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Input, Skeleton, Switch, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useCanWrite } from '../meta/custom-fields';
import { call, useWsId } from '../meta/data';
import { useDocTemplates, type DocTemplate } from './data';

interface Draft {
  name: string;
  body: string;
  isUsed: boolean;
  onlyAuthor: boolean;
}

const toDraft = (x: DocTemplate): Draft => ({ name: x.name, body: x.body, isUsed: x.isUsed, onlyAuthor: x.onlyAuthor });

export function QuoteTemplatesPage() {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const list = useDocTemplates();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement>(null);
  const current = list.data?.find(x => x.id === selected) ?? null;

  // выбранный шаблон открывается в редакторе; после сохранения — данные сервера
  React.useEffect(() => {
    if (current) setDraft(toDraft(current));
  }, [current?.id, current?.updatedAt]);
  React.useEffect(() => {
    if (!selected && list.data?.length) setSelected(list.data[0]!.id);
  }, [list.data, selected]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['ws', ws, 'doc-templates'] });
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const r = await run(() => call<DocTemplate>(ws, 'POST', '/doc-templates', { name: t('docs.quotes.newTemplateName'), body: DEFAULT_QUOTE_TEMPLATE }));
    if (!r) return;
    await refresh();
    setSelected(r.id);
    setDraft(toDraft(r));
  };
  const save = async () => {
    if (!current || !draft || !draft.name.trim()) return;
    const r = await run(() => call<DocTemplate>(ws, 'PATCH', `/doc-templates/${current.id}`, { ...draft, name: draft.name.trim() }));
    if (!r) return;
    toast(t('docs.quotes.saved'));
    await refresh();
  };
  const remove = async () => {
    if (!current) return;
    const r = await run(() => call(ws, 'DELETE', `/doc-templates/${current.id}`));
    if (r === null) return;
    setSelected(null);
    setDraft(null);
    await refresh();
  };

  /** Вставить параметр или блок в позицию курсора; блок — отдельной строкой */
  const insert = (text: string, block: boolean) => {
    if (!draft) return;
    const el = area.current;
    const at = el ? el.selectionStart : draft.body.length;
    const end = el ? el.selectionEnd : at;
    const before = draft.body.slice(0, at);
    const piece = block ? `${before && !before.endsWith('\n') ? '\n' : ''}${text}\n` : text;
    setDraft({ ...draft, body: before + piece + draft.body.slice(end) });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = at + piece.length;
    });
  };

  const dirty = !!current && !!draft && JSON.stringify(toDraft(current)) !== JSON.stringify(draft);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('docs.quotes.templatesTitle')}</h1>
          <p>{t('docs.quotes.templatesSubtitle')}</p>
        </div>
        {canWrite && (
          <div className="acts">
            <Button variant="primary" onClick={() => void create()} disabled={busy}>
              <Plus size={14} />
              {t('docs.quotes.newTemplate')}
            </Button>
          </div>
        )}
      </div>
      {list.isPending ? (
        <Skeleton w="100%" h={300} />
      ) : !list.data?.length ? (
        <EmptyState icon={<FileStack size={20} />} title={t('docs.quotes.emptyTitle')}>
          {t('docs.quotes.emptyHint')}
        </EmptyState>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'start', padding: '0 16px 16px' }}>
          <ul className="panel" aria-label={t('docs.quotes.templatesTitle')} style={{ listStyle: 'none', margin: 0, padding: 4, flex: '1 1 220px', maxWidth: 320 }}>
            {list.data.map(x => (
              <li key={x.id}>
                <button type="button" className={`nav-item${x.id === selected ? ' on' : ''}`} aria-current={x.id === selected ? 'true' : undefined} onClick={() => setSelected(x.id)} style={{ width: '100%', textAlign: 'left', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px' }}>
                  <span className="trunc">{x.name}</span>
                  {!x.isUsed && <Badge tone="gray">{t('docs.quotes.notUsed')}</Badge>}
                  {x.onlyAuthor && <Badge tone="amber">{t('docs.quotes.onlyAuthorBadge')}</Badge>}
                </button>
              </li>
            ))}
          </ul>
          {current && draft && (
            <section className="panel" aria-label={t('docs.quotes.editorAria')} style={{ padding: 12, display: 'grid', gap: 12, flex: '4 1 480px', minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
                <div style={{ flex: '1 1 260px' }}>
                  <Field label={t('docs.quotes.templateName')}>{p => <Input {...p} value={draft.name} maxLength={200} disabled={!canWrite} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>
                </div>
                <label className="row" style={{ gap: 6 }}>
                  <Switch checked={draft.isUsed} disabled={!canWrite} onChange={e => setDraft({ ...draft, isUsed: e.target.checked })} />
                  {t('docs.quotes.isUsed')}
                </label>
                <label className="row" style={{ gap: 6 }}>
                  <Switch checked={draft.onlyAuthor} disabled={!canWrite} onChange={e => setDraft({ ...draft, onlyAuthor: e.target.checked })} />
                  {t('docs.quotes.onlyAuthor')}
                </label>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'start' }}>
                <div style={{ flex: '3 1 380px', minWidth: 0 }}>
                  <Field label={t('docs.quotes.body')} hint={t('docs.quotes.markupHint')}>
                    {p => <Textarea {...p} ref={area} value={draft.body} disabled={!canWrite} rows={24} spellCheck={false} className="mono" style={{ fontSize: 12, width: '100%' }} onChange={e => setDraft({ ...draft, body: e.target.value })} />}
                  </Field>
                </div>
                <div style={{ flex: '1 1 200px', display: 'grid', gap: 6 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {t('docs.quotes.blocks')}
                  </div>
                  {QUOTE_TEMPLATE_BLOCKS.map(b => (
                    <Button key={b} size="sm" disabled={!canWrite} onClick={() => insert(`{{${b}}}`, true)}>
                      {b}
                    </Button>
                  ))}
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {t('docs.quotes.params')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {QUOTE_TEMPLATE_PARAMS.map(p => (
                      <Button key={p} size="sm" variant="ghost" disabled={!canWrite} onClick={() => insert(`{{${p}}}`, false)}>
                        {p}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              {canWrite && (
                <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <Button variant="ghost" onClick={() => setConfirm(true)} disabled={busy}>
                    <Trash2 size={14} />
                    {t('common.delete')}
                  </Button>
                  <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty || !draft.name.trim()}>
                    <Save size={14} />
                    {t('common.save')}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title={t('docs.quotes.deleteTemplateTitle', { name: current?.name ?? '' })}
        description={t('docs.quotes.deleteTemplateHint')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
