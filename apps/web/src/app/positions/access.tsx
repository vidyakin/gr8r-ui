/* Видимость разделов меню по должностям (задача 1172): только интерфейс — права API не меняются.
   admin и owner видят всё, участник без должностей — всё, иначе объединение разделов его должностей. */
import * as React from 'react';
import { useLocation } from 'react-router';
import { Lock } from 'lucide-react';
import type { PositionSection } from '@gr8r/shared';
import { EmptyState } from '@/components/ui';
import { useT } from '@/i18n';
import { positionSectionOf, positionSectionOfPath, type SectionId } from '../routes';
import { useMyAccess } from './data';

/** Функция «виден ли раздел» (по id раздела меню, по адресу). Пока данные грузятся — всё видно, чтобы меню не мигало */
export function useSectionAccess() {
  const sections = useMyAccess().data?.sections;
  return React.useMemo(() => {
    const set = sections ? new Set<PositionSection>(sections) : null;
    const ok = (s: PositionSection | null) => !s || !set || set.has(s);
    return { section: ok, id: (id: SectionId) => ok(positionSectionOf(id)), path: (p: string) => ok(positionSectionOfPath(p)) };
  }, [sections]);
}

/** Экран «Нет доступа к разделу» вместо страницы, если её раздел скрыт должностями */
export function SectionGuard({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const access = useSectionAccess();
  const t = useT();
  if (access.path(pathname)) return <>{children}</>;
  return (
    <EmptyState icon={<Lock size={20} />} title={t('positions.noAccess.title')}>
      {t('positions.noAccess.body')}
    </EmptyState>
  );
}
