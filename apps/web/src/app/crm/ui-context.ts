/* Контекст оверлеев CRM: открыть карточку, форму или сменить этап сделки из любого места модуля.
   Провайдер — crm/overlays.tsx; контекст вынесен отдельно, чтобы компоненты и оверлеи не импортировали друг друга по кругу. */
import * as React from 'react';
import type { StageId } from './types';

export interface DealDefaults {
  stage?: StageId;
  pipeline?: string;
  company?: string;
  owner?: string;
}

export interface CrmUi {
  openDeal(id: string): void;
  openContact(id: string): void;
  closeDrawer(): void;
  newDeal(defaults?: DealDefaults): void;
  newCompany(): void;
  newContact(defaults?: { company?: string }): void;
  /** Смена этапа: «выиграна» подтверждается, «проиграна» спрашивает причину, этап с обязательными полями — их значения; остальные применяются сразу */
  moveDeal(id: string, stage: StageId, before?: string | null): void;
  /** Быстрые действия карточки: победа, проигрыш (первый «проиграна» воронки сделки) или возврат в работу */
  moveDealTo(id: string, target: 'won' | 'lost' | 'reopen'): void;
  /** Перенос в другую воронку: на её первый этап */
  movePipeline(id: string, pipelineId: string): void;
}

export const CrmUiCtx = React.createContext<CrmUi | null>(null);

export function useCrmUi() {
  const c = React.useContext(CrmUiCtx);
  if (!c) throw new Error('useCrmUi: нет CrmOverlays');
  return c;
}
