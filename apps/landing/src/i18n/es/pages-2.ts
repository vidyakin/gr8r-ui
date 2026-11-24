/* Diccionario en español — páginas de módulos (services, production, sales) */
import type { Dict } from '../types';

export const esPages2: Pick<Dict['modulePages'], 'services' | 'production' | 'sales'> = {
  services: {
    features: [
      {
        title: 'Reserva de especialistas',
        text: 'Cada especialista tiene su horario: duración de turno y horas laborales por día. Consulta la vista diaria de todo el equipo o la semana de una persona.',
        list: ['Turnos de 15, 30, 45, 60 o 90 minutos', 'Feriados y excepciones por fecha', 'Evita citas superpuestas o fuera de horario', 'Reprogramación rápida a otro horario o especialista'],
        screen: 'Agenda diaria: columnas de especialistas, citas y huecos libres',
      },
      {
        title: 'Estados de visita e historial',
        text: 'La cita avanza de «agendado» a «asistió». El día anterior el responsable recibe un recordatorio para confirmar. Las ausencias y cancelaciones liberan el turno.',
        list: ['Estados: agendado, confirmado, asistió, no asistió, cancelado', 'Registro de motivo de cancelación', 'Pestaña «Citas» en el cliente: próximas, pasadas y ausencias'],
        screen: 'Ficha de cita con estado, cliente y botones «Asistió» y «No asistió»',
      },
      {
        title: 'Cierre diario del especialista',
        text: 'El documento «Servicios prestados del día» se completa desde las citas con estado «asistió». Al contabilizar genera un acta o entrega por cliente.',
        list: ['Un documento por especialista y fecha', 'Lista de días sin cerrar y alertas para equipo y gerencia', 'Ingresos, saldo del cliente y baja de insumos automáticos'],
        screen: 'Pestaña «Días sin cerrar» con jornadas pendientes de cierre',
      },
      {
        title: 'Órdenes de trabajo y costos',
        text: 'La orden de trabajo reúne mano de obra, materiales y técnicos en un solo documento. La empresa define estados y al marcar «completada» se contabiliza.',
        list: ['Los técnicos son tareas con horas planificadas por estándar', 'Costo laboral = horas × tarifa de taller, más materiales', 'Margen visible solo para administradores y propietarios'],
        screen: 'Registro de órdenes de trabajo con estados, costo y margen',
      },
    ],
    chain: [
      ['crm', 'Cliente: contacto o empresa; un particular con teléfono se crea directo al agendar.'],
      ['services', 'Cita y luego orden de trabajo con mano de obra y materiales.'],
      ['tasks', 'El técnico asignado es una tarea con horas planificadas que van al parte.'],
      ['sales', 'La orden completada se contabiliza como venta: ingresos, saldo y baja de insumos.'],
    ],
    faq: [
      ['¿Se puede agendar a un cliente sin ficha previa en el CRM?', 'Sí. Puedes crear un particular con su teléfono directamente en el cuadro de cita.'],
      ['¿Qué ocurre si el cliente no asiste?', 'La cita pasa a «no asistió» y se libera el horario. Las ausencias quedan en la pestaña Citas del cliente.'],
      ['¿Cómo se calcula el costo de una orden de trabajo?', 'Mano de obra (horas × tarifa de taller) más materiales al costo promedio del almacén y otros gastos directos. El margen es ingreso menos costo.'],
      ['¿Quién puede ver costos y márgenes?', 'Solo administradores y propietarios. Para el resto, esas columnas aparecen vacías.'],
    ],
  },
  production: {
    features: [
      {
        title: 'Listas de materiales (BOM)',
        text: 'La especificación del producto incluye materias primas, semielaborados y operaciones. Un semielaborado puede fabricarse a stock o desplegarse hasta insumos en la misma orden.',
        list: ['Porcentaje de merma por material', 'Árbol multinivel con prevención de ciclos', 'Gastos indirectos en porcentaje y plazo de fabricación en días'],
        screen: 'Especificación de producto: materiales, semielaborados y operaciones',
      },
      {
        title: 'Órdenes de producción',
        text: 'Crea órdenes desde pedidos de clientes o por planificación. Pasan de «planificada» a «cerrada» guardando una instantánea de la especificación.',
        list: ['Estados: planificada, en curso, completada, cerrada', 'Saldo pendiente de fabricar por línea del pedido', 'No se puede fabricar más de lo pedido'],
        screen: 'Registro de órdenes de producción con sus estados',
      },
      {
        title: 'Panel «Salida de producción»',
        text: 'El encargado ve los pedidos pendientes: pedido, fabricado, enviado y restante. Con una acción genera el documento de salida.',
        list: ['Modo simple para todo el resto; modo avanzado para cantidades parciales', 'Un documento por taller, fecha y etapa', 'Si faltan materiales, la operación se cancela por completo', 'El producto terminado se reserva para el pedido del cliente'],
        screen: 'Panel «Salida de producción» con pedidos y etapas',
      },
      {
        title: 'Etapas y pago a destajo',
        text: 'Cada tipo de producción tiene sus etapas; solo la última da entrada al producto terminado. El parte a destajo toma la tarifa vigente en su fecha.',
        list: ['Tarifas históricas por fecha', 'Pago por unidad fabricada o por tiempo estándar', 'Costo real calculado en el cierre mensual'],
        screen: 'Catálogo de etapas de producción y parte a destajo',
      },
    ],
    chain: [
      ['docs', 'Pedido de cliente con artículos cuyo reabastecimiento es producción.'],
      ['production', 'Orden de producción y salida por etapas; el producto se reserva para el pedido.'],
      ['sales', 'Desde el pedido se emite la entrega y el producto sale del almacén.'],
      ['payroll', 'El importe a destajo pasa de los partes contabilizados a la nómina.'],
    ],
    faq: [
      ['¿Qué pasa si faltan materiales?', 'No se registra la salida: la transacción se revierte entera y no crea documentos parciales.'],
      ['¿Se puede producir más de lo pedido?', 'No. El sistema controla el pendiente por línea y rechaza excedentes.'],
      ['¿Es obligatorio indicar el taller?', 'Sí. Sin taller fabricante no se registra la salida; los almacenes se toman de su configuración.'],
      ['¿Cómo se calcula el pago a destajo?', 'Según la tarifa vigente en la fecha del parte: por unidad o por hora estándar. Se puede ajustar antes de contabilizar.'],
    ],
  },
  sales: {
    features: [
      {
        title: 'Del pedido a la entrega',
        text: 'El pedido de cliente controla cada línea: pedido, cumplido y planificado. Facturas, entregas y actas se generan directamente desde el pedido.',
        list: ['Fecha de envío por línea del pedido', 'El cumplimiento nunca supera lo pedido', 'Devolución de cliente creada desde la entrega'],
        screen: 'Registro de pedidos de clientes con saldos pendientes de envío',
      },
      {
        title: 'Almacén y reservas',
        text: 'Contabilizar una entrega actualiza el almacén al instante. Existencias y costo promedio se actualizan en la misma transacción sin dejar stock negativo.',
        list: ['Reserva por pedido: pedido menos entregado', 'Disponible: existencia menos reservas', 'Los servicios no mueven inventario'],
        screen: 'Informe de existencias con columnas de reservado y disponible',
      },
      {
        title: 'Cobros y saldos',
        text: 'Registra cobros por caja o banco, incluso a partir de una factura, pedido o entrega. El saldo del cliente es visible en su ficha.',
        list: ['Rubro de flujo de caja en cada línea de pago', 'Importación de extractos bancarios desde archivo', 'Indicador de estado de cobro en los listados', 'Saldo negativo en caja avisa sin bloquear el registro'],
        screen: 'Registro de pagos: ingresos, egresos y saldos de caja y banco',
      },
      {
        title: 'Informe P&L de ventas y análisis ABC',
        text: 'Controla el beneficio bruto y el margen sin hojas de cálculo. El costo se fija al contabilizar la entrega para que los períodos cerrados no cambien, y el análisis ABC destaca los productos clave por ingresos y beneficio.',
        list: [
          'Informe P&L con 6 agrupaciones: producto, categoría, cliente, gestor, organización y almacén',
          'Costo fijado al contabilizar la entrega para obtener beneficio bruto y margen exactos',
          'Análisis ABC del surtido por ingresos y beneficio con umbrales configurables (80/15/5% por defecto)',
          'Exportación en un clic de los informes P&L y ABC a XLSX',
        ],
        screen: 'Informe P&L de ventas y análisis ABC del surtido con exportación a XLSX',
      },
      {
        title: 'Códigos de barras EAN-13, etiquetas y precios',
        text: 'Genera códigos de barras internos EAN-13 de forma individual o masiva e imprime etiquetas y carteles de precio directamente desde el catálogo o las recepciones con vista previa en PDF.',
        list: [
          'Generación individual y masiva de códigos internos EAN-13 con dígito de control',
          'Etiquetas imprimibles de 58×40 y 43×25 mm para impresoras térmicas',
          'Carteles de precio en formato A6 y cuadrícula A4 con vista previa en vivo y exportación PDF',
          'Impresión directa desde el catálogo de productos o desde recepciones contabilizadas',
        ],
        screen: 'Vista previa de etiquetas 58×40 mm y carteles de precio A6/A4 con códigos EAN-13',
      },
    ],
    chain: [
      ['docs', 'Presupuesto, pedido y factura creados en cadena.'],
      ['sales', 'La entrega se contabiliza: almacén, ingresos y saldo por cobrar.'],
      ['logistics', 'La entrega logística se gestiona desde el pedido o la entrega.'],
      ['crm', 'Los ingresos de entregas contabilizadas alimentan el informe de canales.'],
    ],
    faq: [
      ['¿Se puede enviar un pedido en partes?', 'Sí. Cada entrega se genera sobre el saldo pendiente hasta completar el pedido.'],
      ['¿Qué ocurre si falta stock?', 'La contabilización verifica el stock físico. Las reservas de otros pedidos no bloquean el envío.'],
      ['¿Qué pasa si falta efectivo en caja?', 'El sistema muestra una advertencia de saldo negativo, pero permite contabilizar.'],
      ['¿Cómo se registra una devolución?', 'La devolución de cliente se crea desde la entrega; la de proveedor, desde la recepción.'],
      ['¿Cómo se calculan el P&L y el análisis ABC?', 'El costo queda fijado al contabilizar la entrega. El P&L muestra beneficio bruto y margen en 6 agrupaciones (producto, categoría, cliente, gestor, organización y almacén), y el análisis ABC clasifica el surtido por ingresos y beneficio con umbrales configurables 80/15/5 y exportación a XLSX.'],
      ['¿Qué formatos de etiquetas y carteles de precio están disponibles?', 'Puedes generar códigos EAN-13 individuales o masivos y exportar PDF con vista previa para etiquetas de 58×40 y 43×25 mm y carteles de precio A6 o cuadrícula A4 desde el catálogo o las recepciones.'],
    ],
  },
};
