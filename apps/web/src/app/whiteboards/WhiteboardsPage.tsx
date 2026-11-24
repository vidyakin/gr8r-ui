/* Список интерактивных досок: поиск, быстрые шаблоны и сетка сохранённых досок */
import * as React from 'react';
import { useNavigate } from 'react-router';
import { LayoutTemplate, PenTool, Plus, Search, SearchX, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Input, Skeleton, toast } from '@/components/ui';
import { fmtDateTime, useT } from '@/i18n';
import { WB_TEMPLATES, type WbTemplate } from './canvas/templates';
import { useWhiteboards, useWhiteboardsApi, type WhiteboardSummary } from './data';

export function WhiteboardsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [removing, setRemoving] = React.useState<WhiteboardSummary | null>(null);
  const boards = useWhiteboards(q);
  const api = useWhiteboardsApi();
  const rows = boards.data ?? [];

  const createBlank = async () => {
    setCreating(true);
    try {
      const created = await api.create({ title: t('whiteboards.defaultTitle') });
      toast.success(t('whiteboards.toast.created'));
      navigate(`/whiteboards/${created.id}`);
    } finally {
      setCreating(false);
    }
  };

  const createFromTemplate = async (tpl: WbTemplate) => {
    setCreating(true);
    try {
      const created = await api.create({ title: tpl.name, elements: tpl.elements });
      toast.success(t('whiteboards.toast.created'));
      navigate(`/whiteboards/${created.id}`);
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!removing) return;
    await api.remove(removing.id);
    toast.success(t('whiteboards.toast.deleted'));
    setRemoving(null);
  };

  return (
    <div className="page wide">
      <div className="ph">
        <div>
          <h1>{t('whiteboards.title')}</h1>
          <p>{t('whiteboards.subtitle')}</p>
        </div>
        <div className="acts">
          <Input
            size="sm"
            icon={<Search size={14} />}
            placeholder={t('whiteboards.search')}
            aria-label={t('whiteboards.search')}
            value={q}
            onChange={e => setQ(e.target.value)}
            style={{ width: 240 }}
          />
          <Button variant="primary" size="sm" disabled={creating} onClick={createBlank}>
            <Plus size={14} />
            {t('whiteboards.newBoard')}
          </Button>
        </div>
      </div>

      <section style={{ marginBottom: 24 }}>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <h2 className="sec">{t('whiteboards.templatesTitle')}</h2>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {t('whiteboards.templatesHint')}
          </span>
        </div>
        <div className="pgrid">
          {WB_TEMPLATES.map(tpl => (
            <button
              key={tpl.id}
              type="button"
              className="pcard"
              disabled={creating}
              onClick={() => void createFromTemplate(tpl)}
            >
              <div className="row" style={{ gap: 10 }}>
                <span
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--accent-soft, rgba(75, 91, 214, 0.1))',
                    color: 'var(--accent, #4b5bd6)',
                    flexShrink: 0,
                  }}
                >
                  <LayoutTemplate size={15} />
                </span>
                <b style={{ fontSize: 14, fontWeight: 600 }}>{tpl.name}</b>
              </div>
              <div className="desc">{tpl.description}</div>
              <div className="foot">
                <Badge tone="accent">{t('whiteboards.elements', { count: tpl.elements.length })}</Badge>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section>
        {boards.isPending ? (
          <div className="pgrid">
            <Skeleton w="100%" h={132} />
            <Skeleton w="100%" h={132} />
            <Skeleton w="100%" h={132} />
          </div>
        ) : rows.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={q.trim() ? <SearchX size={20} /> : <PenTool size={20} />}
              title={q.trim() ? t('whiteboards.empty.noResults') : t('whiteboards.empty.title')}
              action={
                q.trim() ? (
                  <Button variant="secondary" size="sm" onClick={() => setQ('')}>
                    {t('common.clearFilters')}
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" disabled={creating} onClick={createBlank}>
                    <Plus size={14} />
                    {t('whiteboards.blankBoard')}
                  </Button>
                )
              }
            >
              {!q.trim() && t('whiteboards.empty.hint')}
            </EmptyState>
          </div>
        ) : (
          <div className="pgrid">
            {rows.map(board => (
              <div
                key={board.id}
                className="pcard"
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/whiteboards/${board.id}`)}
                onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && navigate(`/whiteboards/${board.id}`)}
              >
                <div className="row" style={{ gap: 10, paddingRight: 28 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--bg-2, #f4f3ef)',
                      color: 'var(--text-2)',
                      flexShrink: 0,
                    }}
                  >
                    <PenTool size={14} />
                  </span>
                  <span className="trunc" style={{ fontSize: 14.5, fontWeight: 600 }}>
                    {board.title}
                  </span>
                </div>
                <div className="more" onClick={e => e.stopPropagation()}>
                  <IconButton
                    size="xs"
                    label={t('whiteboards.delete')}
                    onClick={() => setRemoving(board)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                <div className="foot" style={{ marginTop: 'auto', justifyContent: 'space-between' }}>
                  <Badge>{t('whiteboards.elements', { count: board.elementCount })}</Badge>
                  <span className="num">{fmtDateTime(board.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={open => !open && setRemoving(null)}
        title={t('whiteboards.deleteTitle')}
        description={removing ? t('whiteboards.deleteConfirm', { name: removing.title }) : undefined}
        confirmLabel={t('whiteboards.delete')}
        cancelLabel={t('whiteboards.cancel')}
        danger
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
