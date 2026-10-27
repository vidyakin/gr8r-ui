/* Следующий контакт с клиентом (задача 1133): дата и заметка в карточке компании. Дату ставит продажа по сроку повтора товара,
   в этот день воркер создаёт дело ответственному и очищает поле. Правит любой участник. */
import * as React from 'react';
import { Input } from '@/components/ui';
import { Panel } from '@/components/gr8r/panel';
import { useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useCrm } from './store';
import type { Company } from './types';

export function NextContactPanel({ company: co }: { company: Company }) {
  const t = useT();
  const { dispatch } = useCrm();
  const [note, setNote] = React.useState(co.nextContactNote ?? '');
  React.useEffect(() => setNote(co.nextContactNote ?? ''), [co.nextContactNote]);
  return (
    <Panel title={t('repeat.nextContact.title')}>
      <div className="panel-b stack" style={{ gap: 8 }}>
        <label className="field" style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {t('repeat.nextContact.date')}
            {co.nextContactDate ? ` · ${fmtDate(co.nextContactDate, true)}` : ` · ${t('repeat.nextContact.none')}`}
          </span>
          <Input type="date" value={co.nextContactDate ?? ''} onChange={e => dispatch({ type: 'company/update', id: co.id, patch: { nextContactDate: e.target.value } })} aria-label={t('repeat.nextContact.date')} />
        </label>
        <label className="field" style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('repeat.nextContact.note')}</span>
          <Input
            value={note}
            placeholder={t('repeat.nextContact.notePlaceholder')}
            maxLength={500}
            onChange={e => setNote(e.target.value)}
            onBlur={() => note !== (co.nextContactNote ?? '') && dispatch({ type: 'company/update', id: co.id, patch: { nextContactNote: note } })}
            aria-label={t('repeat.nextContact.note')}
          />
        </label>
        <p className="faint" style={{ margin: 0, fontSize: 12 }}>{t('repeat.nextContact.hint')}</p>
      </div>
    </Panel>
  );
}
