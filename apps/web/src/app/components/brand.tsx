/* Логотип FutureERP и иконка воркспейса — порт LOGO / MARK / wsLogo из core/icons.js */
import type { WorkspaceInfo } from '../data/types';

/** Словесный знак приложения: высота задаёт размер шрифта */
export function Logo({ height = 22 }: { height?: number }) {
  return (
    <span className="logo" role="img" aria-label="FutureERP" style={{ display: 'inline-block', fontSize: Math.round(height * 0.95), lineHeight: 1, fontWeight: 700, letterSpacing: '-0.03em', whiteSpace: 'nowrap' }}>
      Future<span style={{ opacity: 0.55 }}>ERP</span>
    </span>
  );
}

export function WorkspaceLogo({ ws, size = 22 }: { ws: WorkspaceInfo; size?: number }) {
  // знак приложения: буква F на чёрном квадрате
  if (ws.brand)
    return (
      <span className="ws-logo brand" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="6" fill="#000" />
          <text x="16" y="23" textAnchor="middle" fontSize="20" fontWeight="700" fontFamily="inherit" fill="#fff">F</text>
        </svg>
      </span>
    );
  return (
    <span className="ws-logo" style={{ '--c': ws.c, width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.46)) } as React.CSSProperties}>
      {ws.name[0]}
    </span>
  );
}
