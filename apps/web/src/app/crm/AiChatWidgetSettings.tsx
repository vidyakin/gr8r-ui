/* Секции настроек встраиваемого виджета и базы знаний компании для AiChatSettingsDrawer. */
import * as React from 'react';
import { Copy, Globe, RefreshCw, Sparkles } from 'lucide-react';
import { Button, Field, Input, Segmented, Textarea, toast } from '@/components/ui';
import { DrawerSection } from '@/components/erp/entity-drawer';
import { useT } from '@/i18n';
import type { WidgetPosition } from './ai-chats-data';

export interface WidgetFormState {
  widgetEnabled: boolean;
  widgetToken: string | null;
  allowedOriginsText: string;
  botName: string;
  accentColor: string;
  position: WidgetPosition;
  handoffEnabled: boolean;
  soundEnabled: boolean;
  dailyLimit: number;
  knowledgeBase: string;
}

interface WidgetTabProps {
  state: WidgetFormState;
  onChange: (patch: Partial<WidgetFormState>) => void;
  onEnableWidget: () => Promise<void>;
  onRotateToken: () => Promise<void>;
  enabling: boolean;
  rotating: boolean;
}

export function AiChatWidgetTab({ state, onChange, onEnableWidget, onRotateToken, enabling, rotating }: WidgetTabProps) {
  const t = useT();

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://future-erp.ru';
  const snippet = state.widgetToken
    ? `<script src="${origin}/widget/chat.js" data-token="${state.widgetToken}" async></script>`
    : '';

  const copySnippet = () => {
    if (!snippet) return;
    void navigator.clipboard?.writeText(snippet);
    toast.success(t('aiChats.settings.widgetCopied'));
  };

  return (
    <DrawerSection title={t('aiChats.settings.widgetTitle')}>
        <div className="stack" style={{ gap: 12 }}>
          <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={state.widgetEnabled}
              onChange={e => onChange({ widgetEnabled: e.target.checked })}
            />
            <span>{t('aiChats.settings.widgetEnabled')}</span>
          </label>

          {snippet ? (
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 12 }}>{t('aiChats.settings.widgetSnippetLabel')}</span>
              <pre
                style={{
                  margin: 0,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--bg-muted, rgba(128,128,128,0.08))',
                  fontSize: 11.5,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {snippet}
              </pre>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button size="sm" variant="secondary" onClick={copySnippet}>
                  <Copy size={13} />
                  <span>{t('aiChats.settings.widgetCopy')}</span>
                </Button>
                <Button size="sm" variant="ghost" loading={rotating} onClick={() => void onRotateToken()}>
                  <RefreshCw size={13} />
                  <span>{t('aiChats.settings.widgetRotate')}</span>
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="stack"
              style={{
                gap: 8,
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px dashed var(--border)',
                background: 'var(--bg-muted, rgba(128,128,128,0.06))',
              }}
            >
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{t('aiChats.settings.widgetEnableFirst')}</p>
              <div>
                <Button size="sm" variant="primary" loading={enabling} onClick={() => void onEnableWidget()}>
                  {t('aiChats.settings.widgetEnabled')}
                </Button>
              </div>
            </div>
          )}

          <Field label={t('aiChats.settings.allowedOriginsLabel')}>
            {({ id, invalid }) => (
              <Textarea
                id={id}
                invalid={invalid}
                rows={3}
                value={state.allowedOriginsText}
                placeholder={t('aiChats.settings.allowedOriginsPh')}
                onChange={e => onChange({ allowedOriginsText: e.target.value })}
              />
            )}
          </Field>
          <p className="muted" style={{ fontSize: 12, margin: '-6px 0 0' }}>{t('aiChats.settings.allowedOriginsHint')}</p>

          <div className="row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <Field label={t('aiChats.settings.botNameLabel')}>
                {({ id, invalid }) => (
                  <Input
                    id={id}
                    invalid={invalid}
                    maxLength={60}
                    value={state.botName}
                    placeholder={t('aiChats.settings.botNamePh')}
                    onChange={e => onChange({ botName: e.target.value })}
                  />
                )}
              </Field>
            </div>
            <div style={{ flex: '0 0 130px' }}>
              <Field label={t('aiChats.settings.accentColorLabel')}>
                {({ id }) => (
                  <div className="row" style={{ gap: 6 }}>
                    <input
                      id={id}
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(state.accentColor) ? state.accentColor : '#2563eb'}
                      onChange={e => onChange({ accentColor: e.target.value })}
                      style={{ width: 32, height: 32, padding: 2, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
                    />
                    <Input
                      value={state.accentColor}
                      maxLength={7}
                      onChange={e => onChange({ accentColor: e.target.value })}
                    />
                  </div>
                )}
              </Field>
            </div>
          </div>

          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="muted" style={{ fontSize: 12.5 }}>{t('aiChats.settings.positionLabel')}:</span>
            <Segmented
              value={state.position}
              onValueChange={pos => onChange({ position: pos })}
              items={[
                { value: 'right' as const, label: t('aiChats.settings.posRight') },
                { value: 'left' as const, label: t('aiChats.settings.posLeft') },
              ]}
            />
          </div>

          <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={state.handoffEnabled}
              onChange={e => onChange({ handoffEnabled: e.target.checked })}
            />
            <span>{t('aiChats.settings.handoffEnabled')}</span>
          </label>

          <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={state.soundEnabled}
              onChange={e => onChange({ soundEnabled: e.target.checked })}
            />
            <span>{t('aiChats.settings.soundEnabled')}</span>
          </label>
        </div>
      </DrawerSection>
  );
}

interface KnowledgeTabProps {
  knowledgeBase: string;
  onChange: (value: string) => void;
  onScrapeWebsite: (url: string) => Promise<void>;
  scraping: boolean;
}

export function AiChatKnowledgeTab({ knowledgeBase, onChange, onScrapeWebsite, scraping }: KnowledgeTabProps) {
  const t = useT();
  const [siteUrl, setSiteUrl] = React.useState('');

  return (
    <DrawerSection title={t('aiChats.settings.kbTitle')}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <Input
              icon={<Globe size={13} />}
              value={siteUrl}
              placeholder={t('aiChats.settings.kbScrapePh')}
              onChange={e => setSiteUrl(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={scraping}
            disabled={!siteUrl.trim() || scraping}
            onClick={() => void onScrapeWebsite(siteUrl.trim())}
          >
            <Sparkles size={13} />
            <span>{scraping ? t('aiChats.settings.kbScraping') : t('aiChats.settings.kbScrapeBtn')}</span>
          </Button>
        </div>

        <div
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--bg-muted, rgba(128,128,128,0.08))',
            fontSize: 12,
            lineHeight: 1.45,
          }}
          className="muted"
        >
          {t('aiChats.settings.kbStructureTip')}
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const tpl = t('aiChats.settings.kbTemplate');
              const next = knowledgeBase.trim() ? `${knowledgeBase.trim()}\n\n${tpl}` : tpl;
              onChange(next.slice(0, 20_000));
            }}
          >
            {t('aiChats.settings.kbInsertTemplate')}
          </Button>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {knowledgeBase.length} / 20 000
          </span>
        </div>

        <Textarea
          rows={14}
          maxLength={20_000}
          value={knowledgeBase}
          placeholder={t('aiChats.settings.kbPlaceholder')}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </DrawerSection>
  );
}
