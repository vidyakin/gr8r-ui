/* Оформление узлов: иконки по имени из описания узла, цвета категорий, краткое описание параметров для карточки на холсте. */
import {
  Bell,
  CirclePlus,
  Clock,
  GitFork,
  Globe,
  ListPlus,
  MessageSquarePlus,
  Pencil,
  PencilLine,
  Play,
  Split,
  SquarePen,
  Timer,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AnyNodeDef, NodeCategory } from '@gr8r/shared';
import { nodeParamsJsonSchema } from '@gr8r/shared';

/** Иконки узлов: имя из `icon` описания узла (kebab-case lucide). Неизвестное имя — молния */
const ICONS: Record<string, LucideIcon> = {
  'plus-circle': CirclePlus,
  pencil: Pencil,
  'pencil-line': PencilLine,
  clock: Clock,
  play: Play,
  split: Split,
  timer: Timer,
  'git-fork': GitFork,
  'square-pen': SquarePen,
  'list-plus': ListPlus,
  bell: Bell,
  globe: Globe,
  'message-square-plus': MessageSquarePlus,
};

export function NodeIcon({ name, size = 14 }: { name: string; size?: number }) {
  const I = ICONS[name] ?? Zap;
  return <I size={size} />;
}

/** Цвет категории — токен приложения */
export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  trigger: 'var(--violet)',
  condition: 'var(--amber)',
  flow: 'var(--teal)',
  action: 'var(--blue)',
};

type Prop = { title?: string; type?: string; ui?: string };

/** До двух значимых параметров для карточки: «Entity: task», «Field: status» */
export function paramSummary(def: AnyNodeDef, params: Record<string, unknown>): string[] {
  const props = ((nodeParamsJsonSchema(def).properties ?? {}) as Record<string, Prop>);
  const out: string[] = [];
  for (const [k, p] of Object.entries(props)) {
    const v = params[k];
    if ((typeof v !== 'string' && typeof v !== 'number') || v === '') continue;
    if (p.ui === 'textarea' && typeof v === 'string' && v.includes('\n')) continue;
    out.push(`${k}: ${String(v).replace(/\s+/g, ' ').slice(0, 34)}`);
    if (out.length === 2) break;
  }
  return out;
}

export const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
