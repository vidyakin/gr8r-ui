/* Realtime: WebSocket /ws воркспейса. Событие журнала (envelope без payload) говорит, какая сущность изменилась;
   соответствующие коллекции кэша помечаются устаревшими и перечитываются (пока в полёте свои запросы — после них, чтобы
   не затереть оптимистичное состояние). Обрыв: переподключение с `?since=<id последнего события>`, сервер досылает пропущенное. */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFor, ok } from './api';
import { collectionsFor, type Engine } from './engine';

interface EventEnvelope {
  id: string;
  workspaceId: string;
  type: string;
  entity: string;
  recordId: string | null;
  actorId: string | null;
}

export function useRealtime(ws: string, engine: Engine) {
  const qc = useQueryClient();
  React.useEffect(() => {
    let closed = false;
    let sock: WebSocket | null = null;
    let retry = 0;
    let since = '';
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    const seen = new Set<string>();

    const onEvent = (e: EventEnvelope) => {
      if (seen.has(e.id)) return; // дедупликация: событие может прийти и в реальном времени, и в досылке
      seen.add(e.id);
      if (seen.size > 2000) seen.delete(seen.values().next().value!);
      if (e.id > since) since = e.id;
      engine.refresh(collectionsFor(e.entity));
      // Конструктор сущностей: метаданные и записи пользовательских сущностей живут в отдельных запросах
      if (e.entity === 'entity' || e.entity === 'field') void qc.invalidateQueries({ queryKey: ['ws', ws, 'meta'] });
      if (e.entity === 'record') for (const k of ['records', 'record', 'ref-title', 'ref-search']) void qc.invalidateQueries({ queryKey: ['ws', ws, k] });
      // Каталог и производство: отдельные запросы ['ws', id, 'catalog' | 'production', …]
      if (['unit', 'product_category', 'attribute_def', 'product'].includes(e.entity)) void qc.invalidateQueries({ queryKey: ['ws', ws, 'catalog'] });
      if (['work_center', 'manufactured_item', 'bom_line', 'product', 'workspace'].includes(e.entity)) void qc.invalidateQueries({ queryKey: ['ws', ws, 'production'] });
      // Документы, организации, склады, счета, остатки: запросы ['ws', id, 'docs', …]; проведение меняет и среднюю себестоимость в производстве
      if (['document', 'organization', 'warehouse', 'bank_account', 'product', 'company', 'unit', 'cost_item', 'deal', 'sales_plan_scenario', 'appointment', 'specialist_schedule', 'contact', 'delivery', 'delivery_method', 'position', 'product_kind', 'cash_register', 'cash_flow_item', 'price_kind', 'price_list_link'].includes(e.entity)) void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
      if (e.entity === 'document') void qc.invalidateQueries({ queryKey: ['ws', ws, 'production'] });
      // Шаблоны КП: ['ws', id, 'doc-templates', …]
      if (e.entity === 'doc_template') void qc.invalidateQueries({ queryKey: ['ws', ws, 'doc-templates'] });
      // Отчёты услуг лежат под 'docs'; задачи и записи времени меняют план, факт и просрочку (задача 1097)
      if (e.entity === 'task' || e.entity === 'time_log' || e.entity === 'member') void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs', 'service-reports'] });
      // Планирование загрузки: графики, ресурсы, операции и документы меняют план
      if (['work_calendar', 'resource', 'document', 'task'].includes(e.entity)) void qc.invalidateQueries({ queryKey: ['ws', ws, 'planning'] });
      // Лиды (задача 1175): запросы ['ws', id, 'leads', …]; конвертация и объединение меняют лиды, контрагентов, контакты, сделки и касания
      if (['lead', 'lead_status', 'lead_form', 'crm_activity', 'company', 'contact', 'deal'].includes(e.entity)) void qc.invalidateQueries({ queryKey: ['ws', ws, 'leads'] });
      // Воронки продаж (задача 1176): ['ws', id, 'pipelines', …] — воронки, этапы, причины, история и отчёт; сделка меняет историю и отчёт
      if (['deal', 'deal_pipeline', 'deal_stage', 'deal_lost_reason'].includes(e.entity)) void qc.invalidateQueries({ queryKey: ['ws', ws, 'pipelines'] });
      // Реклама (задача 1177): ['ws', id, 'ad', …] — справочники, расходы и отчёт по каналам (лиды, клиенты, сделки входят в отчёт)
      if (['lead_source', 'ad_campaign', 'ad_expense', 'lead', 'company', 'deal'].includes(e.entity)) void qc.invalidateQueries({ queryKey: ['ws', ws, 'ad'] });
      if (e.entity === 'lead_source' || e.entity === 'ad_campaign') void qc.invalidateQueries({ queryKey: ['ws', ws, 'leads'] });
      // Автоматизации: flow и журнал запусков
      if (e.entity === 'flow' || e.entity === 'flow_run') void qc.invalidateQueries({ queryKey: ['ws', ws, 'automations'] });
      // Должности и виды номенклатуры (задача 1172); смена должностей участника приходит событием member.updated
      if (['position', 'product_kind'].includes(e.entity) || e.type.startsWith('member.')) void qc.invalidateQueries({ queryKey: ['ws', ws, 'positions'] });
      // Лицензия (задача 1205): набор модулей изменился — перечитываем всё, что принадлежит воркспейсу (раздел мог появиться или пропасть)
      if (e.entity === 'license') void qc.invalidateQueries({ queryKey: ['ws', ws] });
      if (e.entity === 'position' || e.entity === 'product_kind') void qc.invalidateQueries({ queryKey: ['ws', ws, 'catalog'] });
      if (e.entity === 'secret') void qc.invalidateQueries({ queryKey: ['ws', ws, 'secrets'] });
      // Название воркспейса, моя роль, состав участников
      if (e.entity === 'workspace' || e.type.startsWith('member.')) void qc.invalidateQueries({ queryKey: ['session'] });
    };

    const connect = async () => {
      if (closed) return;
      if (!since) {
        // Точка отсчёта: последнее событие на момент загрузки, всё после него будет доставлено
        try {
          const last = await ok<{ items: { id: string }[] }>(apiFor(ws).events.$get({ query: { sort: '-id', limit: '1' } }));
          since = last.items[0]?.id ?? '';
        } catch {
          /* без точки отсчёта подключаемся как есть */
        }
        if (closed) return;
      }
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      sock = new WebSocket(`${proto}//${location.host}/api/ws?workspace=${ws}${since ? `&since=${since}` : ''}`);
      sock.onopen = () => {
        retry = 0;
        pingTimer = setInterval(() => sock?.readyState === WebSocket.OPEN && sock.send('ping'), 25_000);
      };
      sock.onmessage = m => {
        try {
          const msg = JSON.parse(String(m.data)) as { type: string; event?: EventEnvelope };
          if (msg.type === 'event' && msg.event) onEvent(msg.event);
        } catch {
          /* не наше сообщение */
        }
      };
      sock.onclose = () => {
        clearInterval(pingTimer);
        if (closed) return;
        // После обрыва могли пропасть события и ответы — на всякий случай перечитываем всё
        engine.refresh(collectionsFor('*'));
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15_000));
      };
    };
    void connect();

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      sock?.close();
    };
  }, [ws, engine, qc]);
}
