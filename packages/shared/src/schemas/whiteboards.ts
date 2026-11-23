/* zod-схемы интерактивных досок (whiteboards): элементы холста, вьюпорт, создание и обновление доски. */
import { z } from 'zod';

const basePos = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  zIndex: z.number(),
};

export const whiteboardElementSchema = z.discriminatedUnion('type', [
  z.object({
    ...basePos,
    type: z.literal('sticky'),
    text: z.string(),
    color: z.string(),
  }),
  z.object({
    ...basePos,
    type: z.literal('shape'),
    shape: z.enum(['rect', 'rounded', 'ellipse', 'diamond']),
    text: z.string(),
    fill: z.string(),
    stroke: z.string(),
  }),
  z.object({
    ...basePos,
    type: z.literal('text'),
    text: z.string(),
    fontSize: z.number(),
    color: z.string(),
  }),
  z.object({
    ...basePos,
    type: z.literal('section'),
    title: z.string(),
    color: z.string(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('arrow'),
    fromId: z.string().nullable().optional(),
    toId: z.string().nullable().optional(),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    label: z.string(),
    color: z.string(),
    zIndex: z.number(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('freehand'),
    points: z.array(z.tuple([z.number(), z.number()])).max(2000),
    color: z.string(),
    strokeWidth: z.number(),
    zIndex: z.number(),
  }),
  z.object({
    ...basePos,
    type: z.literal('erp_card'),
    entityType: z.enum(['task', 'deal', 'company', 'contact', 'lead']),
    entityId: z.string(),
    title: z.string().max(240),
    subtitle: z.string().max(240).optional(),
    status: z.string().max(80).optional(),
    done: z.boolean().optional(),
  }),
]);

export const whiteboardViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().min(0.1).max(4),
});

export const whiteboardCreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  entityType: z.enum(['project', 'deal', 'company']).nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  elements: z.array(whiteboardElementSchema).max(500).optional(),
  viewport: whiteboardViewportSchema.optional(),
});

export const whiteboardPatchBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  entityType: z.enum(['project', 'deal', 'company']).nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  elements: z.array(whiteboardElementSchema).max(500).optional(),
  viewport: whiteboardViewportSchema.optional(),
});

export type WhiteboardElement = z.infer<typeof whiteboardElementSchema>;
export type WhiteboardViewport = z.infer<typeof whiteboardViewportSchema>;
export type WhiteboardCreateBody = z.infer<typeof whiteboardCreateBody>;
export type WhiteboardPatchBody = z.infer<typeof whiteboardPatchBody>;
