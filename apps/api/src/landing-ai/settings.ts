/* Настройки тона и приветствия ИИ-консультанта лендинга (хранятся в workspaces.settings.aiChat). */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { isUuid, withContext, workspaces, type Sql } from '@erp/db';

export const AI_CHAT_TONES = ['friendly', 'formal', 'concise', 'sales'] as const;
export type AiChatTone = (typeof AI_CHAT_TONES)[number];

export const SALES_SCRIPT_NODE_KINDS = ['start', 'stage', 'branch', 'objection', 'action', 'end'] as const;
export type SalesScriptNodeKind = (typeof SALES_SCRIPT_NODE_KINDS)[number];

export interface SalesScriptNode {
  id: string;
  kind: SalesScriptNodeKind;
  title: string;
  promptHint: string;
  collectFields: string[];
  x: number;
  y: number;
}

export interface SalesScriptEdge {
  id: string;
  source: string;
  target: string;
  condition: string;
}

export interface SalesScriptGraph {
  enabled: boolean;
  nodes: SalesScriptNode[];
  edges: SalesScriptEdge[];
}

export interface AiChatSettings {
  tone: AiChatTone;
  customToneNote: string;
  greeting: { ru: string; en: string; es: string };
  script: SalesScriptGraph;
}

export const DEFAULT_SALES_SCRIPT: SalesScriptGraph = {
  enabled: false,
  nodes: [],
  edges: [],
};

export const DEFAULT_AI_CHAT_SETTINGS: AiChatSettings = {
  tone: 'friendly',
  customToneNote: '',
  greeting: { ru: '', en: '', es: '' },
  script: DEFAULT_SALES_SCRIPT,
};

const noteField = z.string().trim().max(400).optional();

const salesScriptNodeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  kind: z.enum(SALES_SCRIPT_NODE_KINDS),
  title: z.string().trim().max(120),
  promptHint: z.string().trim().max(1000),
  collectFields: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  x: z.number().finite(),
  y: z.number().finite(),
});

const salesScriptEdgeSchema = z.object({
  id: z.string().trim().min(1).max(80),
  source: z.string().trim().min(1).max(80),
  target: z.string().trim().min(1).max(80),
  condition: z.string().trim().max(200),
});

export const salesScriptGraphSchema = z.object({
  enabled: z.boolean(),
  nodes: z.array(salesScriptNodeSchema).max(40),
  edges: z.array(salesScriptEdgeSchema).max(100),
});

export const aiChatSettingsPatch = z.object({
  tone: z.enum(AI_CHAT_TONES).optional(),
  customToneNote: noteField,
  greeting: z
    .object({
      ru: noteField,
      en: noteField,
      es: noteField,
    })
    .optional(),
  script: salesScriptGraphSchema.optional(),
});

export type AiChatSettingsPatch = z.infer<typeof aiChatSettingsPatch>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const cleanStr = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function extractSalesScript(raw: unknown): SalesScriptGraph {
  if (!isRecord(raw)) return { enabled: false, nodes: [], edges: [] };
  const enabled = raw.enabled === true;
  const nodes: SalesScriptNode[] = [];
  if (Array.isArray(raw.nodes)) {
    for (const item of raw.nodes) {
      if (nodes.length >= 40) break;
      if (!isRecord(item)) continue;
      const id = cleanStr(item.id, 80);
      if (!id) continue;
      const kind =
        typeof item.kind === 'string' && (SALES_SCRIPT_NODE_KINDS as readonly string[]).includes(item.kind)
          ? (item.kind as SalesScriptNodeKind)
          : 'stage';
      const collectFields = Array.isArray(item.collectFields)
        ? item.collectFields.map(f => cleanStr(f, 60)).filter(Boolean).slice(0, 10)
        : [];
      nodes.push({
        id,
        kind,
        title: cleanStr(item.title, 120),
        promptHint: cleanStr(item.promptHint, 1000),
        collectFields,
        x: typeof item.x === 'number' && Number.isFinite(item.x) ? item.x : 0,
        y: typeof item.y === 'number' && Number.isFinite(item.y) ? item.y : 0,
      });
    }
  }
  const edges: SalesScriptEdge[] = [];
  if (Array.isArray(raw.edges)) {
    for (const item of raw.edges) {
      if (edges.length >= 100) break;
      if (!isRecord(item)) continue;
      const id = cleanStr(item.id, 80);
      const source = cleanStr(item.source, 80);
      const target = cleanStr(item.target, 80);
      if (!id || !source || !target) continue;
      edges.push({
        id,
        source,
        target,
        condition: cleanStr(item.condition, 200),
      });
    }
  }
  return { enabled, nodes, edges };
}

/** Безопасно извлекает настройки ИИ-чата из workspaces.settings с подстановкой значений по умолчанию */
export function extractAiChatSettings(rawSettings: Record<string, unknown> | null | undefined): AiChatSettings {
  const raw = isRecord(rawSettings) && isRecord(rawSettings.aiChat) ? rawSettings.aiChat : {};
  const tone = typeof raw.tone === 'string' && (AI_CHAT_TONES as readonly string[]).includes(raw.tone)
    ? (raw.tone as AiChatTone)
    : DEFAULT_AI_CHAT_SETTINGS.tone;
  const g = isRecord(raw.greeting) ? raw.greeting : {};
  return {
    tone,
    customToneNote: cleanStr(raw.customToneNote),
    greeting: {
      ru: cleanStr(g.ru),
      en: cleanStr(g.en),
      es: cleanStr(g.es),
    },
    script: extractSalesScript(raw.script),
  };
}

/** Применяет частичный патч поверх текущих настроек ИИ-чата */
export function mergeAiChatSettings(current: AiChatSettings, patch: AiChatSettingsPatch): AiChatSettings {
  return {
    tone: patch.tone ?? current.tone,
    customToneNote: patch.customToneNote ?? current.customToneNote,
    greeting: {
      ru: patch.greeting?.ru ?? current.greeting.ru,
      en: patch.greeting?.en ?? current.greeting.en,
      es: patch.greeting?.es ?? current.greeting.es,
    },
    script: patch.script
      ? {
          enabled: patch.script.enabled,
          nodes: patch.script.nodes.map(n => ({ ...n, collectFields: [...n.collectFields] })),
          edges: patch.script.edges.map(e => ({ ...e })),
        }
      : current.script,
  };
}

/** Читает настройки ИИ-чата воркспейса в контексте RLS (или возвращает значения по умолчанию) */
export async function readWorkspaceAiChatSettings(sql: Sql, workspaceId: string): Promise<AiChatSettings> {
  if (!workspaceId || !isUuid(workspaceId)) {
    return {
      ...DEFAULT_AI_CHAT_SETTINGS,
      greeting: { ...DEFAULT_AI_CHAT_SETTINGS.greeting },
      script: { enabled: false, nodes: [], edges: [] },
    };
  }
  return withContext(sql, { workspaceId }, async db => {
    const [row] = await db
      .select({ settings: workspaces.settings })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return extractAiChatSettings(row?.settings);
  });
}
