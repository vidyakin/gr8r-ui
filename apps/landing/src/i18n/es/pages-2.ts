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
        title: 'Listas de materiales y producción paramétrica',
        text: 'La especificación reúne materias primas, semielaborados, operaciones y subproductos de salida (corte o desensamble). Con especificaciones paramétricas defines medidas, material y opciones en el pedido — consumos y costo se recalculan al instante.',
        list: [
          'Parámetros del producto (número, lista, casilla) y «dimensión de stock» para variantes sin inflar el catálogo',
          'Árbol multinivel de semielaborados de cualquier profundidad con prevención de ciclos',
          'Porcentaje de merma, residuos recuperables, gastos indirectos y plazo de fabricación en días',
        ],
        screen: 'Especificación paramétrica: parámetros, materiales, semielaborados y operaciones',
      },
      {
        title: 'Órdenes de producción y disponibilidad de materiales',
        text: 'Crea órdenes desde pedidos de clientes o por plan guardando una instantánea de la especificación. La ficha muestra la disponibilidad de materiales por almacén y reservas, permitiendo comprar faltantes o lanzar semielaborados en un clic.',
        list: [
          'Estados de «planificada» a «cerrada» y control de saldo pendiente de fabricar por línea',
          'Indicadores de disponibilidad por color y desglose de reservas por almacén',
          'Creación de órdenes de semielaborados, compras a proveedores y traslados a taller desde la orden',
        ],
        screen: 'Ficha de orden de producción con disponibilidad de materiales y reservas',
      },
      {
        title: 'Panel «Salida de producción», WIP y defectos',
        text: 'El encargado ve los pedidos pendientes y registra la salida por taller, fecha y etapa en una sola acción. Las etapas intermedias alimentan el trabajo en curso (WIP) y la final da entrada al producto terminado reservándolo para el pedido.',
        list: [
          'Modo simple para todo el resto; modo avanzado para entregas parciales, residuos recuperables y defectos',
          'Control de saldos y movimientos de WIP por taller y orden',
          'Catálogo de motivos de defecto y verificación atómica de materiales sin documentos parciales',
        ],
        screen: 'Panel «Salida de producción»: pedidos, etapas, WIP y registro de defectos',
      },
      {
        title: 'Etapas, pago a destajo y reparto de materiales por turno',
        text: 'Cada tipo de producción tiene su ruta de etapas. Los partes a destajo toman la tarifa vigente en la fecha, y el documento de reparto distribuye el consumo real de materiales del turno entre las salidas del taller.',
        list: [
          'Tarifas históricas por fecha: por unidad fabricada o por tiempo estándar',
          'Registro de producción directamente desde el bloque de operación en la tarea del operario',
          'Distribución del consumo real de materiales del turno entre salidas con ajuste manual',
        ],
        screen: 'Etapas de producción, parte a destajo y reparto de materiales por turno',
      },
      {
        title: 'Planificación de producción y cálculo de necesidades (MRP)',
        text: 'Elabora planes de producción por periodos a partir del historial de ventas, salidas y pedidos de clientes. El asistente MRP de 3 pasos calcula automáticamente qué comprar y qué fabricar.',
        list: [
          'Planes por periodo con pestañas «Necesidades» (materiales y horas frente a capacidad) y «Plan vs. real»',
          'Panel «Órdenes desde el plan» que genera borradores por la diferencia pendiente sin duplicados',
          'Asistente MRP en 3 pasos (Recomendaciones → Planificación → Órdenes) por horizonte, almacén y método',
        ],
        screen: 'Plan de producción por periodos y asistente MRP de cálculo de necesidades',
      },
      {
        title: 'Carga de equipos, talleres y calendarios de turnos',
        text: 'El planificador visual muestra la carga de operarios, talleres y equipos clave en una línea de tiempo. Arrastra operaciones para reprogramar y detecta sobrecargas al instante.',
        list: [
          'Planificador de carga con arrastrar y soltar por talleres, operarios y máquinas',
          'Catálogo de recursos clave y talleres con tarifas por hora',
          'Calendarios de turnos, festivos y excepciones (mantenimiento, vacaciones, bajas)',
        ],
        screen: 'Planificador de carga de talleres y equipos con calendarios de turnos',
      },
      {
        title: 'Cierre mensual, costos indirectos y maquila',
        text: 'Al cerrar el periodo, el asistente reúne costos directos e indirectos (alquiler, energía, amortización) y los distribuye entre las salidas. También incluye gestión completa de maquila con materia prima del cliente.',
        list: [
          'Documentos de «Otros gastos» por partida y taller con análisis previo al cierre',
          'Distribución automática de gastos indirectos por salida y anulación segura del cierre',
          'Maquila: órdenes de transformación, recepción de insumos del cliente, informes y saldos de terceros',
        ],
        screen: 'Asistente de cierre mensual con distribución de costos indirectos',
      },
      {
        title: 'Analítica de producción y reportes de costos',
        text: 'Nueve reportes integrados con agrupaciones desplegables, gráficos y exportación CSV. Los importes de costo están protegidos por rol: solo administradores y propietarios ven las columnas monetarias.',
        list: [
          'Plan vs. real de salidas y de costos destacando sobrecostos y ahorros de materiales',
          'Desglose del costo de salida por partidas directas e indirectas y explosión estándar de BOM',
          'Reportes de órdenes, movimiento de WIP, carga de talleres, defectos y trazabilidad bidireccional de lotes (desde el proveedor de materia prima hasta el envío al cliente)',
        ],
        screen: 'Reportes de producción: plan vs. real de costos, salidas, WIP y defectos',
      },
    ],
    chain: [
      ['docs', 'Pedido de cliente con artículos (incluso paramétricos) cuyo reabastecimiento es producción.'],
      ['production', 'Cálculo MRP, planes y órdenes de producción, salida por etapas y cierre mensual.'],
      ['sales', 'Desde el pedido se emite la entrega; el producto reservado sale con su costo real.'],
      ['payroll', 'El importe a destajo pasa de los partes contabilizados a la nómina.'],
    ],
    faq: [
      ['¿Admite productos paramétricos a medida (muebles, ventanas, carpintería metálica)?', 'Sí. Defines parámetros (número, lista, casilla) y dimensiones de stock en la especificación. Al introducir valores en el pedido, el sistema recalcula consumos y costo sin crear miles de fichas.'],
      ['¿Cómo funciona el cálculo de necesidades (MRP)?', 'El asistente en 3 pasos (Recomendaciones → Planificación → Órdenes) analiza stock, reservas, pedidos y planes en el horizonte elegido y crea borradores de compras y producción.'],
      ['¿Qué pasa si faltan materiales?', 'No se registra la salida: la transacción se revierte entera. Los faltantes pueden pedirse a proveedores o trasladarse al taller directamente desde la orden.'],
      ['¿Cómo se calcula el costo total con gastos indirectos?', 'Los gastos indirectos se registran en «Otros gastos» por partida y taller, y el cierre mensual los distribuye automáticamente entre las salidas del periodo.'],
      ['¿Cómo se calcula el pago a destajo?', 'Según la tarifa vigente en la fecha del parte: por unidad o por hora estándar. Se puede ajustar antes de contabilizar y luego pasa a la nómina.'],
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
      {
        title: 'Almacenamiento por ubicaciones y trazabilidad de origen / aduanas',
        text: 'Activa el almacenamiento por celdas de forma opcional en cada almacén y rastrea el país de origen y los datos de declaración aduanera por lote desde la recepción hasta la entrega y los formularios.',
        list: [
          'Jerarquía opcional de ubicaciones por almacén: zona, estantería, nivel y celda',
          'Saldos en tiempo real por ubicación con operaciones de ubicación, picking y traslados entre celdas',
          'Seguimiento de país de origen y número de declaración aduanera por lote en recepciones y entregas',
          'Datos de origen y aduanas trasladados automáticamente a documentos de salida y formularios imprimibles',
        ],
        screen: 'Jerarquía de ubicaciones de almacén con saldos por celda y trazabilidad de origen y aduanas por lote',
      },
      {
        title: 'Kits de productos y gastos adicionales al costo (Landed Cost)',
        text: 'Vende kits y combos sin lanzar órdenes de producción: sus componentes se descuentan automáticamente del almacén. Reparte fletes, aranceles y maniobras tras la recepción recalculando el costo promedio y lo ya enviado.',
        list: [
          'Kits de productos: composición en el catálogo, descuento/devolución automática de componentes y reparto exacto del precio',
          'Documento de gastos adicionales: vinculado a recepciones y salidas de producción con referencia a la factura del proveedor',
          'Reparto por importe, cantidad, peso o manual con precisión de centavos e informe por partida de gasto',
        ],
        screen: 'Kits de productos en el catálogo y reparto de gastos adicionales al costo',
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
      ['¿Incluye ubicaciones de almacén y control de origen o aduanas?', 'Sí. Puedes activar opcionalmente el almacenamiento por ubicaciones en cada almacén (jerarquía zona/estantería/nivel/celda, saldos por celda, ubicación, picking y traslados) y registrar país de origen y número de declaración aduanera por lote en recepciones, entregas y formularios imprimibles.'],
    ],
  },
};
