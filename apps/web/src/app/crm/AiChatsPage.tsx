/* CRM → ИИ-чаты: список диалогов чат-бота на сайте, поиск по тексту/IP, фильтр по языку и просмотр в карточке. */
import * as React from 'react';
import { Bot, GitBranch, MessageSquare, RefreshCw, Search, Settings } from 'lucide-react';
import { Badge, Button, EmptyState, Input, Skeleton, Tab, Tabs, TabsList } from '@/components/ui';
import { DataTable, useDataTable, type Column } from '@/components/erp/data-table';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { AiChatDrawer } from './AiChatDrawer';
import { AiChatSettingsDrawer } from './AiChatSettingsDrawer';
import { SalesScriptEditor } from './SalesScriptEditor';
import { firstUserMessage, useAiChats, type AiChatSession } from './ai-chats-data';

const LOCALES = ['all', 'ru', 'en', 'es'] as const;
type LocaleFilter = (typeof LOCALES)[number];

type AiChatsTab = 'dialogs' | 'script';

export function AiChatsPage() {
  const t = useT();
  const [tab, setTab] = React.useState<AiChatsTab>('dialogs');
  const [q, setQ] = React.useState('');
  const [locale, setLocale] = React.useState<LocaleFilter>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const list = useAiChats({ q: q.trim() || undefined, locale });
  const rows = list.data?.items ?? [];
  const selected = React.useMemo(() => rows.find(r => r.id === selectedId) ?? null, [rows, selectedId]);

  const columns = React.useMemo<Column<AiChatSession>[]>(
    () => [
      {
        id: 'date',
        header: t('aiChats.col.date'),
        width: 150,
        value: r => r.updatedAt,
        cell: r => <span className="muted num">{fmtDateTime(r.updatedAt)}</span>,
      },
      {
        id: 'visitor',
        header: t('aiChats.col.visitor'),
        width: 190,
        value: r => r.visitorName ?? '',
        cell: r =>
          r.visitorName ? (
            <button
              type="button"
              className="trunc"
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontWeight: 500, color: 'var(--accent)', textAlign: 'left' }}
              onClick={e => {
                e.stopPropagation();
                setQ(prev => (prev === r.visitorName ? '' : r.visitorName!));
              }}
              title={r.visitorName}
            >
              {r.visitorName}
            </button>
          ) : (
            <span className="faint">—</span>
          ),
      },
      {
        id: 'firstMessage',
        header: t('aiChats.col.firstMessage'),
        width: 280,
        grow: true,
        value: r => firstUserMessage(r),
        cell: r => {
          const preview = firstUserMessage(r);
          return preview ? <span className="trunc" style={{ fontWeight: 450 }}>{preview}</span> : <span className="faint">—</span>;
        },
      },
      {
        id: 'messages',
        header: t('aiChats.col.messages'),
        width: 100,
        align: 'right',
        value: r => r.messageCount,
        cell: r => <Badge tone="neutral">{r.messageCount}</Badge>,
      },
      {
        id: 'locale',
        header: t('aiChats.col.locale'),
        width: 90,
        value: r => r.locale,
        cell: r => <Badge tone="accent">{r.locale.toUpperCase()}</Badge>,
      },
      {
        id: 'page',
        header: t('aiChats.col.page'),
        width: 200,
        value: r => r.pageUrl ?? '',
        cell: r => <span className="trunc muted">{r.pageUrl || '—'}</span>,
      },
      {
        id: 'ip',
        header: t('aiChats.col.ip'),
        width: 130,
        value: r => r.ip,
        cell: r => <span className="num muted">{r.ip}</span>,
      },
      {
        id: 'lead',
        header: t('aiChats.col.lead'),
        width: 120,
        value: r => (r.leadId ? 1 : 0),
        cell: r => (r.leadId ? <Badge tone="green">{t('aiChats.actions.leadCreated')}</Badge> : <span className="faint">—</span>),
      },
    ],
    [t],
  );
  const table = useDataTable(columns);
  const noFilters = !q.trim() && locale === 'all';

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{t('aiChats.title')}</h1>
          <p>{t('aiChats.subtitle')}</p>
        </div>
        <div className="acts">
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings size={14} />
            {t('aiChats.settings.button')}
          </Button>
          {tab === 'dialogs' && (
            <Button variant="ghost" size="sm" loading={list.isFetching} onClick={() => void list.refetch()}>
              <RefreshCw size={14} />
              {t('aiChats.actions.refresh')}
            </Button>
          )}
        </div>
      </div>

      <div style={{ padding: '0 var(--page-pad, 24px)', marginBottom: 14 }}>
        <Tabs value={tab} onValueChange={v => setTab(v as AiChatsTab)}>
          <TabsList>
            <Tab value="dialogs">
              <MessageSquare size={14} />
              {t('aiChats.tabs.dialogs')}
            </Tab>
            <Tab value="script">
              <GitBranch size={14} />
              {t('aiChats.tabs.script')}
            </Tab>
          </TabsList>
        </Tabs>
      </div>

      {tab === 'script' ? (
        <SalesScriptEditor />
      ) : (
        <>
          <div className="row" style={{ gap: 8, padding: '0 var(--page-pad, 24px) 12px', flexWrap: 'wrap' }}>
            <Input
              size="sm"
              icon={<Search size={13} />}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('aiChats.searchPlaceholder')}
              aria-label={t('aiChats.searchPlaceholder')}
              style={{ width: 260 }}
            />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {LOCALES.map(loc => (
                <button key={loc} type="button" className={`chip${locale === loc ? ' on' : ''}`} aria-pressed={locale === loc} onClick={() => setLocale(loc)}>
                  {t(`aiChats.localeFilter.${loc}`)}
                </button>
              ))}
            </div>
          </div>

          {list.isPending ? (
            <div className="stack" style={{ gap: 8, padding: '0 var(--page-pad, 24px)' }}>
              <Skeleton h={32} w="100%" />
              <Skeleton h={32} w="100%" />
              <Skeleton h={32} w="100%" />
            </div>
          ) : !rows.length && noFilters ? (
            <EmptyState icon={<Bot size={20} />} title={t('aiChats.empty')}>
              {t('aiChats.emptyHint')}
            </EmptyState>
          ) : (
            <DataTable aria-label={t('aiChats.title')} columns={columns} rows={rows} table={table} getId={r => r.id} onRowClick={r => setSelectedId(r.id)} />
          )}
        </>
      )}

      {selected && <AiChatDrawer session={selected} onClose={() => setSelectedId(null)} />}
      <AiChatSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
