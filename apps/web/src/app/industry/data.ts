/* Отраслевые опции воркспейса во фронтенде (задача 1258, docs/architecture/industry-options.md).
   Набор приходит с GET /workspaces (сессия, ключ ['session']); событие workspace.updated сбрасывает его через realtime.
   Пока список моих воркспейсов грузится, все опции считаются включёнными — чтобы меню и карточки не мигали.
   Это только вид интерфейса: API, правила проведения и данные от опций не зависят. */
import { hasIndustry, type IndustryOption } from '@gr8r/shared';
import { useSession } from '../data/session';
import { SECTIONS, type SectionId } from '../routes';

/** Раздел меню → опция, без которой он скрыт (вкладка «Партии» нужна пищевому производству) */
export const INDUSTRY_OF_SECTION: Partial<Record<SectionId, IndustryOption>> = { batches: 'food', objects: 'construction' };

/** Включённые опции воркспейса; null — ещё не загружены (тогда показываем всё) */
export function useEnabledIndustries(): Set<IndustryOption> | null {
  const industries = useSession().active?.industryOptions;
  return industries ? new Set(industries) : null;
}

/** Включена ли отраслевая опция (пока набор не загружен — true) */
export function useIndustry(option: IndustryOption): boolean {
  const industries = useEnabledIndustries();
  return !industries || industries.has(option);
}

/** Опция, скрывающая раздел меню (нет — раздел от опций не зависит) */
export const industryOfSection = (id: SectionId): IndustryOption | null => INDUSTRY_OF_SECTION[id] ?? null;

/** Опция, скрывающая страницу по адресу: берём самый длинный подходящий путь раздела */
export function industryOfPath(pathname: string): IndustryOption | null {
  let best: IndustryOption | null = null;
  let len = -1;
  for (const [id, option] of Object.entries(INDUSTRY_OF_SECTION) as [SectionId, IndustryOption][]) {
    const path = SECTIONS[id].path;
    if (path.length > len && (pathname === path || pathname.startsWith(`${path}/`))) [best, len] = [option, path.length];
  }
  return best;
}

export { hasIndustry };
