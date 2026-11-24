/* Localized UI strings for the embeddable FutureERP chat widget (RU / EN / ES). */

export type WidgetLang = 'ru' | 'en' | 'es';

export interface WidgetStrings {
  placeholder: string;
  send: string;
  callManager: string;
  managerJoined: string;
  backToAi: string;
  soundOn: string;
  soundOff: string;
  connecting: string;
  error: string;
  namePlaceholder: string;
  startManagerChat: string;
  online: string;
  defaultBotName: string;
  close: string;
  openChat: string;
  manager: string;
  cancel: string;
}

const STRINGS: Record<WidgetLang, WidgetStrings> = {
  ru: {
    placeholder: 'Напишите сообщение...',
    send: 'Отправить',
    callManager: 'Позвать менеджера',
    managerJoined: 'Чат с менеджером',
    backToAi: 'Начать новый AI-чат',
    soundOn: 'Выключить звук',
    soundOff: 'Включить звук',
    connecting: 'Подключаем менеджера...',
    error: 'Не удалось отправить сообщение. Попробуйте ещё раз.',
    namePlaceholder: 'Ваше имя (необязательно)',
    startManagerChat: 'Подключить менеджера',
    online: 'В сети',
    defaultBotName: 'AI-помощник',
    close: 'Закрыть чат',
    openChat: 'Открыть чат',
    manager: 'Менеджер',
    cancel: 'Отмена',
  },
  en: {
    placeholder: 'Type a message...',
    send: 'Send',
    callManager: 'Call manager',
    managerJoined: 'Live manager chat',
    backToAi: 'Start new AI chat',
    soundOn: 'Mute sound',
    soundOff: 'Unmute sound',
    connecting: 'Connecting to a manager...',
    error: 'Failed to send message. Please try again.',
    namePlaceholder: 'Your name (optional)',
    startManagerChat: 'Connect manager',
    online: 'Online',
    defaultBotName: 'AI Assistant',
    close: 'Close chat',
    openChat: 'Open chat',
    manager: 'Manager',
    cancel: 'Cancel',
  },
  es: {
    placeholder: 'Escribe un mensaje...',
    send: 'Enviar',
    callManager: 'Llamar a un asesor',
    managerJoined: 'Chat con asesor',
    backToAi: 'Iniciar nuevo chat IA',
    soundOn: 'Silenciar sonido',
    soundOff: 'Activar sonido',
    connecting: 'Conectando con un asesor...',
    error: 'No se pudo enviar el mensaje. Inténtalo de nuevo.',
    namePlaceholder: 'Tu nombre (opcional)',
    startManagerChat: 'Conectar con asesor',
    online: 'En línea',
    defaultBotName: 'Asistente IA',
    close: 'Cerrar chat',
    openChat: 'Abrir chat',
    manager: 'Asesor',
    cancel: 'Cancelar',
  },
};

export function resolveLang(attr?: string | null): WidgetLang {
  const candidates = [
    attr,
    typeof document !== 'undefined' ? document.documentElement.lang : '',
    typeof navigator !== 'undefined' ? navigator.language : '',
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const base = raw.trim().toLowerCase().slice(0, 2);
    if (base === 'ru' || base === 'en' || base === 'es') return base;
  }
  return 'ru';
}

export function getStrings(lang: WidgetLang): WidgetStrings {
  return STRINGS[lang] ?? STRINGS.ru;
}
