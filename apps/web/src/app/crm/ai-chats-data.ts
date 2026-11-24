/* CRM → AI Chats: client types and TanStack Query hooks for /ai-chats endpoints. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { leadsKey } from '../leads/data';
import { call, useWsId } from '../meta/data';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
}

export interface AiChatSession {
  id: string;
  botName: string;
  visitorName: string | null;
  ip: string;
  userAgent: string | null;
  locale: string;
  pageUrl: string | null;
  messages: AiChatMessage[];
  messageCount: number;
  leadId: string | null;
  currentNodeId?: string | null;
  collectedData?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface AiChatsResponse {
  items: AiChatSession[];
  total: number;
}

export type AiChatTone = 'friendly' | 'formal' | 'concise' | 'sales';

export type SalesScriptNodeKind = 'start' | 'stage' | 'branch' | 'objection' | 'action' | 'end';

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

export type WidgetPosition = 'right' | 'left';

export interface AiChatSettings {
  tone: AiChatTone;
  customToneNote: string;
  greeting: {
    ru: string;
    en: string;
    es: string;
  };
  script?: SalesScriptGraph;
  widgetEnabled?: boolean;
  widgetToken?: string | null;
  allowedOrigins?: string[];
  botName?: string;
  accentColor?: string;
  position?: WidgetPosition;
  handoffEnabled?: boolean;
  soundEnabled?: boolean;
  knowledgeBase?: string;
  dailyLimit?: number;
}

export const aiChatsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'ai-chats', ...rest] as const;

export function firstUserMessage(session: AiChatSession): string {
  return session.messages.find(m => m.role === 'user')?.content ?? '';
}

export function useAiChats(params: { q?: string; locale?: string }) {
  const ws = useWsId();
  const qs = React.useMemo(() => {
    const p = new URLSearchParams();
    if (params.q?.trim()) p.set('q', params.q.trim());
    if (params.locale && params.locale !== 'all') p.set('locale', params.locale);
    return p.toString();
  }, [params.q, params.locale]);

  return useQuery({
    queryKey: aiChatsKey(ws, 'list', qs),
    queryFn: () => call<AiChatsResponse>(ws, 'GET', `/ai-chats${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  });
}

export function useLeadAiChats(leadId: string | null | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: aiChatsKey(ws, 'by-lead', leadId),
    queryFn: () => call<AiChatsResponse>(ws, 'GET', `/ai-chats?leadId=${leadId}&limit=10`),
    enabled: !!leadId,
    staleTime: 30_000,
  });
}

export function useAiChatSettings() {
  const ws = useWsId();
  return useQuery({
    queryKey: aiChatsKey(ws, 'settings'),
    queryFn: () => call<AiChatSettings>(ws, 'GET', '/ai-chats/settings'),
    staleTime: 30_000,
  });
}

export function useAiChatsApi() {
  const ws = useWsId();
  const qc = useQueryClient();

  const createLead = React.useCallback(
    async (id: string) => {
      try {
        const res = await call<{ leadId?: string; id?: string }>(ws, 'POST', `/ai-chats/${id}/lead`);
        void qc.invalidateQueries({ queryKey: aiChatsKey(ws) });
        void qc.invalidateQueries({ queryKey: leadsKey(ws) });
        return res;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );

  const remove = React.useCallback(
    async (id: string) => {
      try {
        await call<void>(ws, 'DELETE', `/ai-chats/${id}`);
        void qc.invalidateQueries({ queryKey: aiChatsKey(ws) });
        return true;
      } catch (e) {
        toast.error(errorMessage(e));
        return false;
      }
    },
    [ws, qc],
  );

  const saveSettings = React.useCallback(
    async (patch: Partial<AiChatSettings>) => {
      try {
        const res = await call<AiChatSettings>(ws, 'PATCH', '/ai-chats/settings', patch);
        void qc.invalidateQueries({ queryKey: aiChatsKey(ws, 'settings') });
        return res;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );

  const rotateWidgetToken = React.useCallback(async () => {
    try {
      const res = await call<AiChatSettings>(ws, 'POST', '/ai-chats/settings/rotate-token');
      void qc.invalidateQueries({ queryKey: aiChatsKey(ws, 'settings') });
      return res;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  }, [ws, qc]);

  const scrapeKnowledgeBase = React.useCallback(
    async (url: string) => {
      try {
        return await call<{ knowledgeBase: string; pagesScraped: number }>(ws, 'POST', '/ai-chats/settings/scrape-kb', { url });
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws],
  );

  return { createLead, remove, saveSettings, rotateWidgetToken, scrapeKnowledgeBase };
}
