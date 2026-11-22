/* Diccionario en español — páginas de módulos (ui, tasks, crm, docs) */
import type { Dict } from '../types';

export const esPages1: Pick<Dict['modulePages'], 'ui' | 'tasks' | 'crm' | 'docs'> = {
  ui: {
    nav: 'Página del módulo',
    all: 'Todos los módulos',
    demo: 'Abrir demo',
    request: 'Solicitar demo',
    moduleLabel: 'Módulo',
    recLabel: 'Grabación de pantalla del módulo «{name}»',
    shotSoon: 'Captura en preparación',
    zoomOpen: 'Ver en grande',
    zoomClose: 'Cerrar',
    chainTitle: 'Cómo se conecta con otros módulos',
    chainLead: 'Todos los módulos comparten la misma base de datos: la información fluye sin copias manuales ni integraciones.',
    chainCurrent: 'Este módulo',
    chainPasses: 'Pasa al siguiente',
    chainResult: 'Resultado',
    faqTitle: 'Preguntas sobre el módulo',
    finalTitle: 'Te mostramos el módulo «{name}» con tus procesos',
    finalLead: 'Abre la empresa demo ahora mismo o deja una solicitud — configuraremos el módulo para tu operación.',
    otherTitle: 'Otros módulos',
  },
  tasks: {
    features: [
      {
        title: 'Cinco vistas del mismo trabajo',
        text: 'Abre cualquier proyecto como tablero, lista, tabla, calendario o línea de tiempo — con los mismos datos. Cada tarea tiene fecha límite, responsable y prioridad.',
        list: ['Prioridad de 1 a 10 y etiquetas de color', 'Subtareas y repetición programada', 'Vistas guardadas con filtros'],
        screen: 'Tablero de proyecto: columnas por estado y tarjetas de tareas',
      },
      {
        title: 'Tiempo por tarea',
        text: 'Las horas se imputan a la tarea y se comparan con el estándar: las horas planificadas se calculan según la norma de trabajo. El parte semanal se arma automáticamente.',
        list: ['Filas del parte: fecha, empleado, cliente, tipo de trabajo, tarea y horas', 'Cliente en la tarea para trabajos sin orden de trabajo', 'Admin y propietario ven todos los partes; el miembro solo el suyo'],
        screen: 'Parte semanal de horas del empleado por tarea',
      },
      {
        title: 'Tareas de producción y servicios',
        text: 'Cada proyecto y tarea tiene su módulo: general, producción o servicios. Las tareas operativas quedan en sus propios proyectos sin mezclar listas.',
        list: ['Claves de tarea como PROD-1 y SERV-3', 'La tarea hereda el módulo de su proyecto', 'Filtro por módulo en listas, tableros y vistas guardadas'],
        screen: 'Mis tareas: tareas generales y de módulos en una sola lista',
      },
    ],
    chain: [
      ['crm', 'Evento de negocio: creado, modificado o cambió de etapa.'],
      ['automations', 'Una regla crea la tarea y asigna responsable.'],
      ['tasks', 'La tarea queda en el proyecto del módulo; las horas se cargan allí.'],
      ['services', 'El técnico de la orden de trabajo es una tarea de servicios cuyas horas van al parte.'],
    ],
    faq: [
      ['¿Se pueden llevar las tareas de producción y servicios separadas de las generales?', 'Sí. Cada proyecto tiene un módulo: general, producción o servicios. La tarea lo hereda y recibe prefijo PROD o SERV.'],
      ['¿Cómo se registra el tiempo?', 'Las horas se cargan sobre la tarea. El parte semanal agrupa esos registros por fecha, empleado, cliente, tipo de trabajo, tarea y horas.'],
      ['¿Quién puede ver el parte de horas?', 'El administrador y el propietario ven el de cualquier empleado; cada miembro solo ve el suyo.'],
      ['¿Qué vistas tiene un proyecto?', 'Tablero, lista, tabla, calendario y línea de tiempo. Puedes guardar cualquier filtro como vista.'],
    ],
  },
  crm: {
    features: [
      {
        title: 'Leads desde la web',
        text: 'Las consultas llegan desde los formularios del sitio directamente a los estados de leads. Al convertir un lead se crea el cliente y el negocio.',
        list: ['Formulario web con token secreto y fuente', 'Reparto rotativo de nuevos leads entre responsables', 'Interacciones del lead: tipo, asunto y nota'],
        screen: 'Lista de leads con estados, fuentes y responsables',
      },
      {
        title: 'Embudos y negocios',
        text: 'Gestiona múltiples embudos. Cada etapa tiene probabilidad de cierre y plazo estándar, y cada cambio de etapa queda en el historial.',
        list: ['Probabilidad por etapa de 0 a 100%', 'Campos obligatorios al entrar en una etapa', 'Catálogo de motivos de pérdida', 'Aviso cuando un negocio se estanca en una etapa'],
        screen: 'Embudo de ventas: etapas, montos y tarjetas de negocios',
      },
      {
        title: 'Fuentes y retorno publicitario',
        text: 'La fuente y la campaña acompañan al lead, negocio y documentos de venta. Ingresa el gasto de campañas y el informe calcula el retorno.',
        list: ['Tipos de fuente: canal, socio, contacto', 'Vinculación automática de campañas por utm_campaign', 'Conversión, costo por lead y por cliente, ROMI', 'Ingresos tomados de entregas contabilizadas'],
        screen: 'Informe de canales publicitarios: gasto, ingresos y ROMI',
      },
    ],
    chain: [
      ['crm', 'Cliente, negocio, fuente de captación y campaña.'],
      ['docs', 'Presupuesto, pedido y factura creados en cadena conservando fuente y campaña.'],
      ['production', 'El pedido de cliente pasa a orden de producción.'],
      ['sales', 'Las entregas contabilizadas alimentan los ingresos en el informe de canales.'],
    ],
    faq: [
      ['¿Qué pasa con un lead al convertirlo?', 'Se crean el cliente y el negocio. La fuente y campaña se copian; si el cliente ya existía, solo se asigna fuente si estaba vacía.'],
      ['¿Se puede configurar un embudo propio?', 'Sí. Puedes crear varios embudos y definir categoría, probabilidad, días estándar y campos obligatorios por etapa.'],
      ['¿Cómo se calcula el retorno publicitario?', 'ROMI es (ingresos − gasto) / gasto. Los ingresos vienen de entregas contabilizadas con esa fuente y los gastos se cargan manualmente.'],
      ['¿Cómo se vincula una campaña con un lead?', 'Mediante utm_campaign recibido desde el formulario web y asociado a una campaña activa.'],
    ],
  },
  docs: {
    features: [
      {
        title: 'Documentos ERP uniformes',
        text: 'Encabezado arriba, tablas en pestañas abajo. Facturas, pedidos, entregas, actas, recepciones y compras comparten la misma estructura.',
        list: ['La tarifa completa precios automáticamente', 'IVA incluido o adicional e importe en letras', 'Redondeo por línea para que los totales coincidan con el PDF'],
        screen: 'Documento de entrega: encabezado y tabla de productos',
      },
      {
        title: 'Contabilización y numeración',
        text: 'Los borradores no tienen número: se asigna al contabilizar, evitando huecos por borradores abandonados. Contabilizar valida cliente, líneas y stock.',
        list: ['Formato de número como FAC-2026-00042', 'Un documento contabilizado no se edita sin descontabilizarlo', 'Se puede anular o devolver a borrador'],
        screen: 'Factura contabilizada con número asignado y totales',
      },
      {
        title: 'Crear a partir de otro documento',
        text: 'El siguiente documento de la cadena se genera desde el anterior: copia encabezado y líneas con la cantidad pendiente de cumplir.',
        list: ['Presupuesto → pedido o factura', 'Pedido de cliente → factura, entrega o acta', 'Entrega → devolución de cliente', 'Pedido a proveedor → recepción'],
        screen: 'Pedido de cliente mostrando cantidades cumplidas y planificadas',
      },
      {
        title: 'Presupuestos, contratos y PDF',
        text: 'Arma presupuestos con variantes y grupos de líneas, aplica una plantilla y exporta a PDF. Los contratos también usan plantillas.',
        list: ['Opciones de presupuesto con selección de variante principal', 'Imágenes de productos opcionales en la plantilla', 'Descarga de múltiples facturas en un solo archivo'],
        screen: 'Vista imprimible de presupuesto en PDF',
      },
    ],
    chain: [
      ['crm', 'Cliente, responsable y fuente de captación.'],
      ['docs', 'Presupuesto → pedido → factura en una misma cadena.'],
      ['sales', 'La entrega generada desde pedido o factura mueve stock y saldos.'],
      ['logistics', 'Pedidos, entregas y órdenes de trabajo incluyen la pestaña «Entrega».'],
    ],
    faq: [
      ['¿Cuándo recibe número un documento?', 'Al contabilizarlo. Los borradores no tienen número y nunca se repiten. Si se descontabiliza y vuelve a contabilizar, conserva el mismo número.'],
      ['¿Se puede editar un documento contabilizado?', 'No, primero hay que descontabilizarlo, siempre que no tenga documentos posteriores contabilizados.'],
      ['¿Se puede entregar más de lo pedido?', 'No. El cumplimiento no puede superar lo pedido; el nuevo documento propone solo el saldo pendiente.'],
      ['¿Cómo obtengo el PDF imprimible?', 'Desde el propio documento puedes abrir y descargar el PDF. Varias facturas pueden exportarse en un solo archivo.'],
    ],
  },
};
