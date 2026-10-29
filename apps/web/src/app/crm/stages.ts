/* Справочники CRM: этапы воронки, типы активностей, отрасли, размеры компаний, причины проигрыша */
import { CircleCheck, Mail, Phone, StickyNote, Users, type LucideIcon } from 'lucide-react';
import type { ActivityType, StageId } from './types';

/** Этап воронки для интерфейса: p — доля вероятности 0..1, c — цвет (css-переменная) */
export interface StageDef {
  id: StageId;
  pipelineId: string;
  name: string;
  p: number;
  c: string;
  category: 'in_progress' | 'won' | 'lost';
  sort: number;
  slaDays: number | null;
  required: string[];
}

/** Реестр этапов выбранного воркспейса (задача 1176): CrmProvider выставляет его синхронно с загрузкой данных, до отрисовки детей —
    поэтому чистые выборки (selectors.ts) и компоненты читают этапы без передачи через props. Этапы приходят с сервера. */
let REGISTRY = new Map<StageId, StageDef>();
let ORDERED: StageDef[] = [];

export function setStageRegistry(list: StageDef[]) {
  ORDERED = [...list].sort((a, b) => a.sort - b.sort);
  REGISTRY = new Map(ORDERED.map(s => [s.id, s]));
}

const UNKNOWN: StageDef = { id: '', pipelineId: '', name: '—', p: 0, c: 'var(--gray)', category: 'in_progress', sort: 0, slaDays: null, required: [] };
export const stage = (id: StageId): StageDef => REGISTRY.get(id) ?? UNKNOWN;
export const isOpen = (id: StageId) => stage(id).category === 'in_progress';
/** Этапы воронки по порядку */
export const stagesOf = (pipelineId: string) => ORDERED.filter(s => s.pipelineId === pipelineId);
export const openStagesOf = (pipelineId: string) => stagesOf(pipelineId).filter(s => s.category === 'in_progress');
export const colorVar = (color: string) => `var(--${color})`;

export const ACTIVITY_TYPES: { id: ActivityType; name: string; plural: string; verb: string; icon: LucideIcon }[] = [
  { id: 'call', name: 'Call', plural: 'Calls', verb: 'logged a call', icon: Phone },
  { id: 'email', name: 'Email', plural: 'Emails', verb: 'sent an email', icon: Mail },
  { id: 'meeting', name: 'Meeting', plural: 'Meetings', verb: 'held a meeting', icon: Users },
  { id: 'note', name: 'Note', plural: 'Notes', verb: 'added a note', icon: StickyNote },
  { id: 'task', name: 'Follow-up', plural: 'Follow-ups', verb: 'scheduled a follow-up', icon: CircleCheck },
];
export const activityType = (id: ActivityType) => ACTIVITY_TYPES.find(t => t.id === id)!;

export const INDUSTRIES = ['Logistics', 'Energy', 'Healthcare', 'Retail', 'Fintech', 'Media', 'Food & Beverage', 'Manufacturing', 'Education', 'Real Estate', 'Software', 'Travel'];
export const SIZES = ['1–10', '11–50', '51–200', '201–1000', '1000+'];
