/* Прежние версии лендинга по адресу /old: «classic» — первая страница (App), «silk» и «wave» — вариант alternative
   с шейдерным и волновым фоном (бывшие /v2 и /v3). Оставлены для сравнения, удалить после переезда на Astro */
import { StrictMode, lazy, Suspense } from 'react';
import '../styles.css';
import { App } from '../App';

const AlternativeLanding = lazy(() => import('../alternative/AlternativeLanding'));

export type OldVariant = 'classic' | 'silk' | 'wave';

export default function OldRoot({ variant }: { variant: OldVariant }) {
  return (
    <StrictMode>
      {variant === 'classic' ? (
        <App />
      ) : (
        <Suspense fallback={null}>
          <AlternativeLanding background={variant} />
        </Suspense>
      )}
    </StrictMode>
  );
}
