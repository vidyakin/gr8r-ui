/* Standalone embeddable AI + live-manager chat widget for FutureERP. */

import {
  createSessionId,
  fetchWidgetConfig,
  loadState,
  renderSafeText,
  saveState,
  streamAiReply,
  type PublicChatMessageDto,
  type WidgetConfig,
  type WidgetMessage,
} from './client';
import { getStrings, resolveLang, type WidgetLang } from './i18n';
import { playChime } from './sound';
import { WIDGET_STYLES } from './styles';

declare global {
  interface Window {
    __FUTURE_ERP_WIDGET_MOUNTED__?: boolean;
  }
}

const ICONS = {
  chat: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6M17 9l6 6"/></svg>',
};

function waitForBody(): Promise<void> {
  if (document.body) return Promise.resolve();
  return new Promise(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}

function mountWidget(apiBase: string, token: string, lang: WidgetLang, config: WidgetConfig): void {
  const t = getStrings(lang);
  const state = loadState(token);
  const soundAllowed = config.soundEnabled !== false;
  let isOpen = false;
  let isBusy = false;
  let unread = 0;
  let pollTimer: number | null = null;
  let lastServerMsgId: string | null = null;
  const knownIds = new Set<string>();

  for (const m of state.messages) {
    if (m.id) {
      knownIds.add(m.id);
      lastServerMsgId = m.id;
    }
  }
  if (!state.messages.length && config.greeting) {
    state.messages.push({ role: 'assistant', content: config.greeting });
  }

  const host = document.createElement('div');
  host.id = 'future-erp-chat-widget';
  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = WIDGET_STYLES;
  shadow.appendChild(styleEl);

  const root = document.createElement('div');
  root.className = `erp-root ${config.position === 'left' ? 'pos-left' : 'pos-right'}`;
  if (config.accentColor && /^#[0-9a-fA-F]{3,8}$/.test(config.accentColor.trim())) {
    root.style.setProperty('--erp-accent', config.accentColor.trim());
  }

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'erp-launcher';
  launcher.setAttribute('aria-label', t.openChat);
  launcher.innerHTML = ICONS.chat;
  const badge = document.createElement('span');
  badge.className = 'erp-badge hidden';
  launcher.appendChild(badge);

  const panel = document.createElement('section');
  panel.className = 'erp-panel';
  panel.setAttribute('aria-label', config.botName || t.defaultBotName);

  const header = document.createElement('header');
  header.className = 'erp-header';
  const headerInfo = document.createElement('div');
  headerInfo.className = 'erp-header-info';
  const titleEl = document.createElement('div');
  titleEl.className = 'erp-title';
  titleEl.textContent = config.botName || t.defaultBotName;
  const subtitleEl = document.createElement('div');
  subtitleEl.className = 'erp-subtitle';
  const dotEl = document.createElement('span');
  dotEl.className = 'erp-dot';
  const statusText = document.createElement('span');
  subtitleEl.append(dotEl, statusText);
  headerInfo.append(titleEl, subtitleEl);

  const headerActions = document.createElement('div');
  headerActions.className = 'erp-header-actions';
  const soundBtn = document.createElement('button');
  soundBtn.type = 'button';
  soundBtn.className = 'erp-icon-btn';
  if (!soundAllowed) soundBtn.style.display = 'none';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'erp-icon-btn';
  closeBtn.setAttribute('aria-label', t.close);
  closeBtn.innerHTML = ICONS.close;
  headerActions.append(soundBtn, closeBtn);
  header.append(headerInfo, headerActions);

  const toolbar = document.createElement('div');
  toolbar.className = 'erp-toolbar hidden';
  const toolbarLabel = document.createElement('span');
  const toolbarBtn = document.createElement('button');
  toolbarBtn.type = 'button';
  toolbarBtn.className = 'erp-pill-btn';
  toolbar.append(toolbarLabel, toolbarBtn);

  const messagesEl = document.createElement('div');
  messagesEl.className = 'erp-messages';

  const handoffBox = document.createElement('form');
  handoffBox.className = 'erp-handoff-box hidden';
  const handoffRow = document.createElement('div');
  handoffRow.className = 'erp-handoff-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'erp-handoff-input';
  nameInput.placeholder = t.namePlaceholder;
  nameInput.maxLength = 80;
  const handoffCancel = document.createElement('button');
  handoffCancel.type = 'button';
  handoffCancel.className = 'erp-btn-ghost';
  handoffCancel.textContent = t.cancel;
  const handoffConfirm = document.createElement('button');
  handoffConfirm.type = 'submit';
  handoffConfirm.className = 'erp-btn-primary';
  handoffConfirm.textContent = t.startManagerChat;
  handoffRow.append(nameInput, handoffCancel);
  handoffBox.append(handoffRow, handoffConfirm);

  const form = document.createElement('form');
  form.className = 'erp-form';
  const input = document.createElement('textarea');
  input.className = 'erp-input';
  input.rows = 1;
  input.placeholder = t.placeholder;
  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'erp-send';
  sendBtn.setAttribute('aria-label', t.send);
  sendBtn.innerHTML = ICONS.send;
  form.append(input, sendBtn);

  panel.append(header, toolbar, messagesEl, handoffBox, form);
  root.append(panel, launcher);
  shadow.appendChild(root);
  document.body.appendChild(host);

  const scrollBottom = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };
  const notifyChime = () => {
    if (soundAllowed && !state.soundMuted) playChime();
  };
  const updateBadge = () => {
    if (unread > 0 && !isOpen) {
      badge.textContent = unread > 9 ? '9+' : String(unread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  };
  const updateSoundBtn = () => {
    soundBtn.innerHTML = state.soundMuted ? ICONS.soundOff : ICONS.soundOn;
    const label = state.soundMuted ? t.soundOff : t.soundOn;
    soundBtn.title = label;
    soundBtn.setAttribute('aria-label', label);
  };
  const updateModeUi = () => {
    if (state.guestToken) {
      statusText.textContent = t.managerJoined;
      toolbarLabel.textContent = t.managerJoined;
      toolbarBtn.textContent = t.backToAi;
      toolbar.classList.remove('hidden');
      handoffBox.classList.add('hidden');
    } else {
      statusText.textContent = t.online;
      if (config.handoffEnabled) {
        toolbarLabel.textContent = '';
        toolbarBtn.textContent = t.callManager;
        toolbar.classList.remove('hidden');
      } else {
        toolbar.classList.add('hidden');
      }
    }
  };

  const appendMessageEl = (msg: WidgetMessage): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = `erp-msg ${msg.role}`;
    if (msg.role === 'manager' && msg.senderName) {
      const sender = document.createElement('div');
      sender.className = 'erp-msg-sender';
      sender.textContent = msg.senderName;
      wrap.appendChild(sender);
    }
    const bubble = document.createElement('div');
    bubble.className = 'erp-bubble';
    renderSafeText(bubble, msg.content);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollBottom();
    return bubble;
  };

  const showNotice = (text: string) => {
    const el = document.createElement('div');
    el.className = 'erp-notice';
    el.textContent = text;
    messagesEl.appendChild(el);
    scrollBottom();
  };

  const renderAllMessages = () => {
    messagesEl.textContent = '';
    for (const m of state.messages) appendMessageEl(m);
  };

  const getLast10Ai = () =>
    state.messages.slice(-10).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));

  const stopPolling = () => {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const schedulePoll = () => {
    stopPolling();
    if (!state.guestToken) return;
    pollTimer = window.setTimeout(() => {
      void pollLiveChat(false);
    }, isOpen ? 3500 : 12000);
  };

  async function pollLiveChat(silent: boolean): Promise<void> {
    const guestToken = state.guestToken;
    if (!guestToken) return;
    try {
      const qs = lastServerMsgId ? `?after=${encodeURIComponent(lastServerMsgId)}` : '';
      const res = await fetch(`${apiBase}/public/chats/${encodeURIComponent(guestToken)}${qs}`);
      if (res.ok) {
        const data = (await res.json()) as { messages?: PublicChatMessageDto[] };
        const incoming = Array.isArray(data.messages) ? data.messages : [];
        let gotManagerReply = false;
        for (const dto of incoming) {
          if (knownIds.has(dto.id)) continue;
          knownIds.add(dto.id);
          lastServerMsgId = dto.id;
          const isManager = dto.senderMemberId !== null;
          const text = isManager ? (dto.translations?.[lang] || dto.originalText) : dto.originalText;
          const item: WidgetMessage = {
            id: dto.id,
            role: isManager ? 'manager' : 'user',
            content: text,
            senderName: isManager ? dto.senderName || t.manager : undefined,
          };
          state.messages.push(item);
          appendMessageEl(item);
          if (isManager) {
            gotManagerReply = true;
            if (!isOpen && !silent) unread += 1;
          }
        }
        if (incoming.length) saveState(token, state);
        if (gotManagerReply && !silent) {
          notifyChime();
          updateBadge();
        }
      }
    } catch {
      // Retry on next poll cycle
    } finally {
      schedulePoll();
    }
  }

  const setOpen = (next: boolean) => {
    isOpen = next;
    panel.classList.toggle('open', isOpen);
    launcher.setAttribute('aria-label', isOpen ? t.close : t.openChat);
    if (isOpen) {
      unread = 0;
      updateBadge();
      scrollBottom();
      input.focus();
      if (state.guestToken) void pollLiveChat(false);
    } else if (state.guestToken) {
      schedulePoll();
    }
  };

  launcher.addEventListener('click', () => setOpen(!isOpen));
  closeBtn.addEventListener('click', () => setOpen(false));
  soundBtn.addEventListener('click', () => {
    state.soundMuted = !state.soundMuted;
    saveState(token, state);
    updateSoundBtn();
  });

  toolbarBtn.addEventListener('click', () => {
    if (state.guestToken) {
      stopPolling();
      state.guestToken = null;
      state.sessionId = createSessionId();
      state.messages = config.greeting ? [{ role: 'assistant', content: config.greeting }] : [];
      knownIds.clear();
      lastServerMsgId = null;
      saveState(token, state);
      updateModeUi();
      renderAllMessages();
    } else {
      nameInput.value = state.visitorName;
      handoffBox.classList.toggle('hidden');
      if (!handoffBox.classList.contains('hidden')) nameInput.focus();
    }
  });

  handoffCancel.addEventListener('click', () => handoffBox.classList.add('hidden'));

  handoffBox.addEventListener('submit', async e => {
    e.preventDefault();
    if (isBusy) return;
    isBusy = true;
    handoffConfirm.disabled = true;
    const prevLabel = handoffConfirm.textContent;
    handoffConfirm.textContent = t.connecting;
    try {
      const visitorName = nameInput.value.trim();
      const res = await fetch(`${apiBase}/hooks/widget/${encodeURIComponent(token)}/handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.sessionId,
          visitorName: visitorName || undefined,
          pageUrl: location.href,
          locale: lang,
          messages: getLast10Ai(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { guestToken?: string };
      if (!data.guestToken) throw new Error('Missing guestToken');
      state.guestToken = data.guestToken;
      if (visitorName) state.visitorName = visitorName;
      saveState(token, state);
      updateModeUi();
      await pollLiveChat(true);
    } catch {
      showNotice(t.error);
    } finally {
      handoffConfirm.textContent = prevLabel;
      handoffConfirm.disabled = false;
      isBusy = false;
    }
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || isBusy) return;
    input.value = '';
    isBusy = true;
    sendBtn.disabled = true;

    if (state.guestToken) {
      try {
        const res = await fetch(`${apiBase}/public/chats/${encodeURIComponent(state.guestToken)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            guestName: state.visitorName || undefined,
            language: lang,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { message?: PublicChatMessageDto };
        const dto = data.message;
        const msg: WidgetMessage = { id: dto?.id, role: 'user', content: dto?.originalText ?? text };
        if (dto?.id) {
          knownIds.add(dto.id);
          lastServerMsgId = dto.id;
        }
        state.messages.push(msg);
        saveState(token, state);
        appendMessageEl(msg);
      } catch {
        showNotice(t.error);
      } finally {
        isBusy = false;
        sendBtn.disabled = false;
        input.focus();
      }
      return;
    }

    const userMsg: WidgetMessage = { role: 'user', content: text };
    state.messages.push(userMsg);
    saveState(token, state);
    appendMessageEl(userMsg);

    const typingWrap = document.createElement('div');
    typingWrap.className = 'erp-msg assistant';
    const typingDots = document.createElement('div');
    typingDots.className = 'erp-typing';
    typingDots.innerHTML = '<span></span><span></span><span></span>';
    typingWrap.appendChild(typingDots);
    messagesEl.appendChild(typingWrap);
    scrollBottom();

    let replyBubble: HTMLElement | null = null;
    let replyText = '';
    try {
      replyText = await streamAiReply(
        apiBase,
        token,
        {
          sessionId: state.sessionId,
          visitorName: state.visitorName || undefined,
          pageUrl: location.href,
          locale: lang,
          messages: getLast10Ai(),
          stream: true,
          website: '',
        },
        chunk => {
          if (!replyBubble) {
            typingWrap.remove();
            replyBubble = appendMessageEl({ role: 'assistant', content: '' });
          }
          replyText += chunk;
          renderSafeText(replyBubble, replyText);
          scrollBottom();
        },
      );
      if (typingWrap.isConnected) typingWrap.remove();
      const finalText = replyText.trim();
      if (finalText) {
        if (!replyBubble) appendMessageEl({ role: 'assistant', content: finalText });
        state.messages.push({ role: 'assistant', content: finalText });
        saveState(token, state);
        notifyChime();
        if (!isOpen) {
          unread += 1;
          updateBadge();
        }
      }
    } catch {
      if (typingWrap.isConnected) typingWrap.remove();
      showNotice(t.error);
    } finally {
      isBusy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });

  updateSoundBtn();
  updateModeUi();
  renderAllMessages();
  if (state.guestToken) void pollLiveChat(true);
}

async function init(): Promise<void> {
  if (typeof window === 'undefined' || window.__FUTURE_ERP_WIDGET_MOUNTED__) return;
  const scriptEl =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[data-token]');
  const token = scriptEl?.getAttribute('data-token')?.trim() ?? '';
  if (!token) return;

  window.__FUTURE_ERP_WIDGET_MOUNTED__ = true;

  const rawApi = scriptEl?.getAttribute('data-api')?.trim();
  const apiBase = (
    rawApi ||
    (scriptEl?.src ? `${new URL(scriptEl.src, location.href).origin}/api` : `${location.origin}/api`)
  ).replace(/\/+$/, '');
  const lang = resolveLang(scriptEl?.getAttribute('data-lang'));

  const config = await fetchWidgetConfig(apiBase, token, lang);
  if (!config) return;

  await waitForBody();
  mountWidget(apiBase, token, lang, config);
}

void init();
