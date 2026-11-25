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
      {
        title: 'Pizarras interactivas en el núcleo',
        text: 'Un lienzo infinito al estilo de Miro y Figma viene incluido en el núcleo sin costo adicional: diseña procesos, organiza ideas y conéctalas directo con el trabajo del equipo.',
        list: [
          'Notas adhesivas, figuras, secciones, flechas de conexión, dibujo libre, alineación inteligente y exportación a PNG/SVG',
          'Tarjetas vivas de ERP y CRM en el lienzo (tareas, negocios, empresas) con marca de completado',
          'Conversión de nota a tarea en 1 clic y plantillas listas: análisis FODA, mapa del cliente y hoja de ruta',
        ],
        screen: 'Pizarra interactiva: notas, secciones y tarjetas vivas de tareas y negocios en el lienzo',
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
      ['¿Las pizarras interactivas tienen costo adicional?', 'No. Las pizarras interactivas (Whiteboards) están incluidas en el núcleo sin costo extra: ofrecen lienzo infinito, plantillas de equipo, tarjetas vivas de tareas, negocios y empresas, y conversión de nota a tarea en 1 clic.'],
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
      {
        title: 'Widget de IA embebible y chats multilingües',
        text: 'Inserta una sola etiqueta <script> en cualquier sitio web de tu empresa. El bot responde con tu base de conocimiento, opera solo en dominios permitidos, emite un aviso sonoro suave y transfiere el chat a un gestor en un clic con traducción contextual automática.',
        list: [
          'Instalación en cualquier web mediante <script> con lista blanca de dominios y base de conocimiento propia',
          'Aviso sonoro suave de nuevos mensajes, tono y saludo configurables por idioma (RU, EN, ES)',
          'Botón «Llamar a un gestor» con pase en un clic a los Chats multilingües integrados y traducción automática',
          'Historial completo en el CRM y creación de lead en un clic vinculado a la conversación',
        ],
        screen: 'CRM «Chats IA»: widget embebible, chats multilingües con traducción automática y pase a gestor',
      },
      {
        title: 'Control de acceso por puesto y campos ocultos',
        text: 'Limita la visibilidad de registros según el puesto directamente en la base de datos (PostgreSQL RLS) y oculta campos sensibles para quienes no los necesitan en su trabajo.',
        list: [
          'Alcance de registros por puesto: «Todos», «Departamento y subdepartamentos» o «Solo propios»',
          'Aislamiento aplicado en PostgreSQL RLS tanto en la interfaz como en la API',
          'Ocultación a nivel de campo: montos y probabilidades de negocios, teléfonos y correos, datos bancarios, totales de documentos y campos personalizados',
        ],
        screen: 'Permisos por puesto: alcance de visibilidad de registros y campos sensibles ocultos',
      },
      {
        title: 'Seguridad de acceso: 2FA, lista blanca IP y auditoría',
        text: 'Protege el espacio de trabajo con autenticación en dos pasos y reglas de IP confiables. Las políticas se aplican de forma uniforme en sesiones web, tokens Bearer, WebSockets y MCP.',
        list: [
          'Autenticación de dos factores (app TOTP + configuración por código QR + 10 códigos de recuperación de un solo uso)',
          'Activación obligatoria de 2FA para todo el espacio de trabajo con un solo interruptor',
          'Lista blanca IPv4/IPv6/CIDR con protección integrada contra autobloqueo del administrador',
          'Registro de auditoría de inicios de sesión con intentos, IPs y canales (sesiones, tokens Bearer, WebSockets, MCP)',
        ],
        screen: 'Ajustes de seguridad de acceso: 2FA por QR, lista blanca IP y registro de inicios de sesión',
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
      ['¿Cómo funciona el widget de IA embebible con los gestores?', 'Se instala en cualquier web con una etiqueta <script> y lista blanca de dominios para responder desde la base de conocimiento de tu empresa. Con «Llamar a un gestor» la conversación pasa a los Chats multilingües con traducción contextual automática, y cualquier chat se convierte en lead en un clic.'],
      ['¿Se pueden ocultar montos de negocios y contactos a ciertos roles?', 'Sí. Cada puesto define el alcance de registros («Todos», «Departamento y subdepartamentos» o «Solo propios» mediante PostgreSQL RLS) y los campos ocultos: montos y probabilidades, teléfonos/correos, datos bancarios, totales de documentos y campos personalizados.'],
      ['¿FutureERP admite 2FA y restricción de acceso por IP?', 'Sí. Incluye autenticación 2FA TOTP (QR y 10 códigos de recuperación), opción de 2FA obligatoria en todo el espacio, lista blanca IPv4/IPv6/CIDR con protección contra autobloqueo del administrador y registro de auditoría de inicios de sesión — aplicado en sesiones, tokens Bearer, WebSockets y MCP.'],
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
      {
        title: 'Portal externo para proveedores',
        text: 'Colabora con tus proveedores mediante un enlace seguro rotable, sin necesidad de crearles una cuenta ni licencia. Cada proveedor ve únicamente sus propios pedidos.',
        list: [
          'Enlace seguro rotable sin registro ni acceso al resto del espacio de trabajo',
          'Los proveedores confirman, marcan como enviado o rechazan pedidos e indican la fecha estimada de envío',
          'Comentarios en el pedido y carga directa de facturas (PDF, imágenes, XLSX) dentro de la orden de compra',
        ],
        screen: 'Portal de proveedores: pedidos de compra, estados de envío, comentarios y carga de facturas',
      },
      {
        title: 'Paquetes multipaís y multidivisa',
        text: 'Los paquetes modulares por país (CountryPack) se configuran por cada organización con tasas de IVA locales, divisas, validación de identificadores fiscales, formularios imprimibles y extractos bancarios.',
        list: [
          'Paquete de EAU: divisa AED, IVA 5% / 0% / exento, validación de TRN e IBAN',
          'Paquetes regionales adicionales (incluyendo Kazajistán) con tasas de IVA locales, formularios y lectura de extractos bancarios',
          'Arquitectura CountryPack extensible para operar entidades en distintos países desde un solo espacio',
        ],
        screen: 'Ajustes de organización: selección de paquete por país (EAU y paquetes regionales), divisa e IVA',
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
      ['¿Necesita el proveedor una cuenta para usar el Portal de proveedores?', 'No. El proveedor accede mediante un enlace seguro rotable donde ve solo sus pedidos de compra, puede confirmar, marcar enviado o rechazar, indicar la fecha prevista de envío, comentar y subir facturas (PDF, imágenes, XLSX) directamente al pedido.'],
      ['¿Admite FutureERP múltiples países y divisas?', 'Sí. Los paquetes modulares por país (CountryPack) se configuran por organización con tasas de IVA locales, divisas, validación fiscal, formularios y extractos bancarios — incluyendo EAU (AED, IVA 5%/0%/exento, TRN, IBAN) y paquetes regionales extensibles como Kazajistán.'],
    ],
  },
};
