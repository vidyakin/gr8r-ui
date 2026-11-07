/* «Что нового»: журнал доработок docs/changelog.md по дням с фильтром по модулю. Файл грузится лениво (не в основной чанк);
   записи — только по-русски, как статьи справки. Открывается из меню «Помощь и материалы». */
import * as React from 'react';
import { Newspaper } from 'lucide-react';
import { Alert, Badge, Select } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTimeIntl } from '@/i18n/format';
import { codeParts, parseChangelog, type ChangelogDay } from './parse';

const ALL = 'all';

function useChangelog() {
  const [st, setSt] = React.useState<{ days: ChangelogDay[] | null; error: boolean }>({ days: null, error: false });
  React.useEffect(() => {
    let alive = true;
    import('../../../../../docs/changelog.md?raw')
      .then(m => alive && setSt({ days: parseChangelog(m.default), error: false }))
      .catch(() => alive && setSt({ days: null, error: true }));
    return () => {
      alive = false;
    };
  }, []);
  return st;
}

export function ChangelogPage() {
  const t = useT();
  const { days, error } = useChangelog();
  const [module, setModule] = React.useState(ALL);
  // модули из записей: «Каталог и Производство» считается за оба
  const split = (m: string) => m.split(/\s+и\s+/).map(s => s.trim());
  const modules = React.useMemo(() => [...new Set((days ?? []).flatMap(d => d.items.flatMap(i => split(i.module))))].sort((a, b) => a.localeCompare(b, 'ru')), [days]);
  const shown = React.useMemo(
    () => (days ?? []).map(d => ({ ...d, items: module === ALL ? d.items : d.items.filter(i => split(i.module).includes(module)) })).filter(d => d.items.length),
    [days, module],
  );
  const date = (iso: string) => fmtDateTimeIntl(`${iso}T12:00:00`, { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="ph">
        <div>
          <h1 className="row" style={{ gap: 10 }}>
            <Newspaper size={20} />
            {t('help.whatsNew.title')}
          </h1>
          <p>{t('help.whatsNew.lead')}</p>
        </div>
        <div className="acts">
          <Select
            size="sm"
            value={module}
            onValueChange={setModule}
            aria-label={t('help.whatsNew.allModules')}
            options={[{ value: ALL, label: t('help.whatsNew.allModules') }, ...modules.map(m => ({ value: m, label: m }))]}
          />
        </div>
      </div>
      {error && <Alert tone="danger">{t('help.whatsNew.loadError')}</Alert>}
      <div className="stack" style={{ gap: 24 }}>
        {shown.map(d => (
          <section key={d.date}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px' }}>{date(d.date)}</h2>
            <ul className="stack" style={{ gap: 10, listStyle: 'none', padding: 0, margin: 0 }}>
              {d.items.map((i, n) => (
                <li key={n} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ flex: '0 0 150px' }}>
                    <Badge>{i.module}</Badge>
                  </span>
                  <span style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>
                    {codeParts(i.text.charAt(0).toUpperCase() + i.text.slice(1)).map((p, k) => (p.code ? <code key={k}>{p.s}</code> : <React.Fragment key={k}>{p.s}</React.Fragment>))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
