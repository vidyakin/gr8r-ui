/* Данные интерактивных досок: запросы TanStack Query, мутации и адаптер элементов холста под API-схему */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WhiteboardElement } from '@erp/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import type { WbElement, WbViewport } from './canvas/types';

export type WhiteboardEntityType = 'project' | 'deal' | 'company';

export interface WhiteboardSummary {
  id: string;
  title: string;
  entityType: WhiteboardEntityType | null;
  entityId: string | null;
  elementCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhiteboardDetail {
  id: string;
  title: string;
  entityType: WhiteboardEntityType | null;
  entityId: string | null;
  elements: WbElement[];
  viewport: WbViewport;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawWhiteboardDetail extends Omit<WhiteboardDetail, 'elements'> {
  elements: unknown[];
}

export const whiteboardsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'whiteboards', ...rest] as const;

export function toApiElement(el: WbElement): WhiteboardElement {
  const zIndex = el.z ?? 0;
  switch (el.type) {
    case 'sticky':
      return { id: el.id, type: 'sticky', x: el.x, y: el.y, w: el.w, h: el.h, text: el.text, color: el.color, zIndex };
    case 'shape':
      return { id: el.id, type: 'shape', x: el.x, y: el.y, w: el.w, h: el.h, shape: el.kind, text: el.text ?? '', fill: el.fill, stroke: el.stroke ?? '#94a3b8', zIndex };
    case 'text':
      return { id: el.id, type: 'text', x: el.x, y: el.y, w: el.w, h: el.h, text: el.text, fontSize: el.fontSize ?? 18, color: el.color ?? '#1e293b', zIndex };
    case 'section':
      return { id: el.id, type: 'section', x: el.x, y: el.y, w: el.w, h: el.h, title: el.title, color: el.color, zIndex };
    case 'arrow':
      return { id: el.id, type: 'arrow', fromId: el.fromId ?? null, toId: el.toId ?? null, x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, label: el.label ?? '', color: el.color ?? '#475569', zIndex };
    case 'freehand':
      return { id: el.id, type: 'freehand', points: el.points.slice(0, 2000), color: el.color, strokeWidth: el.width ?? 2.5, zIndex };
    case 'erp_card':
      return {
        id: el.id,
        type: 'erp_card',
        x: el.x,
        y: el.y,
        w: el.w,
        h: el.h,
        entityType: el.entityType === 'client' ? 'company' : el.entityType,
        entityId: el.entityId,
        title: el.title.slice(0, 240),
        ...(el.subtitle ? { subtitle: el.subtitle.slice(0, 240) } : {}),
        ...(el.status ? { status: el.status.slice(0, 80) } : {}),
        ...(el.done !== undefined ? { done: el.done } : {}),
        zIndex,
      };
  }
}

export function fromApiElement(raw: Record<string, unknown>): WbElement {
  const z = typeof raw.z === 'number' ? raw.z : typeof raw.zIndex === 'number' ? raw.zIndex : 0;
  switch (raw.type) {
    case 'sticky':
      return { id: String(raw.id), type: 'sticky', x: Number(raw.x), y: Number(raw.y), w: Number(raw.w), h: Number(raw.h), text: String(raw.text ?? ''), color: String(raw.color ?? '#FEF08A'), z };
    case 'shape':
      return { id: String(raw.id), type: 'shape', kind: raw.kind === 'ellipse' || raw.shape === 'ellipse' ? 'ellipse' : 'rect', x: Number(raw.x), y: Number(raw.y), w: Number(raw.w), h: Number(raw.h), text: raw.text ? String(raw.text) : '', fill: String(raw.fill ?? '#FFFFFF'), stroke: raw.stroke ? String(raw.stroke) : undefined, z };
    case 'text':
      return { id: String(raw.id), type: 'text', x: Number(raw.x), y: Number(raw.y), w: Number(raw.w), h: Number(raw.h), text: String(raw.text ?? ''), fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : 18, color: raw.color ? String(raw.color) : undefined, z };
    case 'section':
      return { id: String(raw.id), type: 'section', x: Number(raw.x), y: Number(raw.y), w: Number(raw.w), h: Number(raw.h), title: String(raw.title ?? ''), color: String(raw.color ?? '#64748B'), z };
    case 'arrow':
      return { id: String(raw.id), type: 'arrow', x1: Number(raw.x1), y1: Number(raw.y1), x2: Number(raw.x2), y2: Number(raw.y2), fromId: raw.fromId ? String(raw.fromId) : undefined, toId: raw.toId ? String(raw.toId) : undefined, color: raw.color ? String(raw.color) : undefined, label: raw.label ? String(raw.label) : undefined, z };
    case 'freehand':
      return { id: String(raw.id), type: 'freehand', points: Array.isArray(raw.points) ? (raw.points as [number, number][]) : [], color: String(raw.color ?? '#1e293b'), width: typeof raw.width === 'number' ? raw.width : typeof raw.strokeWidth === 'number' ? raw.strokeWidth : 2.5, z };
    default:
      return {
        id: String(raw.id),
        type: 'erp_card',
        x: Number(raw.x),
        y: Number(raw.y),
        w: Number(raw.w),
        h: Number(raw.h),
        entityType: raw.entityType === 'company' ? 'client' : (raw.entityType as 'task' | 'deal' | 'client' | 'contact' | 'lead'),
        entityId: String(raw.entityId),
        title: String(raw.title ?? ''),
        subtitle: raw.subtitle ? String(raw.subtitle) : undefined,
        status: raw.status ? String(raw.status) : undefined,
        done: typeof raw.done === 'boolean' ? raw.done : undefined,
        z,
      };
  }
}

const normalizeDetail = (row: RawWhiteboardDetail): WhiteboardDetail => ({
  ...row,
  elements: Array.isArray(row.elements) ? row.elements.map(el => fromApiElement(el as Record<string, unknown>)) : [],
});

export function useWhiteboards(q?: string) {
  const ws = useWsId();
  const trimmed = q?.trim() || undefined;
  return useQuery({
    queryKey: whiteboardsKey(ws, 'list', trimmed ?? ''),
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (trimmed) sp.set('q', trimmed);
      const qs = sp.toString();
      return (await call<{ items: WhiteboardSummary[] }>(ws, 'GET', `/whiteboards${qs ? `?${qs}` : ''}`)).items;
    },
    staleTime: Infinity,
  });
}

export function useWhiteboard(id: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: whiteboardsKey(ws, 'detail', id),
    queryFn: async () => normalizeDetail(await call<RawWhiteboardDetail>(ws, 'GET', `/whiteboards/${id}`)),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export interface WhiteboardCreateInput {
  title: string;
  entityType?: WhiteboardEntityType | null;
  entityId?: string | null;
  elements?: WbElement[];
  viewport?: WbViewport;
}

export interface WhiteboardUpdateInput {
  title?: string;
  entityType?: WhiteboardEntityType | null;
  entityId?: string | null;
  elements?: WbElement[];
  viewport?: WbViewport;
}

export function useWhiteboardsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: whiteboardsKey(ws) });
  const run = <T,>(fn: () => Promise<T>, quiet = false) =>
    fn().then(
      async r => {
        await invalidate();
        return r;
      },
      (e: unknown) => {
        if (!quiet) toast.error(errorMessage(e));
        throw e;
      },
    );

  return {
    create: (body: WhiteboardCreateInput) =>
      run(async () => {
        const payload = { ...body, ...(body.elements ? { elements: body.elements.map(toApiElement) } : {}) };
        return normalizeDetail(await call<RawWhiteboardDetail>(ws, 'POST', '/whiteboards', payload));
      }),
    update: (id: string, body: WhiteboardUpdateInput, quiet = false) =>
      run(async () => {
        const payload = { ...body, ...(body.elements ? { elements: body.elements.map(toApiElement) } : {}) };
        return normalizeDetail(await call<RawWhiteboardDetail>(ws, 'PATCH', `/whiteboards/${id}`, payload));
      }, quiet),
    remove: (id: string) => run(() => call<{ ok: true }>(ws, 'DELETE', `/whiteboards/${id}`)),
  };
}
