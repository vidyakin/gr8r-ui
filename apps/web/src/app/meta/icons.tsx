/* Значки сущностей: в метаданных хранится имя (строка), здесь — таблица «имя → компонент lucide». */
import { Book, Box, Briefcase, Building, Database, Factory, FileText, Globe, Heart, Landmark, Package, ShoppingCart, Star, Tag, Truck, Users, Wrench, type LucideIcon } from 'lucide-react';

export const ENTITY_ICONS: Record<string, LucideIcon> = {
  database: Database,
  truck: Truck,
  package: Package,
  box: Box,
  users: Users,
  building: Building,
  factory: Factory,
  wrench: Wrench,
  book: Book,
  briefcase: Briefcase,
  tag: Tag,
  star: Star,
  heart: Heart,
  globe: Globe,
  'file-text': FileText,
  'shopping-cart': ShoppingCart,
  landmark: Landmark,
};

export const ENTITY_ICON_NAMES = Object.keys(ENTITY_ICONS);

export const entityIcon = (name: string | undefined): LucideIcon => ENTITY_ICONS[name ?? ''] ?? Database;
