/* Видимость разделов меню по должностям (задача 1172): только интерфейс — права API не меняются.
   admin и owner видят всё, участник без должностей — всё, иначе объединение разделов его должностей. */
import * as React from 'react';
import { useLocation } from 'react-router';
import { Lock } from 'lucide-react';
import { MODULE_OF_SECTION, moduleOfSectionPath, type ModuleId, type PositionSection } from '@gr8r/shared';
import { EmptyState } from '@/components/ui';
import { useT } from '@/i18n';
import { positionSectionOf, positionSectionOfPath, SECTIONS, type SectionId } from '../routes';
import { useLicense } from '../licensing/data';
import { useMyAccess } from './data';

const SECTION_PATHS: Record<string, string> = Object.fromEntries(Object.entries(SECTIONS).map(([id, s]) => [id, s.path]));

/** Функция «виден ли раздел» (по id раздела меню, по адресу): должности И модули тарифа (docs/architecture/licensing.md).
    Пока данные грузятся — всё видно, чтобы меню не мигало */
export function useSectionAccess() {
  const sections = useMyAccess().data?.sections;
  const modules = useLicense().data?.modules;
  return React.useMemo(() => {
    const set = sections ? new Set<PositionSection>(sections) : null;
    const mods = modules ? new Set<ModuleId>(modules) : null;
    const ok = (s: PositionSection | null) => !s || !set || set.has(s);
    const moduleOk = (m: ModuleId | null | undefined) => !m || !mods || mods.has(m);
    return {
      section: ok,
      id: (id: SectionId) => ok(positionSectionOf(id)) && moduleOk(MODULE_OF_SECTION.get(id)),
      path: (p: string) => ok(positionSectionOfPath(p)) && moduleOk(moduleOfSectionPath(p, SECTION_PATHS)),
      /** Модуль включён (или набор ещё не загружен) */
      module: moduleOk,
      /** Модуль адреса (для экрана «Модуль не подключён») */
      pathModule: (p: string) => moduleOfSectionPath(p, SECTION_PATHS),
    };
  }, [sections, modules]);
}

/** Экран «Нет доступа к разделу» вместо страницы, если её раздел скрыт должностями */
export function SectionGuard({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const access = useSectionAccess();
  const t = useT();
  if (access.path(pathname)) return <>{children}</>;
  const module = access.pathModule(pathname);
  if (module && !access.module(module))
    return (
      <EmptyState icon={<Lock size={20} />} title={t('licensing.disabled.title')}>
        {t('licensing.disabled.body', { module: t(`licensing.modules.${module}.name` as const) })}
      </EmptyState>
    );
  return (
    <EmptyState icon={<Lock size={20} />} title={t('positions.noAccess.title')}>
      {t('positions.noAccess.body')}
    </EmptyState>
  );
}
