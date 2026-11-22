/* Локализованные строки плавающего ИИ-консультанта (ru / en / es) */
import { DEFAULT_LOCALE, type Locale } from './types';

export interface ChatStrings {
  fabLabel: string;
  title: string;
  subtitle: string;
  welcome: string;
  starters: readonly [string, string, string];
  placeholder: string;
  send: string;
  expand: string;
  collapse: string;
  close: string;
  thinking: string;
  ctaDemo: string;
  ctaRequest: string;
  errRateLimit: string;
  errUnavailable: string;
  errGeneric: string;
  disclaimer: string;
}

export const chatStrings: Record<Locale, ChatStrings> = {
  ru: {
    fabLabel: 'Спросить ИИ',
    title: 'ИИ-консультант FutureERP',
    subtitle: 'Отвечаю по возможностям системы',
    welcome:
      'Здравствуйте! Расскажу о модулях FutureERP — производстве и техкартах, CRM, складе, финансах и вариантах размещения.',
    starters: [
      'Как устроены производство и спецификации (BOM)?',
      'Как работает CRM и воронка лидов?',
      'Есть ли self-hosted и от чего зависит стоимость?',
    ],
    placeholder: 'Задайте вопрос о FutureERP…',
    send: 'Отправить',
    expand: 'Развернуть окно',
    collapse: 'Свернуть окно',
    close: 'Закрыть чат',
    thinking: 'Подбираю ответ…',
    ctaDemo: 'Открыть демо',
    ctaRequest: 'Оставить заявку',
    errRateLimit: 'Слишком много запросов за короткое время. Попробуйте через минуту или оставьте заявку.',
    errUnavailable: 'ИИ-консультант сейчас недоступен. Оставьте заявку — ответим лично.',
    errGeneric: 'Не удалось получить ответ. Попробуйте ещё раз или оставьте заявку.',
    disclaimer: 'ИИ отвечает по базе знаний. Точную стоимость обсудим на созвоне.',
  },
  en: {
    fabLabel: 'Ask AI',
    title: 'FutureERP AI Consultant',
    subtitle: 'Ask about modules & workflows',
    welcome:
      'Hi! Ask me anything about FutureERP — production and BOMs, CRM pipelines, inventory, finance, or deployment options.',
    starters: [
      'How do production orders and BOMs work?',
      'What is included in CRM and lead management?',
      'Can we self-host and how is pricing structured?',
    ],
    placeholder: 'Ask a question about FutureERP…',
    send: 'Send',
    expand: 'Expand window',
    collapse: 'Collapse window',
    close: 'Close chat',
    thinking: 'Thinking…',
    ctaDemo: 'Open demo',
    ctaRequest: 'Leave a request',
    errRateLimit: 'Too many requests in a short time. Please try again in a minute or leave a request.',
    errUnavailable: 'The AI consultant is currently unavailable. Leave a request and we will follow up.',
    errGeneric: 'Could not get a response. Please try again or leave a request.',
    disclaimer: 'AI answers from the knowledge base. Exact pricing is confirmed on a call.',
  },
  es: {
    fabLabel: 'Preguntar a IA',
    title: 'Consultor IA de FutureERP',
    subtitle: 'Respondo sobre funciones del sistema',
    welcome:
      '¡Hola! Puedo explicarte cómo funciona FutureERP: producción y listas de materiales (BOM), CRM, almacén, finanzas y despliegue.',
    starters: [
      '¿Cómo funcionan producción y las listas BOM?',
      '¿Qué incluye el CRM y la gestión de leads?',
      '¿Se puede autoalojar y cómo se calcula el precio?',
    ],
    placeholder: 'Escribe tu pregunta sobre FutureERP…',
    send: 'Enviar',
    expand: 'Ampliar ventana',
    collapse: 'Reducir ventana',
    close: 'Cerrar chat',
    thinking: 'Pensando…',
    ctaDemo: 'Abrir demo',
    ctaRequest: 'Dejar solicitud',
    errRateLimit: 'Demasiadas consultas seguidas. Inténtalo en un minuto o deja una solicitud.',
    errUnavailable: 'El consultor IA no está disponible ahora. Deja una solicitud y te contactaremos.',
    errGeneric: 'No se pudo obtener respuesta. Inténtalo de nuevo o deja una solicitud.',
    disclaimer: 'La IA responde según la base de conocimiento. El precio exacto se define en llamada.',
  },
};

export const getChatStrings = (locale: Locale = DEFAULT_LOCALE): ChatStrings =>
  chatStrings[locale] ?? chatStrings[DEFAULT_LOCALE];
