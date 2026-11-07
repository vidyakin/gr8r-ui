/* Событие «открыто окно» для аналитики (analytics.ts): один раз при появлении компонента.
   name — стабильное имя места вызова; без него отправляется «unnamed», чтобы пробел был виден в отчёте. */
import * as React from 'react';
import { trackOpen } from './analytics';

export function useTrackOpen(kind: string, name?: string) {
  React.useEffect(() => {
    trackOpen(kind, name ?? 'unnamed');
  }, [kind, name]);
}
