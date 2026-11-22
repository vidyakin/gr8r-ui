/* Diccionario en español — página principal */
import type { Dict } from '../types';

export const esHome: Dict['home'] = {
  title: 'FutureERP — ventas, producción y finanzas en un solo sistema',
  description: 'FutureERP reemplaza hojas de cálculo, CRM separados y ERP antiguos: cada pedido avanza desde la consulta hasta el cobro en una sola ficha. Para empresas de producción y servicios.',
  nav: {
    label: 'Navegación principal',
    modules: 'Módulos',
    how: 'Cómo funciona',
    compare: 'Comparación',
    price: 'Precios',
    faq: 'Preguntas',
    signIn: 'Iniciar sesión',
    openDemo: 'Abrir demo',
    menu: 'Menú',
  },
  hero: {
    audience: 'Para empresas de producción y servicios',
    titleStart: 'Ventas, producción y finanzas — ',
    titleAccent: 'en un solo sistema',
    titleEnd: ' en lugar de ERP antiguo, CRM y hojas de cálculo',
    lead: 'Cada pedido avanza desde la consulta hasta el cobro en una sola ficha: sin exportaciones, doble carga ni integraciones frágiles.',
    demo: 'Abrir demo',
    call: 'Verlo en una llamada',
    hint: 'Empresa demo precargada con datos reales',
    recLabel: 'Grabación de pantalla: resumen de CRM',
    recCaption: 'Grabación: un negocio pasa a la etapa «Ganado», los totales se recalculan y suben los ingresos y el ROMI del canal en el informe.',
  },
  facts: {
    label: 'Resumen del sistema',
    items: [
      ['Módulos independientes', 'pagas solo por lo que usas'],
      ['Tu propio servidor', 'puedes desplegarlo en tu infraestructura'],
      ['Datos aislados', 'cada empresa separada a nivel de base de datos'],
      ['Documentos estructurados', 'encabezado, partidas y contabilización'],
    ],
  },
  modules: {
    title: 'Nueve módulos, una sola base de datos',
    lead: 'Clientes, productos y dinero se registran una sola vez — y están disponibles al instante en tareas, negocios, documentos e inventario.',
    tabs: 'Módulos',
    soon: 'La grabación de este módulo estará disponible pronto.',
    more: 'Más sobre el módulo',
  },
  flow: {
    label: 'Cómo funciona',
    title: 'Un pedido recorre todos los módulos — sin introducirse dos veces',
  },
  compare: {
    title: 'En lugar de tres programas desconectados',
    lead: 'Cómo suele trabajar una pequeña empresa — y qué cambia con FutureERP.',
    criterion: 'Qué comparamos',
    was: 'ERP antiguo + CRM + hojas',
    now: 'FutureERP',
    rows: [
      ['Negocio y pedido', 'en programas distintos, pasando datos a mano', 'en una sola ficha: el negocio se vuelve pedido'],
      ['Stock y saldos', 'sincronización programada o exportaciones', 'se actualizan al contabilizar el documento'],
      ['Conexión de sistemas', 'integradores y mantenimiento constante', 'una sola base — sin integraciones'],
      ['Costo', 'licencia completa por cada herramienta', 'solo por los módulos activos'],
      ['Dónde viven los datos', 'repartidos entre varios proveedores', 'en la nube o en tu propio servidor'],
    ],
  },
  price: {
    title: 'Precio adaptado a tus procesos',
    lead: 'El precio depende de los módulos, el tamaño del equipo y la migración de datos. Lo vemos en una llamada y te enviamos una propuesta.',
    steps: [
      ['Llamada inicial', 'Nos cuentas cómo trabajas: ventas, almacén, producción y finanzas.'],
      ['Demo con tu caso', 'Recorremos en la demo el flujo de tu pedido y elegimos los módulos necesarios.'],
      ['Propuesta', 'Te enviamos la lista de módulos, plan de migración, plazos y presupuesto.'],
    ],
    ctaTitle: 'Hablemos de lo que necesita tu equipo',
    ctaText: 'Activa solo los módulos que necesitas — podrás añadir el resto después sin migrar datos.',
    cta: 'Consultar precio',
    demo: 'Probar la demo primero',
  },
  faq: {
    title: 'Preguntas frecuentes',
    items: [
      ['¿Se pueden importar datos desde Excel u otro ERP?', 'Los precios se cargan desde XLSX o CSV cruzando por SKU, y los extractos bancarios desde el archivo del banco. El resto de la migración lo planificamos en llamada.'],
      ['¿Necesitamos un programador para conectar los módulos?', 'No. Todos los módulos comparten la misma base de datos: negocios, pedidos, almacén y dinero ya están conectados.'],
      ['¿Podemos instalarlo en nuestro propio servidor?', 'Sí, FutureERP se puede desplegar en tu servidor. Los datos de cada empresa quedan aislados a nivel de base de datos.'],
      ['¿Qué pasa si activamos un módulo más adelante?', 'Verá de inmediato tus clientes, productos y documentos existentes, sin volver a cargar nada.'],
    ],
  },
  final: {
    title: 'Mira tu operación dentro de FutureERP',
    lead: 'Abre la empresa demo ahora mismo o deja una solicitud — te lo mostramos con tus propios procesos.',
    demo: 'Abrir demo',
  },
};
