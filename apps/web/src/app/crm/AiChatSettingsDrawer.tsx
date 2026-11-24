/* Боковая карточка настроек ИИ-консультанта: выбор тона, дополнительные инструкции и приветствие по языкам. */
import * as React from 'react';
import { Check } from 'lucide-react';
import { Button, Field, Segmented, Skeleton, Textarea, toast } from '@/components/ui';
import { DrawerSection, EntityDrawer } from '@/components/erp/entity-drawer';
import { useT } from '@/i18n';
import { useAiChatSettings, useAiChatsApi, type AiChatTone } from './ai-chats-data';
import { AiChatKnowledgeTab, AiChatWidgetTab, type WidgetFormState } from './AiChatWidgetSettings';

type SettingsTab = 'bot' | 'widget' | 'kb';

const TONES: AiChatTone[] = ['friendly', 'formal', 'concise', 'sales'];
const GREETING_LOCALES = [
  { key: 'ru', labelKey: 'aiChats.settings.greetingRu' },
  { key: 'en', labelKey: 'aiChats.settings.greetingEn' },
  { key: 'es', labelKey: 'aiChats.settings.greetingEs' },
] as const;

function AiChatSettingsContent({ onClose }: { onClose: () => void }) {
  const t = useT();
  const settings = useAiChatSettings();
  const api = useAiChatsApi();

  const [tab, setTab] = React.useState<SettingsTab>('bot');
  const [tone, setTone] = React.useState<AiChatTone>('friendly');
  const [customToneNote, setCustomToneNote] = React.useState('');
  const [greeting, setGreeting] = React.useState({ ru: '', en: '', es: '' });
  const [widget, setWidget] = React.useState<WidgetFormState>({
    widgetEnabled: false,
    widgetToken: null,
    allowedOriginsText: '',
    botName: '',
    accentColor: '#2563eb',
    position: 'right',
    handoffEnabled: true,
    soundEnabled: true,
    dailyLimit: 300,
    knowledgeBase: '',
  });
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [rotating, setRotating] = React.useState(false);
  const [scraping, setScraping] = React.useState(false);

  React.useEffect(() => {
    if (!settings.data || dirty) return;
    setTone(settings.data.tone);
    setCustomToneNote(settings.data.customToneNote ?? '');
    setGreeting({
      ru: settings.data.greeting?.ru ?? '',
      en: settings.data.greeting?.en ?? '',
      es: settings.data.greeting?.es ?? '',
    });
    setWidget({
      widgetEnabled: settings.data.widgetEnabled ?? false,
      widgetToken: settings.data.widgetToken ?? null,
      allowedOriginsText: (settings.data.allowedOrigins ?? []).join('\n'),
      botName: settings.data.botName ?? '',
      accentColor: settings.data.accentColor ?? '#2563eb',
      position: settings.data.position ?? 'right',
      handoffEnabled: settings.data.handoffEnabled ?? true,
      soundEnabled: settings.data.soundEnabled ?? true,
      dailyLimit: settings.data.dailyLimit ?? 300,
      knowledgeBase: settings.data.knowledgeBase ?? '',
    });
  }, [settings.data, dirty]);

  const updateWidget = (patch: Partial<WidgetFormState>) => {
    setWidget(prev => ({ ...prev, ...patch }));
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const allowedOrigins = widget.allowedOriginsText
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const accentColor = /^#[0-9a-fA-F]{6}$/.test(widget.accentColor.trim()) ? widget.accentColor.trim() : '#2563eb';
    const res = await api.saveSettings({
      tone,
      customToneNote,
      greeting,
      widgetEnabled: widget.widgetEnabled,
      allowedOrigins,
      botName: widget.botName,
      accentColor,
      position: widget.position,
      handoffEnabled: widget.handoffEnabled,
      soundEnabled: widget.soundEnabled,
      dailyLimit: widget.dailyLimit,
      knowledgeBase: widget.knowledgeBase,
    });
    setSaving(false);
    if (res) {
      setWidget(prev => ({
        ...prev,
        widgetToken: res.widgetToken ?? prev.widgetToken,
        allowedOriginsText: (res.allowedOrigins ?? []).join('\n'),
      }));
      setDirty(false);
      setSaved(true);
      toast.success(t('aiChats.settings.saved'));
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    const res = await api.rotateWidgetToken();
    setRotating(false);
    if (res) {
      setWidget(prev => ({ ...prev, widgetToken: res.widgetToken ?? null }));
      toast.success(t('aiChats.settings.widgetRotated'));
    }
  };

  const handleScrape = async (url: string) => {
    setScraping(true);
    const res = await api.scrapeKnowledgeBase(url);
    setScraping(false);
    if (res?.knowledgeBase) {
      updateWidget({ knowledgeBase: res.knowledgeBase });
      toast.success(t('aiChats.settings.kbScraped'));
    }
  };

  const handleEnableWidget = async () => {
    setSaving(true);
    const res = await api.saveSettings({ widgetEnabled: true });
    setSaving(false);
    if (res) {
      setWidget(prev => ({
        ...prev,
        widgetEnabled: true,
        widgetToken: res.widgetToken ?? prev.widgetToken,
      }));
      toast.success(t('aiChats.settings.saved'));
    }
  };

  return (
    <EntityDrawer
      trackName="ai-chat-settings"
      label={t('aiChats.settings.title')}
      title={t('aiChats.settings.title')}
      subtitle={t('aiChats.settings.subtitle')}
      actions={
        <div className="row" style={{ gap: 8 }}>
          {saved && (
            <span className="row muted" style={{ gap: 4, fontSize: 12.5 }}>
              <Check size={13} />
              {t('aiChats.settings.saved')}
            </span>
          )}
          <Button size="sm" variant="primary" loading={saving} disabled={settings.isPending} onClick={() => void handleSave()}>
            {saving ? t('aiChats.settings.saving') : t('aiChats.settings.save')}
          </Button>
        </div>
      }
      onClose={onClose}
    >
      {settings.isPending ? (
        <div className="stack" style={{ gap: 12, marginTop: 16 }}>
          <Skeleton h={36} w="100%" />
          <Skeleton h={84} w="100%" />
          <Skeleton h={180} w="100%" />
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <Segmented
              value={tab}
              onValueChange={setTab}
              items={[
                { value: 'bot' as const, label: t('aiChats.settings.tabs.bot') },
                { value: 'widget' as const, label: t('aiChats.settings.tabs.widget') },
                { value: 'kb' as const, label: t('aiChats.settings.tabs.kb') },
              ]}
            />
          </div>

          {tab === 'bot' && (
            <>
              <DrawerSection title={t('aiChats.settings.toneLabel')}>
                <div className="stack" style={{ gap: 12 }}>
                  <Segmented
                    value={tone}
                    onValueChange={opt => {
                      setTone(opt);
                      setDirty(true);
                      setSaved(false);
                    }}
                    items={TONES.map(opt => ({
                      value: opt,
                      label: t(`aiChats.settings.tones.${opt}`),
                    }))}
                  />
                  <Field label={t('aiChats.settings.customToneLabel')}>
                    {({ id, invalid }) => (
                      <Textarea
                        id={id}
                        invalid={invalid}
                        rows={3}
                        maxLength={400}
                        value={customToneNote}
                        placeholder={t('aiChats.settings.customTonePh')}
                        onChange={e => {
                          setCustomToneNote(e.target.value);
                          setDirty(true);
                          setSaved(false);
                        }}
                      />
                    )}
                  </Field>
                </div>
              </DrawerSection>

              <DrawerSection title={t('aiChats.settings.greetingTitle')}>
                <div className="stack" style={{ gap: 12 }}>
                  <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{t('aiChats.settings.greetingHint')}</p>
                  {GREETING_LOCALES.map(({ key, labelKey }) => (
                    <Field key={key} label={t(labelKey)}>
                      {({ id, invalid }) => (
                        <Textarea
                          id={id}
                          invalid={invalid}
                          rows={2}
                          maxLength={400}
                          value={greeting[key]}
                          onChange={e => {
                            const value = e.target.value;
                            setGreeting(prev => ({ ...prev, [key]: value }));
                            setDirty(true);
                            setSaved(false);
                          }}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              </DrawerSection>
            </>
          )}

          {tab === 'widget' && (
            <AiChatWidgetTab
              state={widget}
              onChange={updateWidget}
              onEnableWidget={handleEnableWidget}
              onRotateToken={handleRotate}
              enabling={saving}
              rotating={rotating}
            />
          )}

          {tab === 'kb' && (
            <AiChatKnowledgeTab
              knowledgeBase={widget.knowledgeBase}
              onChange={val => updateWidget({ knowledgeBase: val })}
              onScrapeWebsite={handleScrape}
              scraping={scraping}
            />
          )}
        </>
      )}
    </EntityDrawer>
  );
}

export function AiChatSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <AiChatSettingsContent onClose={onClose} />;
}
