import type { Widen } from '../types';
import type { help as H } from '../en/help';

export const help: Widen<typeof H> = {
  open: 'Ayuda',
  title: 'Ayuda',
  back: 'Atrás',
  toc: 'Contenido',
  searchPlaceholder: 'Buscar en la ayuda',
  searchResults: 'Resultados de búsqueda',
  noResults: 'No se encontró nada',
  moreForSection: 'Artículos sobre esta sección',
  noArticle: 'Aún no hay un artículo sobre esta sección. Seleccione uno del contenido.',
  cmdOpen: 'Ayuda',
  group: 'Ayuda',
  whatsNew: {
    title: 'Novedades',
    lead: 'Qué se añadió a FutureERP y cuándo. Las entradas están en ruso.',
    allModules: 'Todos los módulos',
    loadError: 'No se pudo cargar el registro de cambios',
  },
};
