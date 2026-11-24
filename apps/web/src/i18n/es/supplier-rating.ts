/* Valoración de proveedores: pantalla, tarjeta de detalle, configuración de pesos y política para nivel D */
import type { Widen } from '../types';
import type { supplierRating as S } from '../en/supplier-rating';

export const supplierRating: Widen<typeof S> = {
  title: 'Valoración de proveedores',
  lead: 'Puntualidad de entrega, integridad y calidad de los suministros en el período. Se calcula a partir de los documentos contabilizados.',
  period: {
    from: 'Período desde',
    to: 'hasta',
    reset: 'Últimos 12 meses',
  },
  col: {
    supplier: 'Proveedor',
    orders: 'Pedidos',
    onTime: 'A tiempo, %',
    completeness: 'Integridad, %',
    quality: 'Calidad, %',
    total: 'Puntuación',
    level: 'Nivel',
  },
  /** Insignia en la ficha de contraparte: «Nivel A» */
  companyBadge: 'Nivel {level}',
  companyBadgeHint: 'Valoración del proveedor en los últimos 12 meses',
  empty: {
    title: 'Sin valoraciones en este período',
    hint: 'La valoración se calcula a partir de los pedidos a proveedor y recepciones contabilizados.',
  },
  loadError: 'No se pudo cargar la valoración de proveedores',
  detail: {
    title: 'Valoración del proveedor',
    period: 'Período',
    ordersWithDueDate: 'Pedidos con fecha límite',
    onTimeOrders: 'A tiempo',
    orderedQty: 'Pedido',
    receivedQty: 'Recibido',
    rejectedQty: 'Rechazado',
    returnedQty: 'Devuelto',
    noData: 'Sin datos para este período',
  },
  settings: {
    open: 'Configurar valoración',
    title: 'Configuración de valoración de proveedores',
    lead: 'Cómo se ponderan los indicadores en la puntuación y qué ocurre cuando un proveedor tiene nivel D.',
    weights: 'Pesos de los indicadores',
    weightsHint: 'La puntuación es una media ponderada de los indicadores con datos. Los pesos pueden ser cualquier número no negativo.',
    onTime: 'Puntualidad',
    completeness: 'Integridad',
    quality: 'Calidad',
    dPolicy: 'Cuando un proveedor obtiene nivel D',
    dPolicyHint: 'Se comprueba al contabilizar un pedido a proveedor.',
    policy: {
      none: 'No hacer nada',
      warn: 'Advertir',
      block: 'Bloquear el pedido',
    },
    onlyAdmins: 'Solo el propietario y los administradores del espacio pueden cambiar la configuración de valoración.',
    save: 'Guardar configuración',
    saved: 'Guardado',
    badWeights: 'Los pesos deben ser mayores o iguales a cero, y al menos uno mayor que cero.',
  },
};
