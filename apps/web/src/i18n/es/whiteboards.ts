/* Pizarras interactivas (whiteboards): diccionario en español */
import type { Widen } from '../types';
import type { whiteboards as E } from '../en/whiteboards';

export const whiteboards: Widen<typeof E> = {
  title: 'Pizarras',
  subtitle: 'Pizarras visuales para lluvias de ideas, mapeo de proyectos y tarjetas ERP/CRM en vivo',
  search: 'Buscar pizarras…',
  newBoard: 'Nueva pizarra',
  blankBoard: 'Pizarra en blanco',
  defaultTitle: 'Pizarra sin título',
  templatesTitle: 'Plantillas rápidas',
  templatesHint: 'Comienza con un diseño prediseñado',
  elements: { one: '{count} elemento', other: '{count} elementos' },
  empty: {
    title: 'Aún no hay pizarras',
    hint: 'Crea una pizarra en blanco o elige una plantilla arriba para empezar a colaborar.',
    noResults: 'Ninguna pizarra coincide con tu búsqueda',
  },
  deleteTitle: 'Eliminar pizarra',
  deleteConfirm: '¿Eliminar «{name}»? Esta acción no se puede deshacer.',
  delete: 'Eliminar',
  cancel: 'Cancelar',
  back: 'Volver',
  titlePlaceholder: 'Título de la pizarra',
  saving: 'Guardando…',
  saved: 'Guardado',
  saveError: 'No se pudieron guardar los cambios',
  loadFailed: 'No se pudo cargar la pizarra',
  notFound: 'Pizarra no encontrada',
  picker: {
    title: 'Añadir tarjeta ERP/CRM',
    description: 'Elige una tarea, negociación o empresa para colocarla en la pizarra como tarjeta en vivo',
    search: 'Buscar por título o nombre…',
    tabs: {
      tasks: 'Tareas',
      deals: 'Negociaciones',
      companies: 'Empresas',
    },
    empty: 'No se encontró nada',
    loading: 'Cargando…',
  },
  toast: {
    taskCreated: 'Tarea «{title}» creada',
    noProjectForTask: 'Crea primero un proyecto activo para convertir notas adhesivas en tareas',
    deleted: 'Pizarra eliminada',
    created: 'Pizarra creada',
  },
};
