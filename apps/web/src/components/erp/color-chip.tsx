/* Цветная плашка: мягкий фон и текст цвета из палитры статусов (gray, blue, amber…). Стиль — .color-chip в settings.css */
import * as React from 'react';

export const colorChipVar = (color: string) => `var(--${color})`;

export function ColorChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="color-chip" style={{ '--chip': colorChipVar(color) } as React.CSSProperties}>
      {children}
    </span>
  );
}
