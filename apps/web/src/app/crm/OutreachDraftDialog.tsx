/* Модалка ИИ-генерации персонализированного первичного письма / сообщения для CRM. */
import * as React from 'react';
import { Copy, Loader2, Sparkles } from 'lucide-react';
import { Button, Dialog, DialogClose, DialogContent, Field, Input, Segmented, Textarea, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export type OutreachChannel = 'email' | 'whatsapp' | 'linkedin';
export type OutreachTone = 'friendly' | 'formal' | 'concise';

export interface OutreachDraftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId?: string;
  leadId?: string;
  websiteSummary?: string;
}

interface DraftResponse {
  subject?: string;
  body: string;
}

export function OutreachDraftDialog({ open, onOpenChange, companyId, leadId, websiteSummary }: OutreachDraftDialogProps) {
  const t = useT();
  const ws = useWsId();
  const [channel, setChannel] = React.useState<OutreachChannel>('email');
  const [tone, setTone] = React.useState<OutreachTone>('friendly');
  const [customContext, setCustomContext] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await call<DraftResponse>(ws, 'POST', '/crm/ai/draft-outreach', {
        companyId: companyId || undefined,
        leadId: leadId || undefined,
        channel,
        tone,
        websiteSummary: websiteSummary || undefined,
        customContext: customContext.trim() || undefined,
      });
      setSubject(res.subject ?? '');
      setBody(res.body ?? '');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    const text = channel === 'email' && subject.trim() ? `${subject.trim()}\n\n${body}` : body;
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('crm.aiOutreach.copied'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        title={t('crm.aiOutreach.title')}
        description={t('crm.aiOutreach.description')}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="ghost">{t('crm.aiOutreach.close')}</Button>
            </DialogClose>
            <span className="sp" />
            {body.trim() && (
              <Button variant="ghost" onClick={() => void handleCopy()}>
                <Copy size={14} />
                {t('crm.aiOutreach.copy')}
              </Button>
            )}
            <Button variant="primary" disabled={loading} onClick={() => void handleGenerate()}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {loading ? t('crm.aiOutreach.generating') : t('crm.aiOutreach.generate')}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="stack" style={{ gap: 4 }}>
              <span className="muted" style={{ fontSize: 12 }}>{t('crm.aiOutreach.channel')}</span>
              <Segmented<OutreachChannel>
                value={channel}
                onValueChange={setChannel}
                aria-label={t('crm.aiOutreach.channel')}
                items={[
                  { value: 'email', label: t('crm.aiOutreach.channels.email') },
                  { value: 'whatsapp', label: t('crm.aiOutreach.channels.whatsapp') },
                  { value: 'linkedin', label: t('crm.aiOutreach.channels.linkedin') },
                ]}
              />
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="muted" style={{ fontSize: 12 }}>{t('crm.aiOutreach.tone')}</span>
              <Segmented<OutreachTone>
                value={tone}
                onValueChange={setTone}
                aria-label={t('crm.aiOutreach.tone')}
                items={[
                  { value: 'friendly', label: t('crm.aiOutreach.tones.friendly') },
                  { value: 'formal', label: t('crm.aiOutreach.tones.formal') },
                  { value: 'concise', label: t('crm.aiOutreach.tones.concise') },
                ]}
              />
            </div>
          </div>

          <Field label={t('crm.aiOutreach.customContext')}>
            {p => (
              <Input
                {...p}
                value={customContext}
                onChange={e => setCustomContext(e.target.value)}
                placeholder={t('crm.aiOutreach.customContextPlaceholder')}
                maxLength={500}
              />
            )}
          </Field>

          {channel === 'email' && (
            <Field label={t('crm.aiOutreach.subject')}>
              {p => <Input {...p} value={subject} onChange={e => setSubject(e.target.value)} />}
            </Field>
          )}

          <Field label={t('crm.aiOutreach.body')}>
            {p => <Textarea {...p} rows={7} value={body} onChange={e => setBody(e.target.value)} />}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
