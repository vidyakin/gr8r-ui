/* Типы демо-модуля CRM. Владельцы (owner, by) — id участников основного воркспейса (Member.id). */
import type { IsoDate } from '../data/types';

export type StageId = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export interface Company {
  id: string;
  name: string;
  industry: string;
  size: string;
  owner: string;
  website: string;
  city: string;
  created: number;
}

export interface Contact {
  id: string;
  company: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  owner: string;
  created: number;
}

export interface Deal {
  id: string;
  name: string;
  company: string;
  contacts: string[];
  owner: string;
  /** Сумма в USD */
  amount: number;
  stage: StageId;
  closeDate: IsoDate;
  created: number;
  /** Дата закрытия (для Won/Lost) */
  closedAt?: IsoDate;
  lostReason?: string;
  /** Порядок карточки внутри колонки воронки */
  order: number;
}

export type ActivityType = 'call' | 'email' | 'meeting' | 'note' | 'task';

export interface CrmActivity {
  id: string;
  type: ActivityType;
  subject: string;
  deal?: string;
  company?: string;
  contact?: string;
  by: string;
  at: number;
  /** Служебная запись (смена этапа) */
  system?: boolean;
  /** Для type=task: срок и отметка выполнения */
  due?: IsoDate;
  done?: boolean;
  body?: string;
}

export interface CrmData {
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  activities: CrmActivity[];
}
