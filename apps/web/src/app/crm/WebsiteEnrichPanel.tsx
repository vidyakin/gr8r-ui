/* Панель ИИ-изучения сайта клиента + запуск генерации персонализированного письма. */
import * as React from 'react';
import { Globe, Loader2, Mail, MapPin, Save, Sparkles } from 'lucide-react';
import { Alert, Badge, Button, Field, Input, Textarea, toast } from '@/components/ui';
import { Panel } from '@/components/erp/panel';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { OutreachDraftDialog } from './OutreachDraftDialog';

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'mail.ru', 'yandex.ru', 'yandex.com', 'ya.ru',
  'bk.ru', 'list.ru', 'inbox.ru', 'icloud.com', 'outlook.com', 'hotmail.com', 'live.com',
]);

export interface AnalyzeWebsiteResult {
  fallbackNeeded: boolean;
  reason?: string;
  rawTextLength?: number;
  summary?: string;
  industry?: string;
  offerings?: string[];
  location?: string;
  potentialPains?: string[];
}

export interface WebsiteEnrichPanelProps {
  companyId?: string;
  leadId?: string;
  initialUrl?: string;
  email?: string;
  onSaveNote: (noteText: string) => void | Promise<void>;
  embedded?: boolean;
}

function suggestUrl(initialUrl?: string, email?: string): string {
  const raw = initialUrl?.trim();
  if (raw) return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const at = email?.trim().toLowerCase().split('@');
  const domain = at && at.length === 2 ? at[1] : '';
  if (domain && domain.includes('.') && !FREE_EMAIL_DOMAINS.has(domain)) return `https://${domain}`;
  return '';
}

function formatSummary(r: AnalyzeWebsiteResult, t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (r.industry || r.location) parts.push([r.industry, r.location].filter(Boolean).join(' · '));
  if (r.summary) parts.push(r.summary);
  if (r.offerings?.length) parts.push(`${t('crm.aiEnrich.offerings')}: ${r.offerings.join(', ')}`);
  if (r.potentialPains?.length) parts.push(`${t('crm.aiEnrich.pains')}:\n${r.potentialPains.map(p => `- ${p}`).join('\n')}`);
  return parts.join('\n\n');
}

export function WebsiteEnrichPanel({ companyId, leadId, initialUrl, email, onSaveNote, embedded }: WebsiteEnrichPanelProps) {
  const t = useT();
  const ws = useWsId();
  const dirtyRef = React.useRef(false);
  const [url, setUrl] = React.useState(() => suggestUrl(initialUrl, email));
  const [manualText, setManualText] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [savingNote, setSavingNote] = React.useState(false);
  const [result, setResult] = React.useState<AnalyzeWebsiteResult | null>(null);
  const [draftOpen, setDraftOpen] = React.useState(false);

  React.useEffect(() => {
    if (!dirtyRef.current) setUrl(suggestUrl(initialUrl, email));
  }, [initialUrl, email]);

  const analyze = async (manual?: string) => {
    setLoading(true);
    try {
      const res = await call<AnalyzeWebsiteResult>(ws, 'POST', '/crm/ai/analyze-website', {
        url: url.trim() || undefined,
        manualText: manual?.trim() || undefined,
        companyId: companyId || undefined,
      });
      setResult(res);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const hasInsights = !!(result && !result.fallbackNeeded && (result.summary || result.industry || result.offerings?.length || result.potentialPains?.length));
  const formattedSummary = result && hasInsights ? formatSummary(result, t) : undefined;

  const handleSaveNote = async () => {
    if (!formattedSummary) return;
    setSavingNote(true);
    try {
      await onSaveNote(formattedSummary);
      toast.success(t('crm.aiEnrich.noteSaved'));
    } finally {
      setSavingNote(false);
    }
  };

  const content = (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Input
            size="sm"
            icon={<Globe size={13} />}
            value={url}
            placeholder={t('crm.aiEnrich.urlPlaceholder')}
            aria-label={t('crm.aiEnrich.urlAria')}
            onChange={e => { dirtyRef.current = true; setUrl(e.target.value); }}
          />
        </div>
        <Button size="sm" variant="primary" disabled={loading || !url.trim()} onClick={() => void analyze()}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {loading ? t('crm.aiEnrich.analyzing') : t('crm.aiEnrich.analyze')}
        </Button>
        {!hasInsights && (
          <Button size="sm" variant="ghost" onClick={() => setDraftOpen(true)}>
            <Mail size={13} />
            {t('crm.aiEnrich.generateOutreach')}
          </Button>
        )}
      </div>

      {result?.fallbackNeeded && (
        <div className="stack" style={{ gap: 8 }}>
          <Alert tone="warn" title={t('crm.aiEnrich.fallbackTitle')}>
            {result.reason || t('crm.aiEnrich.fallbackHint')}
          </Alert>
          <Field label={t('crm.aiEnrich.manualLabel')}>
            {p => <Textarea {...p} rows={4} value={manualText} placeholder={t('crm.aiEnrich.manualPlaceholder')} onChange={e => setManualText(e.target.value)} />}
          </Field>
          <div>
            <Button size="sm" disabled={loading || !manualText.trim()} onClick={() => void analyze(manualText)}>
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {t('crm.aiEnrich.parseManual')}
            </Button>
          </div>
        </div>
      )}

      {hasInsights && result && (
        <div className="stack" style={{ gap: 8, fontSize: 13 }}>
          {(result.industry || result.location) && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {result.industry && <Badge tone="accent">{result.industry}</Badge>}
              {result.location && <Badge tone="gray"><MapPin size={11} /> {result.location}</Badge>}
            </div>
          )}
          {result.summary && <p style={{ margin: 0, lineHeight: 1.45 }}>{result.summary}</p>}
          {result.offerings && result.offerings.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="muted" style={{ fontSize: 11.5 }}>{t('crm.aiEnrich.offerings')}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {result.offerings.map((item, i) => <Badge key={i} tone="neutral">{item}</Badge>)}
              </div>
            </div>
          )}
          {result.potentialPains && result.potentialPains.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="muted" style={{ fontSize: 11.5 }}>{t('crm.aiEnrich.pains')}</span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {result.potentialPains.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
            <Button size="sm" variant="ghost" disabled={savingNote} onClick={() => void handleSaveNote()}>
              <Save size={13} />
              {t('crm.aiEnrich.saveNote')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setDraftOpen(true)}>
              <Mail size={13} />
              {t('crm.aiEnrich.generateOutreach')}
            </Button>
          </div>
        </div>
      )}

      <OutreachDraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        companyId={companyId}
        leadId={leadId}
        websiteSummary={formattedSummary}
      />
    </div>
  );

  if (embedded) {
    return (
      <div className="stack" style={{ gap: 8, padding: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--bg-2)' }}>
        <div className="row" style={{ gap: 6, fontSize: 13, fontWeight: 600 }}>
          <Sparkles size={14} />
          {t('crm.aiEnrich.title')}
        </div>
        {content}
      </div>
    );
  }

  return (
    <Panel title={t('crm.aiEnrich.title')}>
      <div className="panel-b">{content}</div>
    </Panel>
  );
}
