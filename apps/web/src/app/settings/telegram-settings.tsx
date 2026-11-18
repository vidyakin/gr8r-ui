/* Settings → Integrations: токен бота Telegram (секрет `telegram.bot_token`, docs/architecture/secrets.md).
   Значение вводится один раз и не показывается; «Проверить» вызывает getMe на сервере. Только admin и owner. */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TELEGRAM_TOKEN_SECRET } from '@erp/shared';
import { Badge, Button, ConfirmDialog, Field, Input, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { SRow } from './parts';

export function TelegramSettings({ isSet, available }: { isSet: boolean; available: boolean }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [del, setDel] = React.useState(false);

  const run = async <T,>(method: string, path: string, body?: unknown): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await call<T>(ws, method, path, body);
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'secrets'] });
      return r;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sblock">
      <h2 style={{ margin: '0 0 8px' }}>{t('secrets.telegram.title')}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{t('secrets.telegram.lead')}</p>
      <div className="srow" style={{ display: 'block' }}>
        <SRow t={<>{t('secrets.telegram.status')} <Badge>{isSet ? t('secrets.telegram.set') : t('secrets.telegram.notSet')}</Badge></>}>
          {isSet && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                const r = await run<{ username: string; name: string }>('POST', '/secrets/telegram/check');
                if (r) toast(t('secrets.telegram.checkOk', { name: r.username ? `@${r.username}` : r.name }));
              }}
            >
              {t('secrets.telegram.check')}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={!available} onClick={() => setEditing(e => !e)}>{isSet ? t('secrets.telegram.replace') : t('secrets.telegram.save')}</Button>
          {isSet && <Button size="sm" variant="ghost" onClick={() => setDel(true)}>{t('secrets.telegram.delete')}</Button>}
        </SRow>
        {editing && (
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
            <Field label={t('secrets.telegram.token')}>{p => <Input {...p} type="password" autoComplete="new-password" maxLength={200} value={value} onChange={e => setValue(e.target.value.trim())} />}</Field>
            <Button
              size="sm"
              disabled={!value || busy}
              onClick={async () => {
                if (await run('PUT', `/secrets/${TELEGRAM_TOKEN_SECRET}`, { value })) {
                  toast(t('secrets.telegram.saved'));
                  setValue('');
                  setEditing(false);
                }
              }}
            >
              {t('secrets.telegram.save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setValue(''); setEditing(false); }}>{t('secrets.cancel')}</Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={del}
        onOpenChange={setDel}
        title={t('secrets.telegram.delete')}
        description={t('secrets.telegram.confirmDelete')}
        confirmLabel={t('secrets.telegram.delete')}
        cancelLabel={t('secrets.cancel')}
        danger
        onConfirm={async () => {
          if (await run('DELETE', `/secrets/${TELEGRAM_TOKEN_SECRET}`)) toast(t('secrets.telegram.deleted'));
          setDel(false);
        }}
      />
    </div>
  );
}
