/* Diccionario en español — páginas de módulos (logistics, automations, payroll) */
import type { Dict } from '../types';

export const esPages3: Pick<Dict['modulePages'], 'logistics' | 'automations' | 'payroll'> = {
  logistics: {
    features: [
      {
        title: 'Entregas de pedidos',
        text: 'Vincula la entrega al pedido, remito u orden de trabajo: método, dirección, franja horaria, peso y precio. Dirección y contacto se copian del cliente.',
        list: ['Métodos: mensajero propio, paquetería o transportista externo', 'Tarifa: base, por kilómetro y por kilogramo', 'Envío gratis al cliente a partir de un monto'],
        screen: 'Registro de entregas con estados y mensajeros',
      },
      {
        title: 'Mensajeros y estados',
        text: 'Cada entrega avanza de «nueva» a «entregada». El mensajero ve únicamente sus entregas asignadas en una lista dedicada.',
        list: ['Estados: nueva, asignada, en camino, entregada, no entregada', 'Mensajero: empleado con puesto «Mensajero»', 'Al entregarse, registra el gasto en el rubro «Entrega»'],
        screen: 'Ficha de ruta: vehículo, conductor y paradas en orden',
      },
      {
        title: 'Rutas y despachador',
        text: 'Agrupa paradas en rutas urbanas o interurbanas. Un botón distribuye las entregas del día entre vehículos disponibles y optimiza el recorrido.',
        list: ['Estados de entrega y paradas sincronizados', 'Una entrega no puede estar en dos rutas activas', 'Distancias en línea recta, API de mapas o servidor propio OSRM/VROOM', 'Cálculo de hora estimada respetando franjas horarias'],
        screen: 'Despachador de rutas: entregas sin asignar, vehículos y mapa',
      },
      {
        title: 'Flota y solicitudes de flete',
        text: 'Controla vehículos, conductores, hojas de ruta, combustible, multas y mantenimiento. Las solicitudes de flete calculan tarifa y margen.',
        list: ['Recordatorios de vencimientos de documentos de vehículos', 'Tarifas por tramo: por viaje, por kilómetro o por tonelada', 'Transportista contratado y gastos adicionales del viaje'],
        screen: 'Listado de flota con vencimientos de documentos',
      },
    ],
    chain: [
      ['sales', 'Pedido de cliente o entrega con dirección, peso e importe.'],
      ['logistics', 'Entrega y luego ruta con paradas; el conductor recibe sus entregas.'],
      ['automations', 'El cambio de estado de una ruta puede disparar automatizaciones.'],
      ['payroll', 'Nómina incluye liquidación de viajes para conductores.'],
    ],
    faq: [
      ['¿Es obligatorio contratar un servicio de mapas?', 'No. Sin proveedor se calcula distancia aproximada y velocidad media. Puedes conectar APIs de mapas o tu propio OSRM/VROOM.'],
      ['¿Qué pasa con el costo de un envío gratis?', 'Para el cliente es cero, pero el costo real queda registrado como gasto en el rubro «Entrega».'],
      ['¿Se puede incluir una entrega en dos rutas?', 'No. Una entrega no puede estar en dos rutas activas simultáneamente.'],
      ['¿Rutas y flota están en el plan base?', 'Rutas, flota y fletes pertenecen al módulo transport y se activan por separado.'],
    ],
  },
  automations: {
    features: [
      {
        title: 'Reglas en un lienzo visual',
        text: 'Arma reglas como diagrama: qué ocurrió, bajo qué condiciones y qué hacer. Antes de publicar se valida el flujo para evitar bloqueos o bucles.',
        list: ['Exactamente un disparador por regla', 'Sin nodos sueltos ni ciclos infinitos', 'Hasta 60 nodos y 150 conexiones'],
        screen: 'Editor de reglas: disparador, condición y acciones en el lienzo',
      },
      {
        title: 'Disparadores y lógica',
        text: 'Inicia reglas por eventos, horario cron o ejecución manual. Inserta condiciones, ramas o pausas entre el disparador y las acciones.',
        list: ['Registro creado, editado o campo cambiado: tarea, proyecto, negocio, empresa, contacto, artículo, documento', 'Horarios en la zona horaria de la empresa', 'Condiciones: igual, mayor, contiene, vacío y más', 'Pausas de hasta 30 días'],
        screen: 'Configuración del disparador «Campo modificado» y condición',
      },
      {
        title: 'Acciones y plantillas',
        text: 'Actualiza un campo, crea una tarea, notifica a un miembro, deja un comentario o envía una petición HTTP usando valores dinámicos del evento.',
        list: ['Comentarios en tareas o notas en negocios', 'Variables como {{trigger.record.title}}', 'Cabeceras secretas ocultas en el historial'],
        screen: 'Nodo «Crear tarea» con variables del negocio',
      },
      {
        title: 'Versiones e historial',
        text: 'Cada versión publicada es inmutable: editar el borrador no afecta la regla activa. Cada ejecución y paso quedan registrados.',
        list: ['Estados: en cola, ejecutando, esperando, exitoso, error', 'Entrada, salida y error visibles en cada paso', 'Eventos duplicados nunca crean una segunda ejecución'],
        screen: 'Historial de ejecuciones con detalle por paso',
      },
      {
        title: 'REST API v1 pública y webhooks salientes',
        text: 'Integra FutureERP con tiendas online, portales y servicios externos mediante una REST API v1 versionada con documentación OpenAPI y webhooks salientes fiables.',
        list: [
          'REST API v1 versionada (/api/v1) con esquema OpenAPI 3.0.3 (/api/v1/openapi.json) y documentación pública /docs/api',
          'Autenticación con tokens Bearer y permisos granulares por entidad y operación',
          'Webhooks salientes por eventos de entidades firmados con HMAC-SHA256',
          'Entrega en segundo plano mediante worker con reintentos automáticos, registro de entregas y reintento manual',
        ],
        screen: 'Documentación de REST API v1 (OpenAPI 3.0.3) y registro de entrega de webhooks',
      },
    ],
    chain: [
      ['crm', 'Evento: negocio creado, editado o movido de etapa.'],
      ['automations', 'La regla evalúa condiciones y ejecuta las acciones.'],
      ['tasks', 'Se crea la tarea y se notifica al responsable.'],
    ],
    faq: [
      ['¿Necesitamos un programador para crear una regla?', 'No. Las reglas se arman visualmente en el lienzo con formularios generados automáticamente.'],
      ['¿Qué pasa si una regla entra en bucle?', 'La protección contra bucles rechaza la ejecución recursiva y la marca como «omitida».'],
      ['¿Podemos enviar datos a un servicio externo?', 'Sí, mediante la acción «Petición HTTP» (con protección SSRF) o a través de webhooks salientes firmados con HMAC-SHA256 con reintentos automáticos y registro de entregas.'],
      ['¿Se puede retrasar una acción?', 'Sí. El nodo «Espera» pausa la ejecución hasta por 30 días.'],
      ['¿Existe una API pública para desarrolladores?', 'Sí. FutureERP ofrece una REST API v1 versionada (/api/v1) con esquema OpenAPI 3.0.3 (/api/v1/openapi.json), documentación pública en /docs/api y tokens Bearer con permisos granulares.'],
    ],
  },
  payroll: {
    features: [
      {
        title: 'Datos de personal y conceptos fijos',
        text: 'Guarda fechas de alta y baja, empresa, departamento y tasa de impuesto por empleado. Los conceptos fijos conservan historial por fecha.',
        list: ['Salario fijo o bono de monto fijo', 'Comisión sobre ventas por ingresos o margen', 'Cuenta bancaria o tarjeta para archivos de pago'],
        screen: 'Ficha de empleado: datos laborales y conceptos fijos',
      },
      {
        title: 'Cálculo mensual de nómina',
        text: 'El documento «Devengo de nómina» se completa en un clic: salario por parte, destajo, comisiones y bonos. Los ajustes puntuales se mantienen intactos.',
        list: ['Salario proporcional a días laborables y feriados', 'Destajo tomado de partes contabilizados, igual al informe de producción', 'Retenciones y aportes patronales calculados automáticamente', 'Todos los montos son editables antes de contabilizar'],
        screen: 'Documento «Devengo de nómina» con desglose por empleado',
      },
      {
        title: 'Planillas y pagos',
        text: 'Genera planillas de anticipo o liquidación por caja o banco. El pago crea el movimiento financiero y actualiza el estado: pendiente, parcial o pagada.',
        list: ['Archivo CSV para banco: nombre, cuenta e importe', 'Planilla imprimible de pagos', 'Recibo de sueldo individual para cada empleado'],
        screen: 'Planilla de pago con estado de desembolso',
      },
      {
        title: 'Gastos e informes',
        text: 'Al contabilizar se imputan los gastos salariales al mes por rubro y departamento. El destajo no se duplica: ya está incluido en el costo de producción.',
        list: ['Mayor de empleados: devengos, impuestos, retenciones y pagos', 'Control de períodos cerrados al contabilizar', 'Informes de nómina y recibos individuales'],
        screen: 'Informes de nómina del período',
      },
    ],
    chain: [
      ['production', 'Importe a destajo desde partes contabilizados.'],
      ['sales', 'Comisión por ventas en documentos del empleado.'],
      ['payroll', 'Devengo, planilla, pago y gastos por rubro y departamento.'],
    ],
    faq: [
      ['¿Incluye declaraciones fiscales oficiales o bajas médicas?', 'No. Es nómina de gestión: devengos, deducciones, tasa de impuesto y aportes a gastos. Las presentaciones fiscales quedan fuera del alcance.'],
      ['¿De dónde sale el pago a destajo?', 'De los partes a destajo contabilizados, coincidiendo con el informe de producción.'],
      ['¿Cómo se configuran los aportes patronales?', 'Como porcentaje por empresa (30% por defecto). Cada concepto puede marcarse como exento.'],
      ['¿Quién tiene acceso a la nómina?', 'Solo administradores y propietarios. Cada empleado solo puede ver su propio recibo.'],
    ],
  },
};
