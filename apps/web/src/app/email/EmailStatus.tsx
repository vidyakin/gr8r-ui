/* Статус письма в ленте касаний: в очереди, отправляется, отправлено, ошибка (с причиной и «Повторить»). Задача 1092. */
import { Badge, Button, toast } from '@/components/ui';
import { useT, type TKey } from '@/i18n';
import { useEmailApi, type EmailMessage } from './data';

export function EmailStatus({ email }: { email: EmailMessage | undefined }) {
  const t = useT();
  const api = useEmailApi();
  if (!email) return null;
  return (
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
      <Badge>{t(`email.status.${email.status}` as TKey)}</Badge>
      <span className="faint" style={{ fontSize: 12 }}>{t('email.to', { to: email.to.join(', ') })}</span>
      {email.lastError && email.status !== 'sent' && <span className="faint" style={{ fontSize: 12 }}>{email.lastError}</span>}
      {email.status === 'failed' && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void (async () => {
              if (await api('POST', `/emails/${email.id}/retry`)) toast(t('email.retried'));
            })();
          }}
        >
          {t('email.retry')}
        </Button>
      )}
    </div>
  );
}
