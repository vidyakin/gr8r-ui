import { describe, expect, test } from 'bun:test';
import { whiteboardCreateBody, whiteboardElementSchema, whiteboardPatchBody, whiteboardViewportSchema } from '@erp/shared';

const VALID_UUID = '01950000-0000-7000-8000-000000000001';

describe('whiteboardElementSchema', () => {
  test('accepts sticky element', () => {
    const parsed = whiteboardElementSchema.parse({
      id: 'el-sticky',
      type: 'sticky',
      x: 10,
      y: 20,
      w: 200,
      h: 150,
      text: 'Idea',
      color: '#FEF08A',
      zIndex: 1,
    });
    expect(parsed.type).toBe('sticky');
  });

  test('accepts shape element variants', () => {
    for (const shape of ['rect', 'rounded', 'ellipse', 'diamond'] as const) {
      const parsed = whiteboardElementSchema.parse({
        id: `el-${shape}`,
        type: 'shape',
        shape,
        x: 0,
        y: 0,
        w: 120,
        h: 80,
        text: 'Box',
        fill: '#ffffff',
        stroke: '#111111',
        zIndex: 2,
      });
      expect(parsed.type).toBe('shape');
    }
    expect(() =>
      whiteboardElementSchema.parse({
        id: 'el-bad-shape',
        type: 'shape',
        shape: 'triangle',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        text: '',
        fill: '#fff',
        stroke: '#000',
        zIndex: 1,
      }),
    ).toThrow();
  });

  test('accepts text element', () => {
    const parsed = whiteboardElementSchema.parse({
      id: 'el-text',
      type: 'text',
      x: 50,
      y: 60,
      w: 300,
      h: 40,
      text: 'Heading',
      fontSize: 24,
      color: '#111827',
      zIndex: 3,
    });
    expect(parsed.type).toBe('text');
  });

  test('accepts section element', () => {
    const parsed = whiteboardElementSchema.parse({
      id: 'el-section',
      type: 'section',
      x: -100,
      y: -50,
      w: 600,
      h: 400,
      title: 'Discovery',
      color: '#E0F2FE',
      zIndex: 0,
    });
    expect(parsed.type).toBe('section');
  });

  test('accepts arrow element with optional/nullable endpoints', () => {
    const parsed = whiteboardElementSchema.parse({
      id: 'el-arrow',
      type: 'arrow',
      fromId: 'el-sticky',
      toId: null,
      x1: 100,
      y1: 100,
      x2: 250,
      y2: 200,
      label: 'leads to',
      color: '#4B5563',
      zIndex: 4,
    });
    expect(parsed.type).toBe('arrow');

    const detached = whiteboardElementSchema.parse({
      id: 'el-arrow-2',
      type: 'arrow',
      x1: 0,
      y1: 0,
      x2: 10,
      y2: 10,
      label: '',
      color: '#000',
      zIndex: 4,
    });
    expect(detached.type).toBe('arrow');
  });

  test('accepts freehand element and enforces max 2000 points', () => {
    const parsed = whiteboardElementSchema.parse({
      id: 'el-free',
      type: 'freehand',
      points: [
        [0, 0],
        [10, 15],
        [20, 25],
      ],
      color: '#EF4444',
      strokeWidth: 3,
      zIndex: 5,
    });
    expect(parsed.type).toBe('freehand');

    const tooManyPoints = Array.from({ length: 2001 }, (_, i) => [i, i] as [number, number]);
    expect(() =>
      whiteboardElementSchema.parse({
        id: 'el-free-too-many',
        type: 'freehand',
        points: tooManyPoints,
        color: '#EF4444',
        strokeWidth: 3,
        zIndex: 5,
      }),
    ).toThrow();
  });

  test('accepts erp_card element variants and rejects invalid fields', () => {
    for (const entityType of ['task', 'deal', 'company', 'contact', 'lead'] as const) {
      const parsed = whiteboardElementSchema.parse({
        id: `el-card-${entityType}`,
        type: 'erp_card',
        entityType,
        entityId: VALID_UUID,
        title: 'Card title',
        subtitle: 'Subtitle',
        status: 'open',
        done: false,
        x: 10,
        y: 10,
        w: 240,
        h: 100,
        zIndex: 6,
      });
      expect(parsed.type).toBe('erp_card');
    }

    expect(() =>
      whiteboardElementSchema.parse({
        id: 'el-card-bad',
        type: 'erp_card',
        entityType: 'invoice',
        entityId: VALID_UUID,
        title: 'Invalid',
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        zIndex: 1,
      }),
    ).toThrow();

    expect(() =>
      whiteboardElementSchema.parse({
        id: 'el-card-long-title',
        type: 'erp_card',
        entityType: 'task',
        entityId: VALID_UUID,
        title: 'x'.repeat(241),
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        zIndex: 1,
      }),
    ).toThrow();
  });

  test('rejects unknown element type', () => {
    expect(() => whiteboardElementSchema.parse({ id: 'x', type: 'unknown' })).toThrow();
  });
});

describe('whiteboardViewportSchema', () => {
  test('validates zoom range 0.1..4', () => {
    expect(whiteboardViewportSchema.parse({ x: 0, y: 0, zoom: 0.1 }).zoom).toBe(0.1);
    expect(whiteboardViewportSchema.parse({ x: 100, y: -50, zoom: 4 }).zoom).toBe(4);
    expect(() => whiteboardViewportSchema.parse({ x: 0, y: 0, zoom: 0.05 })).toThrow();
    expect(() => whiteboardViewportSchema.parse({ x: 0, y: 0, zoom: 4.1 })).toThrow();
  });
});

describe('whiteboardCreateBody & whiteboardPatchBody', () => {
  test('validates whiteboardCreateBody', () => {
    const minimal = whiteboardCreateBody.parse({ title: '  Sprint Board  ' });
    expect(minimal.title).toBe('Sprint Board');

    const full = whiteboardCreateBody.parse({
      title: 'Deal Map',
      entityType: 'deal',
      entityId: VALID_UUID,
      elements: [
        { id: 's1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, text: 'Hi', color: '#fff', zIndex: 1 },
      ],
      viewport: { x: 10, y: 20, zoom: 1.5 },
    });
    expect(full.entityType).toBe('deal');
    expect(full.elements?.length).toBe(1);

    expect(() => whiteboardCreateBody.parse({ title: '   ' })).toThrow();
    expect(() => whiteboardCreateBody.parse({ title: 'x'.repeat(201) })).toThrow();
    expect(() => whiteboardCreateBody.parse({ title: 'Bad', entityType: 'task' })).toThrow();
    expect(() => whiteboardCreateBody.parse({ title: 'Bad', entityId: 'not-a-uuid' })).toThrow();
  });

  test('enforces max 500 elements on create and patch', () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      id: `s-${i}`,
      type: 'sticky' as const,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      text: '',
      color: '#fff',
      zIndex: i,
    }));
    expect(() => whiteboardCreateBody.parse({ title: 'Too many', elements: tooMany })).toThrow();
    expect(() => whiteboardPatchBody.parse({ elements: tooMany })).toThrow();
  });

  test('validates whiteboardPatchBody partial updates', () => {
    expect(whiteboardPatchBody.parse({})).toEqual({});
    expect(whiteboardPatchBody.parse({ title: 'Renamed', entityType: null, entityId: null })).toEqual({
      title: 'Renamed',
      entityType: null,
      entityId: null,
    });
    expect(whiteboardPatchBody.parse({ viewport: { x: 5, y: 5, zoom: 2 } })).toEqual({
      viewport: { x: 5, y: 5, zoom: 2 },
    });
    expect(() => whiteboardPatchBody.parse({ title: '' })).toThrow();
  });
});
