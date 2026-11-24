/* Self-contained Shadow DOM styles for the FutureERP embeddable chat widget. */

export const WIDGET_STYLES = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Helvetica, Arial, sans-serif;
  color: #0f172a;
  --erp-accent: #2563eb;
  --erp-bg: #ffffff;
  --erp-surface: #f1f5f9;
  --erp-border: #e2e8f0;
  --erp-text: #0f172a;
  --erp-muted: #64748b;
  --erp-radius: 16px;
}
*, *::before, *::after { box-sizing: border-box; }

.erp-root {
  position: fixed;
  bottom: 20px;
  z-index: 2147483000;
  font-size: 14px;
  line-height: 1.45;
}
.erp-root.pos-right { right: 20px; }
.erp-root.pos-left { left: 20px; }

.erp-launcher {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  border: none;
  background: var(--erp-accent);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.28), 0 4px 10px -4px rgba(15, 23, 42, 0.18);
  transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
}
.erp-launcher:hover { transform: translateY(-2px) scale(1.03); }
.erp-launcher:active { transform: scale(0.97); }
.erp-launcher svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.erp-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
}
.erp-badge.hidden { display: none; }

.erp-panel {
  position: fixed;
  bottom: 88px;
  width: 380px;
  max-width: calc(100vw - 32px);
  height: 540px;
  max-height: calc(100dvh - 110px);
  background: var(--erp-bg);
  border: 1px solid var(--erp-border);
  border-radius: var(--erp-radius);
  box-shadow: 0 22px 50px -12px rgba(15, 23, 42, 0.28), 0 4px 14px -4px rgba(15, 23, 42, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  opacity: 0;
  transform: translateY(12px) scale(0.98);
  pointer-events: none;
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.erp-root.pos-right .erp-panel { right: 20px; }
.erp-root.pos-left .erp-panel { left: 20px; }
.erp-panel.open { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }

.erp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  background: var(--erp-accent);
  color: #fff;
  flex-shrink: 0;
}
.erp-header-info { min-width: 0; flex: 1; }
.erp-title { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.erp-subtitle { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.9; margin-top: 1px; }
.erp-dot { width: 7px; height: 7px; border-radius: 999px; background: #4ade80; flex-shrink: 0; }

.erp-header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.erp-icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}
.erp-icon-btn:hover { background: rgba(255, 255, 255, 0.28); }
.erp-icon-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.erp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  background: #f8fafc;
  border-bottom: 1px solid var(--erp-border);
  font-size: 12px;
  color: var(--erp-muted);
  flex-shrink: 0;
}
.erp-toolbar.hidden { display: none; }
.erp-pill-btn {
  border: 1px solid var(--erp-border);
  background: #fff;
  color: var(--erp-text);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.erp-pill-btn:hover { border-color: var(--erp-accent); color: var(--erp-accent); }

.erp-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #ffffff;
}
.erp-msg { display: flex; flex-direction: column; max-width: 85%; }
.erp-msg.user { align-self: flex-end; align-items: flex-end; }
.erp-msg.assistant, .erp-msg.manager { align-self: flex-start; align-items: flex-start; }
.erp-msg-sender { font-size: 11px; color: var(--erp-muted); margin: 0 4px 3px; font-weight: 500; }

.erp-bubble {
  padding: 9px 12px;
  border-radius: 14px;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.erp-msg.user .erp-bubble { background: var(--erp-accent); color: #fff; border-bottom-right-radius: 4px; }
.erp-msg.assistant .erp-bubble { background: var(--erp-surface); color: var(--erp-text); border-bottom-left-radius: 4px; }
.erp-msg.manager .erp-bubble { background: #eff6ff; color: var(--erp-text); border: 1px solid #dbeafe; border-bottom-left-radius: 4px; }
.erp-bubble a { color: inherit; text-decoration: underline; }

.erp-notice {
  align-self: center;
  font-size: 12px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  padding: 6px 10px;
  border-radius: 10px;
  text-align: center;
}

.erp-typing { display: inline-flex; align-items: center; gap: 4px; padding: 10px 14px; background: var(--erp-surface); border-radius: 14px; border-bottom-left-radius: 4px; }
.erp-typing span { width: 6px; height: 6px; border-radius: 999px; background: var(--erp-muted); animation: erp-bounce 1.2s infinite ease-in-out; }
.erp-typing span:nth-child(2) { animation-delay: 0.15s; }
.erp-typing span:nth-child(3) { animation-delay: 0.3s; }
@keyframes erp-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.45; } 40% { transform: translateY(-4px); opacity: 1; } }

.erp-handoff-box {
  padding: 10px 12px;
  background: #f8fafc;
  border-top: 1px solid var(--erp-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.erp-handoff-box.hidden { display: none; }
.erp-handoff-row { display: flex; gap: 6px; }
.erp-handoff-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--erp-border);
  border-radius: 10px;
  font: inherit;
  font-size: 13px;
  outline: none;
  background: #fff;
  color: var(--erp-text);
}
.erp-handoff-input:focus { border-color: var(--erp-accent); }
.erp-btn-primary {
  border: none;
  background: var(--erp-accent);
  color: #fff;
  padding: 7px 12px;
  border-radius: 10px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.erp-btn-ghost {
  border: 1px solid var(--erp-border);
  background: #fff;
  color: var(--erp-muted);
  padding: 7px 10px;
  border-radius: 10px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.erp-form {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--erp-border);
  background: #fff;
  flex-shrink: 0;
}
.erp-input {
  flex: 1;
  resize: none;
  border: 1px solid var(--erp-border);
  border-radius: 12px;
  padding: 9px 12px;
  font: inherit;
  font-size: 14px;
  line-height: 1.35;
  max-height: 96px;
  min-height: 38px;
  outline: none;
  color: var(--erp-text);
  background: #f8fafc;
}
.erp-input:focus { border-color: var(--erp-accent); background: #fff; }
.erp-send {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  border: none;
  background: var(--erp-accent);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.15s ease;
}
.erp-send:disabled { opacity: 0.45; cursor: not-allowed; }
.erp-send svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

@media (max-width: 480px) {
  .erp-root.pos-right, .erp-root.pos-left { right: 14px; left: auto; bottom: 14px; }
  .erp-root.pos-left { left: 14px; right: auto; }
  .erp-panel, .erp-root.pos-right .erp-panel, .erp-root.pos-left .erp-panel {
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-width: 100%;
    height: 85dvh;
    max-height: 85dvh;
    border-radius: 16px 16px 0 0;
  }
}
`;
