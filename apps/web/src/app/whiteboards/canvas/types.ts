// Типы элементов, вьюпорта, инструментов и палитр для интерактивной доски

export type WbTool =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'section'
  | 'arrow'
  | 'pen';

export interface WbViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface WbBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WbSnapGuide {
  axis: 'x' | 'y';
  pos: number;
}

export interface WbSticky {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  z?: number;
}

export interface WbShape {
  id: string;
  type: 'shape';
  kind: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fill: string;
  stroke?: string;
  z?: number;
}

export interface WbText {
  id: string;
  type: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize?: number;
  color?: string;
  z?: number;
}

export interface WbSection {
  id: string;
  type: 'section';
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: string;
  z?: number;
}

export interface WbArrow {
  id: string;
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fromId?: string;
  toId?: string;
  color?: string;
  label?: string;
  z?: number;
}

export interface WbFreehand {
  id: string;
  type: 'freehand';
  points: [number, number][];
  color: string;
  width?: number;
  z?: number;
}

export type WbErpEntityType = 'task' | 'deal' | 'client' | 'contact' | 'lead';

export interface WbErpCard {
  id: string;
  type: 'erp_card';
  x: number;
  y: number;
  w: number;
  h: number;
  entityType: WbErpEntityType;
  entityId: string;
  title: string;
  subtitle?: string;
  status?: string;
  done?: boolean;
  color?: string;
  z?: number;
}

export type WbElement =
  | WbSticky
  | WbShape
  | WbText
  | WbSection
  | WbArrow
  | WbFreehand
  | WbErpCard;

// Палитры цветов в стиле Figma / Miro
export const STICKY_COLORS = [
  '#FEF08A', // лимонный
  '#FED7AA', // персиковый
  '#FECDD3', // розовый
  '#DDD6FE', // лавандовый
  '#BFDBFE', // небесный
  '#BBF7D0', // мятный
] as const;

export const SHAPE_COLORS = [
  '#FFFFFF',
  '#F1F5F9',
  '#DBEAFE',
  '#DCFCE7',
  '#FEF9C3',
  '#FCE7F3',
] as const;

export const SECTION_COLORS = [
  '#64748B', // графит
  '#3B82F6', // синий
  '#10B981', // изумрудный
  '#F59E0B', // янтарный
  '#EF4444', // коралловый
  '#8B5CF6', // фиолетовый
] as const;

export const STROKE_COLORS = [
  '#1E293B',
  '#4B5BD6',
  '#059669',
  '#D97706',
  '#DC2626',
  '#7C3AED',
] as const;
