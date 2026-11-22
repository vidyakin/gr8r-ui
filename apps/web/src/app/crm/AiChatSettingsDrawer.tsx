/* Боковая карточка настроек ИИ-консультанта: выбор тона, дополнительные инструкции и приветствие по языкам. */
import * as React from 'react';
import { Check } from 'lucide-react';
import { Button, Field, Skeleton, Textarea, toast } from '@/components/ui';
import { DrawerSection, EntityDrawer } from '@/components/erp/entity-drawer';
import { useT } from '@/i18n';
import { useAiChatSettings, useAiChatsApi, type AiChatTone } from './ai-chats-data';

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

  const [tone, setTone] = React.useState<AiChatTone>('friendly');
  const [customToneNote, setCustomToneNote] = React.useState('');
  const [greeting, setGreeting] = React.useState({ ru: '', en: '', es: '' });
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (!settings.data || dirty) return;
    setTone(settings.data.tone);
    setCustomToneNote(settings.data.customToneNote ?? '');
    setGreeting({
      ru: settings.data.greeting?.ru ?? '',
      en: settings.data.greeting?.en ?? '',
      es: settings.data.greeting?.es ?? '',
    });
  }, [settings.data, dirty]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const res = await api.saveSettings({ tone, customToneNote, greeting });
    setSaving(false);
    if (res) {
      setDirty(false);
      setSaved(true);
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
          <DrawerSection title={t('aiChats.settings.toneLabel')}>
            <div className="stack" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {TONES.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    className={`chip${tone === opt ? ' on' : ''}`}
                    aria-pressed={tone === opt}
                    onClick={() => {
                      setTone(opt);
                      setDirty(true);
                      setSaved(false);
                    }}
                  >
                    {t(`aiChats.settings.tones.${opt}`)}
                  </button>
                ))}
              </div>
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
    </EntityDrawer>
  );
}

export function AiChatSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <AiChatSettingsContent onClose={onClose} />;
}
