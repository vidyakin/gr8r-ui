/* Шаблон B2B-скрипта продаж для визуального редактора ИИ-консультанта. */
import type { SalesScriptGraph } from './ai-chats-data';

export const DEFAULT_SALES_SCRIPT: SalesScriptGraph = {
  enabled: true,
  nodes: [
    {
      id: 'start',
      kind: 'start',
      title: 'Приветствие',
      promptHint:
        'Коротко поприветствуй посетителя, уточни чем он занимается и какую задачу хочет автоматизировать в компании.',
      collectFields: [],
      x: 40,
      y: 180,
    },
    {
      id: 'discovery',
      kind: 'stage',
      title: 'Выявление потребности',
      promptHint:
        'Выясни сферу бизнеса, размер команды и текущие узкие места (учёт, CRM, задачи, финансы), не задавай больше 2 вопросов за раз.',
      collectFields: ['industry', 'team_size'],
      x: 320,
      y: 180,
    },
    {
      id: 'presentation',
      kind: 'stage',
      title: 'Презентация решения',
      promptHint:
        'Покажи, как Gr8r решает названную боль: единое окно для CRM, проектов, склада и финансов без зоопарка таблиц.',
      collectFields: [],
      x: 610,
      y: 90,
    },
    {
      id: 'objection_1c',
      kind: 'objection',
      title: 'Возражение «Есть 1С / дорого»',
      promptHint:
        'Спокойно отработай возражение: объясни, что Gr8r не ломает бухгалтерию, а закрывает операционку и экономит часы команды, окупаясь за первый месяц.',
      collectFields: [],
      x: 610,
      y: 290,
    },
    {
      id: 'book_demo',
      kind: 'end',
      title: 'Запись на демо',
      promptHint:
        'Предложи 15-минутное живое демо на реальном кейсе клиента и вежливо попроси телефон, Telegram или email для связи.',
      collectFields: ['contact'],
      x: 910,
      y: 180,
    },
  ],
  edges: [
    {
      id: 'e-start-discovery',
      source: 'start',
      target: 'discovery',
      condition: 'Есть ответ',
    },
    {
      id: 'e-discovery-presentation',
      source: 'discovery',
      target: 'presentation',
      condition: 'Задача понятна',
    },
    {
      id: 'e-discovery-objection',
      source: 'discovery',
      target: 'objection_1c',
      condition: 'Уже есть 1С / дорого',
    },
    {
      id: 'e-presentation-objection',
      source: 'presentation',
      target: 'objection_1c',
      condition: 'Сомнения по цене или 1С',
    },
    {
      id: 'e-presentation-demo',
      source: 'presentation',
      target: 'book_demo',
      condition: 'Интерес к продукту',
    },
    {
      id: 'e-objection-demo',
      source: 'objection_1c',
      target: 'book_demo',
      condition: 'Возражение снято',
    },
  ],
};
