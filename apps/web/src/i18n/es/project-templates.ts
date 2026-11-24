/* Plantillas de proyectos: lista en configuración, «Guardar como plantilla», creación de proyecto desde plantilla */
import type { Widen } from '../types';
import type { projectTemplates as E } from '../en/project-templates';

export const projectTemplates: Widen<typeof E> = {
  settings: {
    lead: 'Proyecto guardado como plantilla: tareas con subtareas, plazos como «día N desde el inicio» y responsables por cargo. Crea nuevos proyectos a partir de ella indicando la fecha de inicio.',
    onlyAdmins: 'Solo los administradores y propietarios pueden renombrar, desactivar o eliminar plantillas.',
    empty: 'Aún no hay plantillas de proyecto',
    emptyHint: 'Abre un proyecto y selecciona «Guardar como plantilla» en su menú.',
    summary: '{tasks} tareas, {subtasks} subtareas',
    duration: 'Duración: {days} días',
    disabled: 'Desactivada',
    disabledHint: 'Una plantilla desactivada queda oculta al crear un nuevo proyecto.',
    nameLabel: 'Nombre',
    rename: 'Renombrar',
    save: 'Guardar',
    cancel: 'Cancelar',
    enable: 'Activar',
    disable: 'Desactivar',
    delete: 'Eliminar',
    confirmDelete: '¿Eliminar la plantilla «{name}»? Los proyectos creados a partir de ella se conservarán tal como están.',
    renamed: 'Plantilla renombrada',
    enabledToast: 'Plantilla activada',
    disabledToast: 'Plantilla desactivada',
    deleted: 'Plantilla eliminada',
  },
  save: {
    menu: 'Guardar como plantilla',
    title: 'Guardar proyecto como plantilla',
    lead: 'Se guardan los estados, hitos, tareas con subtareas y listas de verificación. Los plazos pasan a ser «día N desde el inicio», los responsables pasan a ser cargos y las tareas completadas vuelven al estado pendiente.',
    nameLabel: 'Nombre de la plantilla',
    descLabel: 'Descripción',
    submit: 'Guardar plantilla',
    saved: 'Plantilla «{name}» guardada',
  },
  create: {
    label: 'Plantillas guardadas',
    startLabel: 'Fecha de inicio',
    startHint: 'El día 1 de la plantilla corresponde a la fecha de inicio.',
    tasks: '{tasks} tareas',
    created: 'Proyecto «{name}» creado desde la plantilla: {count} tareas',
  },
};
