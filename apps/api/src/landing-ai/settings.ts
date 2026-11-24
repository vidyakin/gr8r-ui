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

export const WIDGET_POSITIONS = ['right', 'left'] as const;
export type WidgetPosition = (typeof WIDGET_POSITIONS)[number];

export interface AiChatSettings {
  tone: AiChatTone;
  customToneNote: string;
  greeting: { ru: string; en: string; es: string };
  script: SalesScriptGraph;
  widgetEnabled: boolean;
  widgetSecret: string;
  allowedOrigins: string[];
  botName: string;
  accentColor: string;
  position: WidgetPosition;
  handoffEnabled: boolean;
  soundEnabled: boolean;
  knowledgeBase: string;
  dailyLimit: number;
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
  widgetEnabled: false,
  widgetSecret: '',
  allowedOrigins: [],
  botName: '',
  accentColor: '#2563eb',
  position: 'right',
  handoffEnabled: true,
  soundEnabled: true,
  knowledgeBase: '',
  dailyLimit: 300,
};

const noteField = z.string().trim().max(400).optional();
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Нормализует origin сайта клиента до схемы + хоста (+ порта), отбрасывая пути и невалидные строки */
export function normalizeOrigin(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function sanitizeAllowedOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const norm = normalizeOrigin(item);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 20) break;
  }
  return out;
}

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
  widgetEnabled: z.boolean().optional(),
  allowedOrigins: z.array(z.string().trim().max(200)).max(20).optional(),
  botName: z.string().trim().max(60).optional(),
  accentColor: z.string().trim().regex(HEX_COLOR_RE).optional(),
  position: z.enum(WIDGET_POSITIONS).optional(),
  handoffEnabled: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  knowledgeBase: z.string().max(20_000).optional(),
  dailyLimit: z.number().int().min(10).max(5000).optional(),
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
  const pos = typeof raw.position === 'string' && (WIDGET_POSITIONS as readonly string[]).includes(raw.position)
    ? (raw.position as WidgetPosition)
    : DEFAULT_AI_CHAT_SETTINGS.position;
  const color = typeof raw.accentColor === 'string' && HEX_COLOR_RE.test(raw.accentColor.trim())
    ? raw.accentColor.trim()
    : DEFAULT_AI_CHAT_SETTINGS.accentColor;
  const rawLimit = typeof raw.dailyLimit === 'number' && Number.isFinite(raw.dailyLimit)
    ? Math.min(5000, Math.max(10, Math.round(raw.dailyLimit)))
    : DEFAULT_AI_CHAT_SETTINGS.dailyLimit;
  return {
    tone,
    customToneNote: cleanStr(raw.customToneNote),
    greeting: {
      ru: cleanStr(g.ru),
      en: cleanStr(g.en),
      es: cleanStr(g.es),
    },
    script: extractSalesScript(raw.script),
    widgetEnabled: raw.widgetEnabled === true,
    widgetSecret: cleanStr(raw.widgetSecret, 128),
    allowedOrigins: sanitizeAllowedOrigins(raw.allowedOrigins),
    botName: cleanStr(raw.botName, 60),
    accentColor: color,
    position: pos,
    handoffEnabled: raw.handoffEnabled !== false,
    soundEnabled: raw.soundEnabled !== false,
    knowledgeBase: typeof raw.knowledgeBase === 'string' ? raw.knowledgeBase.slice(0, 20_000) : '',
    dailyLimit: rawLimit,
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
    widgetEnabled: patch.widgetEnabled ?? current.widgetEnabled,
    widgetSecret: current.widgetSecret,
    allowedOrigins: patch.allowedOrigins !== undefined ? sanitizeAllowedOrigins(patch.allowedOrigins) : current.allowedOrigins,
    botName: patch.botName !== undefined ? cleanStr(patch.botName, 60) : current.botName,
    accentColor: patch.accentColor ?? current.accentColor,
    position: patch.position ?? current.position,
    handoffEnabled: patch.handoffEnabled ?? current.handoffEnabled,
    soundEnabled: patch.soundEnabled ?? current.soundEnabled,
    knowledgeBase: patch.knowledgeBase !== undefined ? patch.knowledgeBase.slice(0, 20_000) : current.knowledgeBase,
    dailyLimit: patch.dailyLimit ?? current.dailyLimit,
  };
}

/** Убирает сырой widgetSecret и добавляет готовый widgetToken для ответа API */
export function toAdminAiChatSettings(workspaceId: string, settings: AiChatSettings) {
  const { widgetSecret, ...rest } = settings;
  return {
    ...rest,
    widgetToken: widgetSecret ? `${workspaceId}.${widgetSecret}` : null,
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
