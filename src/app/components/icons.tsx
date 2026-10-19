/* В данных иконки проектов и команд хранятся строкой (как в оригинале).
   Здесь — явная таблица «имя → компонент», чтобы в бандл попадали только используемые иконки. */
import {
  Briefcase,
  Building2,
  Code,
  Component,
  Folder,
  Globe,
  Heart,
  Layers,
  LayoutGrid,
  Megaphone,
  Palette,
  Rocket,
  Smartphone,
  Target,
  Users,
  Zap,
  type LucideProps,
} from 'lucide-react';

const ICONS: Record<string, React.ComponentType<LucideProps>> = {
  globe: Globe,
  smartphone: Smartphone,
  megaphone: Megaphone,
  rocket: Rocket,
  component: Component,
  'building-2': Building2,
  'layout-grid': LayoutGrid,
  palette: Palette,
  code: Code,
  briefcase: Briefcase,
  target: Target,
  layers: Layers,
  zap: Zap,
  heart: Heart,
  users: Users,
};

export function NamedIcon({ name, ...props }: { name: string } & LucideProps) {
  const I = ICONS[name] ?? Folder;
  return <I {...props} />;
}
