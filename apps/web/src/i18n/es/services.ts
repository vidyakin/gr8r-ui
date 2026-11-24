/* Informes de servicios */
import type { Widen } from '../types';
import type { serviceReports as S } from '../en/services';

export const serviceReports: Widen<typeof S> = {
  title: 'Informes de servicios',
  subtitle: 'Estados de órdenes de trabajo, desviaciones de programación, carga de especialistas y analítica de clientes. Haga clic en una fila para abrir el documento.',
  tabs: 'Informes',
  tab: { states: 'Estados de órdenes de trabajo', schedule: 'Desviaciones de programación', load: 'Carga de especialistas', clients: 'Clientes' },
  filters: { from: 'Desde', to: 'Hasta', client: 'Cliente', clientPlaceholder: 'Cualquier cliente', clearClient: 'Limpiar cliente', assignee: 'Asignado', allAssignees: 'Todos los asignados', kind: 'Tipo de orden de trabajo', allKinds: 'Todos los tipos' },
  noDate: 'Sin fecha',
  draft: 'Borrador',
  states: {
    chart: 'Órdenes de trabajo por estado',
    orders: 'Órdenes de trabajo',
    overdueSeries: 'Vencidas',
    hint: 'Vencida: la fecha límite ha pasado y la orden no está finalizada, entregada ni cancelada, o una asignación sigue abierta después de su fin previsto.',
    group: { kind: 'Tipo', state: 'Estado' },
    col: { document: 'Orden de trabajo', date: 'Fecha', client: 'Cliente', due: 'Fecha límite', overdue: 'Retraso', planned: 'Plan, h', actual: 'Real, h', done: 'Avance, %', amount: 'Importe sin IVA', total: 'Total' },
    reason: { due: 'por fecha límite', assignment: 'por asignación' },
    overdueDays: { one: '{count} día', other: '{count} días' },
  },
  schedule: {
    chart: 'Horas planificadas y reales por asignado',
    hint: 'Asignaciones cuyo fin planificado cae dentro del período (sin fechas, por la fecha del documento). Las asignaciones abiertas se comparan con la fecha de hoy.',
    group: { assignee: 'Asignado', order: 'Orden de trabajo' },
    noAssignee: 'Sin asignado',
    col: { task: 'Asignación', planned: 'Plan, h', actual: 'Real, h', deviationHours: 'Desviación, h', plannedEnd: 'Fin planificado', closed: 'Cerrada', deviationDays: 'Desviación, días' },
    open: 'Abierta',
  },
  load: {
    chart: 'Horas disponibles, planificadas y reales por especialista',
    hint: 'El tiempo disponible sigue el calendario del colaborador. El plan se distribuye entre los días del intervalo de asignación; sin intervalo, va a la fecha límite de la tarea y luego a la del documento.',
    group: { member: 'Especialista' },
    col: { date: 'Fecha', capacity: 'Disponible, h', planned: 'Plan, h', fact: 'Real, h', plannedPct: 'Carga planificada', factPct: 'Carga real', overload: 'Sobrecarga' },
    overloaded: 'Sobrecargado',
  },
  clients: {
    chart: 'Ingresos por cliente',
    revenueSeries: 'Ingresos',
    costSeries: 'Costo',
    hint: 'Ingresos sin IVA: órdenes de trabajo completadas más actas contabilizadas y entregas menos devoluciones de clientes. Los filtros de tipo y asignado aplican solo a órdenes de trabajo.',
    noClient: 'Sin cliente',
    col: { client: 'Cliente', orders: 'Órdenes de trabajo', documents: 'Documentos', services: 'Trabajos y servicios', goods: 'Productos', revenue: 'Ingresos', cost: 'Costo', margin: 'Margen', marginPct: 'Margen, %' },
  },
  companyDocuments: {
    type: 'Tipo de documento',
    allTypes: 'Todos los tipos',
    ariaLabel: 'Documentos de la empresa',
    col: { document: 'Documento', type: 'Tipo', date: 'Fecha', state: 'Estado', status: 'Situación', amount: 'Importe sin IVA', total: 'Total' },
    sum: 'Total de la selección (sin cancelados)',
    sumHint: 'Elija un tipo de documento para ver los totales: los pedidos, facturas y actas de una misma venta no se suman entre sí.',
    emptyTitle: 'Aún no hay documentos',
    emptyHint: 'Los documentos de esta empresa aparecerán aquí.',
    loadFailed: 'No se pudieron cargar los documentos',
    retry: 'Reintentar',
  },
};
