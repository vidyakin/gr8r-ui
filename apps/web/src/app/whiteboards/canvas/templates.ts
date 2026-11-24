// Готовые шаблоны досок для быстрого старта на русском языке
import type { WbElement } from './types';

export interface WbTemplate {
  id: string;
  name: string;
  description: string;
  elements: WbElement[];
}

export const WB_TEMPLATES: WbTemplate[] = [
  {
    id: 'swot',
    name: 'SWOT-анализ',
    description: '4 квадранта оценки проекта или сделки: сильные/слабые стороны, возможности и угрозы',
    elements: [
      { id: 'swot-t', type: 'text', x: 60, y: 20, w: 320, h: 40, text: 'SWOT-анализ проекта', fontSize: 22, z: 1 },
      { id: 'swot-s', type: 'section', x: 60, y: 80, w: 380, h: 280, title: 'Сильные стороны (Strengths)', color: '#10B981', z: 0 },
      { id: 'swot-w', type: 'section', x: 460, y: 80, w: 380, h: 280, title: 'Слабые стороны (Weaknesses)', color: '#F59E0B', z: 0 },
      { id: 'swot-o', type: 'section', x: 60, y: 380, w: 380, h: 280, title: 'Возможности (Opportunities)', color: '#3B82F6', z: 0 },
      { id: 'swot-tr', type: 'section', x: 460, y: 380, w: 380, h: 280, title: 'Угрозы (Threats)', color: '#EF4444', z: 0 },
      { id: 'swot-st-1', type: 'sticky', x: 84, y: 136, w: 160, h: 120, text: 'Сильная команда и опыт внедрения', color: '#BBF7D0', z: 2 },
      { id: 'swot-st-2', type: 'sticky', x: 260, y: 136, w: 160, h: 120, text: 'Единая ERP-платформа без разрозненных таблиц', color: '#BBF7D0', z: 2 },
      { id: 'swot-wk-1', type: 'sticky', x: 484, y: 136, w: 160, h: 120, text: 'Нехватка времени на онбординг отдела', color: '#FEF08A', z: 2 },
      { id: 'swot-op-1', type: 'sticky', x: 84, y: 436, w: 160, h: 120, text: 'Автоматизация воронки и отчётности', color: '#BFDBFE', z: 2 },
      { id: 'swot-th-1', type: 'sticky', x: 484, y: 436, w: 160, h: 120, text: 'Затягивание согласования со стороны ЛПР', color: '#FECDD3', z: 2 },
    ],
  },
  {
    id: 'customer_map',
    name: 'Карта клиента / сделки',
    description: 'Структура работы с клиентом: контекст, боли, решение и следующие шаги',
    elements: [
      { id: 'cm-t', type: 'text', x: 60, y: 20, w: 360, h: 40, text: 'Карта клиента и сделки', fontSize: 22, z: 1 },
      { id: 'cm-ctx', type: 'section', x: 60, y: 80, w: 260, h: 360, title: 'Контекст', color: '#64748B', z: 0 },
      { id: 'cm-pain', type: 'section', x: 340, y: 80, w: 260, h: 360, title: 'Боли', color: '#EF4444', z: 0 },
      { id: 'cm-sol', type: 'section', x: 620, y: 80, w: 260, h: 360, title: 'Решение', color: '#3B82F6', z: 0 },
      { id: 'cm-next', type: 'section', x: 900, y: 80, w: 260, h: 360, title: 'Следующие шаги', color: '#10B981', z: 0 },
      { id: 'cm-s1', type: 'sticky', x: 84, y: 136, w: 210, h: 110, text: 'Профиль компании, ЛПР, текущий бюджет', color: '#BFDBFE', z: 2 },
      { id: 'cm-s2', type: 'sticky', x: 364, y: 136, w: 210, h: 110, text: 'Теряются заявки между отделами', color: '#FECDD3', z: 2 },
      { id: 'cm-s3', type: 'sticky', x: 644, y: 136, w: 210, h: 110, text: 'Сквозная CRM + контроль SLA в задачах', color: '#DDD6FE', z: 2 },
      { id: 'cm-s4', type: 'sticky', x: 924, y: 136, w: 210, h: 110, text: 'Отправить КП и согласовать пилот до пятницы', color: '#BBF7D0', z: 2 },
      { id: 'cm-a1', type: 'arrow', x1: 320, y1: 260, x2: 340, y2: 260, fromId: 'cm-ctx', toId: 'cm-pain', color: '#64748B', z: 3 },
      { id: 'cm-a2', type: 'arrow', x1: 600, y1: 260, x2: 620, y2: 260, fromId: 'cm-pain', toId: 'cm-sol', color: '#64748B', z: 3 },
      { id: 'cm-a3', type: 'arrow', x1: 880, y1: 260, x2: 900, y2: 260, fromId: 'cm-sol', toId: 'cm-next', color: '#64748B', z: 3 },
    ],
  },
  {
    id: 'roadmap',
    name: 'Дорожная карта внедрения',
    description: 'Пошаговый план запуска из 3 этапов со связями и ключевыми результатами',
    elements: [
      { id: 'rm-t', type: 'text', x: 60, y: 20, w: 420, h: 40, text: 'Дорожная карта внедрения', fontSize: 22, z: 1 },
      { id: 'rm-1', type: 'section', x: 60, y: 90, w: 280, h: 320, title: 'Этап 1 · Подготовка', color: '#3B82F6', z: 0 },
      { id: 'rm-2', type: 'section', x: 400, y: 90, w: 280, h: 320, title: 'Этап 2 · Запуск', color: '#8B5CF6', z: 0 },
      { id: 'rm-3', type: 'section', x: 740, y: 90, w: 280, h: 320, title: 'Этап 3 · Масштабирование', color: '#10B981', z: 0 },
      { id: 'rm-s1', type: 'sticky', x: 84, y: 146, w: 230, h: 105, text: 'Аудит процессов и перенос базы клиентов', color: '#BFDBFE', z: 2 },
      { id: 'rm-s2', type: 'sticky', x: 84, y: 268, w: 230, h: 105, text: 'Настройка ролей и прав доступа', color: '#FEF08A', z: 2 },
      { id: 'rm-s3', type: 'sticky', x: 424, y: 146, w: 230, h: 105, text: 'Пилот на ключевой команде продаж', color: '#DDD6FE', z: 2 },
      { id: 'rm-s4', type: 'sticky', x: 424, y: 268, w: 230, h: 105, text: 'Обучение сотрудников и сбор обратной связи', color: '#FED7AA', z: 2 },
      { id: 'rm-s5', type: 'sticky', x: 764, y: 146, w: 230, h: 105, text: 'Подключение всех отделов и дашбордов KPI', color: '#BBF7D0', z: 2 },
      { id: 'rm-a1', type: 'arrow', x1: 340, y1: 250, x2: 400, y2: 250, fromId: 'rm-1', toId: 'rm-2', color: '#4B5BD6', z: 3 },
      { id: 'rm-a2', type: 'arrow', x1: 680, y1: 250, x2: 740, y2: 250, fromId: 'rm-2', toId: 'rm-3', color: '#4B5BD6', z: 3 },
    ],
  },
];
