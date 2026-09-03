// Contenido del Centro de Ayuda (/ayuda): el manual operativo de la plataforma
// en formato estructurado. La página CentroAyuda.jsx lo renderiza y filtra
// según el rol/permisos del usuario. La versión en texto que usa DamarIA vive
// en backend/src/ia/ayuda-conocimiento.ts — mantener ambos sincronizados
// cuando cambien flujos o módulos.
//
// acceso:
//   { tipo: "todos" }                        → lo ve cualquier autenticado
//   { tipo: "modulo", key: "..." }           → requiere ese módulo permisionado
//   { tipo: "algunModulo", keys: [...] }     → basta con uno de los módulos
//   { tipo: "admin" }                        → solo administradores
//   { tipo: "roles", roles: [...] }          → roles específicos (además admin)

export const FLUJO_NEGOCIO = [
  {
    n: 1,
    id: "mercado-publico",
    titulo: "Explorar y tomar",
    detalle:
      "En Mercado Público se buscan licitaciones y compras ágiles. \"Tomar\" reserva la postulación (máximo 3 vigentes) y avisa al equipo por chat y WhatsApp.",
  },
  {
    n: 2,
    id: "nueva-cotizacion",
    titulo: "Cotizar",
    detalle:
      "\"Cargar\" abre la Nueva Cotización prellenada: ítems con SKU, precios de lista o campaña, costo congelado y flete estimado. Margen < 20% queda Pendiente Aprobación.",
  },
  {
    n: 3,
    id: "detalle-cotizacion",
    titulo: "Adjudicar",
    detalle:
      "En el Detalle se marca el resultado (Adjudicada, Perdida…) y se sube la Orden de Compra del cliente — el documento que manda en los paneles.",
  },
  {
    n: 4,
    id: "trazabilidad",
    titulo: "Despachar",
    detalle:
      "Cada OC debe tener sus guías de despacho en 3 días hábiles. Trazabilidad vigila el pendiente por despachar y el tracking del envío.",
  },
  {
    n: 5,
    id: "seguimiento-pagos",
    titulo: "Facturar y cobrar",
    detalle:
      "La factura define el vencimiento según la condición de venta. Seguimiento de Pagos es el semáforo: pagadas, por vencer, vencidas, factoring.",
  },
  {
    n: 6,
    id: "costeo-fletes",
    titulo: "Costear el flete real",
    detalle:
      "Los cobros de Starken y Blue se cruzan por número de seguimiento contra las guías: flete estimado vs cobro real, por OC.",
  },
  {
    n: 7,
    id: "comisiones",
    titulo: "Comisionar",
    detalle:
      "Con el mes cerrado: venta adjudicada, margen, productividad (Bitácora) y conversión definen la comisión de cada vendedor según su canal.",
  },
  {
    n: 8,
    id: "panel-indicadores",
    titulo: "Medir",
    detalle:
      "Panel de Indicadores, Panel de Ejecutivos, Metas y Análisis Mercado Público leen todo el ciclo. La regla de oro: sin documento OC no hay adjudicada.",
  },
];

export const CHECKLIST_INICIO = [
  { t: "Entra con tu correo y contraseña", d: "Si no tienes cuenta, un administrador te la crea en el módulo Usuarios (recibirás una contraseña temporal)." },
  { t: "Reconoce tu menú lateral", d: "Los módulos que ves dependen de tu rol. Esta guía te muestra solo lo que puedes usar." },
  { t: "Revisa la campana de notificaciones", d: "Ahí llegan avisos de stock de clientes, documentos del portal, equivalencias y facturas vencidas." },
  { t: "Abre el Chat Grupal", d: "La sala General publica las tomas de Mercado Público del equipo y se replica al grupo de WhatsApp." },
  { t: "Registra tu primera actividad en la Bitácora", d: "Las actividades alimentan tu productividad, que es parte de la fórmula de comisiones." },
  { t: "Marca tu asistencia si corresponde", d: "En Marcar Asistencia, con la geolocalización activada del navegador." },
  { t: "Explora tu ficha en Mi Ficha", d: "Vacaciones, liquidaciones para firmar y solicitudes de permiso." },
  { t: "Pregúntale a DamarIA", d: "El panel de esta misma página responde cualquier duda sobre cómo usar la plataforma." },
];

export const GRUPOS_MANUAL = [
  {
    id: "comercial",
    titulo: "Comercial",
    icono: "Briefcase",
    modulos: [
      {
        id: "mercado-publico",
        titulo: "Mercado Público",
        icono: "Inbox",
        ruta: "/licitaciones-disponibles",
        acceso: { tipo: "modulo", key: "chat" },
        quien: "Todo el equipo comercial",
        resumen: "Explorar licitaciones y compras ágiles, tomarlas y convertirlas en cotización.",
        queEs: [
          "Es la puerta de entrada del ciclo público: busca en la API de Mercado Público por palabra clave, región, estado y fechas, y muestra los resultados con filtros locales (texto, tipo, vigencia y rango de cierre).",
        ],
        funciones: [
          "Tomar una postulación: la reserva a tu nombre (máximo 3 tomas vigentes) y publica una tarjeta en el Chat Grupal que se replica al WhatsApp del equipo.",
          "No aplica: descarta la postulación de forma reversible; las vencidas se cierran solas.",
          "Cargar: crea la cotización prellenada. El botón solo se habilita para quien tiene la toma.",
        ],
        pasos: [
          { t: "Busca", d: "Escribe la palabra clave (ej: \"insumos dentales\") y ajusta región, estado y fechas." },
          { t: "Toma", d: "Pulsa Tomar en la postulación que trabajarás. Si ya tienes 3 vigentes, libera una primero." },
          { t: "Carga", d: "Pulsa el botón de crear cotización: se abre Nueva Cotización con los datos de la licitación." },
        ],
        tips: [
          "La toma se libera automáticamente al guardar la cotización.",
          "La sincronización nocturna (23:00) trae los resultados de adjudicación que alimenta el Análisis Mercado Público.",
        ],
        figura: { tipo: "flujo", pasos: ["Explorar", "Tomar (máx. 3)", "Cargar", "Cotización"] },
      },
      {
        id: "cotizaciones",
        titulo: "Cotizaciones",
        icono: "ClipboardList",
        ruta: "/listar",
        acceso: { tipo: "modulo", key: "cotizaciones" },
        quien: "Todo el equipo comercial",
        resumen: "El listado central de cotizaciones y el lugar donde se aprueban los márgenes bajos.",
        queEs: [
          "Todas las cotizaciones de la empresa con sus estados, filtros y acciones. Cada fila abre el Detalle, donde vive el ciclo documental completo.",
        ],
        funciones: [
          "Filtrar por código, cliente, vendedor, estado, tipo de compra y fechas.",
          "Aprobar cotizaciones en \"Pendiente Aprobación\" (margen general bajo 20%) — admin y jefaturas.",
          "Acceso directo al PDF de la cotización y al Detalle.",
        ],
        figura: {
          tipo: "chips",
          titulo: "Estados de una cotización",
          items: [
            { t: "En espera", tone: "neutral" },
            { t: "Pendiente Aprobación", tone: "warning" },
            { t: "Pendiente Aprobación Peso", tone: "warning" },
            { t: "Adjudicada", tone: "success" },
            { t: "Perdida", tone: "danger" },
            { t: "Desierta", tone: "neutral" },
            { t: "Descartada", tone: "neutral" },
            { t: "Cancelada", tone: "danger" },
          ],
        },
      },
      {
        id: "nueva-cotizacion",
        titulo: "Nueva Cotización",
        icono: "FilePlus",
        ruta: "/crear",
        acceso: { tipo: "modulo", key: "crear_cotizacion" },
        quien: "Todo el equipo comercial",
        resumen: "Crear la oferta: cliente, ítems, precios, costo congelado, flete y margen por línea.",
        queEs: [
          "El formulario de creación. Puede nacer desde una postulación de Mercado Público, desde una solicitud del portal de stock de un cliente, o desde cero para clientes particulares.",
        ],
        funciones: [
          "Datos de negocio: tipo de cliente (Entidad Pública / Cliente Particular), tipo de compra, condición de venta (Contado / 30 días), lista de precios 1, 2 o 3.",
          "Ítems por SKU con buscador y modal de productos; los precios de campaña vigente se aplican solos.",
          "Margen por línea visible para todos; el costo del ítem queda congelado y es el que usarán los paneles y comisiones para siempre.",
          "Flete estimado con calculadora por courier (peso/volumen de los productos).",
          "Cotización hija: si hay productos equivalentes, el sistema ofrece crear la variante (jerarquía madre/hija).",
        ],
        tips: [
          "Si el margen general es menor a 20%, la cotización queda \"Pendiente Aprobación\" y no genera PDF hasta que la apruebe una jefatura.",
          "Un cliente con facturas en mora queda bloqueado: el sistema no deja guardar cotizaciones nuevas para él.",
        ],
      },
      {
        id: "detalle-cotizacion",
        titulo: "Detalle de Cotización",
        icono: "FileText",
        ruta: "/detalle/:id",
        acceso: { tipo: "modulo", key: "cotizaciones" },
        quien: "Todo el equipo comercial",
        resumen: "La ficha completa: resultado, documentos del ciclo (OC → guía → factura → pago) y portal del cliente.",
        queEs: [
          "Aquí se registra el resultado de la cotización y se cuelga todo el árbol de documentos. Los montos de los documentos se digitan y guardan en NETO; la plataforma muestra el bruto multiplicando por 1,19 (la Nota de Crédito es la excepción).",
        ],
        funciones: [
          "Cambiar estado: Adjudicada (confirma el monto y bloquea la edición), Perdida (con motivo), Desierta, Descartada o Cancelada.",
          "Subir documentos: orden_compra (número, monto neto, fecha, PDF) → guia_despacho (empresa, N° de seguimiento) → factura o factura_boleta → comprobante de pago / webpay / efectivo / nota de crédito.",
          "Compartir el Portal del Cliente (entra con RUT + N° de cotización).",
          "Exportar el PDF de la cotización con el formato de marca.",
        ],
        tips: [
          "La guía de despacho siempre deriva de una OC — el sistema lo exige.",
          "En los paneles manda el documento: sin OC no hay adjudicada, aunque el estado diga otra cosa.",
        ],
        figura: { tipo: "arbol-docs" },
      },
      {
        id: "clientes",
        titulo: "Clientes y Mis clientes",
        icono: "Users",
        ruta: "/clientes",
        acceso: { tipo: "algunModulo", keys: ["clientes", "mis_clientes"] },
        quien: "Todo el equipo comercial",
        resumen: "La cartera: fichas con RUT, sucursales, historial de compras y actividades.",
        queEs: [
          "Clientes es la cartera completa (el admin ve y reasigna el vendedor de cada cliente); Mis clientes es tu cartera propia.",
        ],
        funciones: [
          "Ficha con 6 pestañas: resumen (KPIs del cliente), cotizaciones, documentos, actividades, productos y sucursales.",
          "Crear cliente (también al vuelo desde la Bitácora), editar y mantener sucursales.",
        ],
      },
      {
        id: "bitacora",
        titulo: "Bitácora de actividades",
        icono: "CalendarDays",
        ruta: "/bitacora-actividades",
        acceso: { tipo: "modulo", key: "bitacora" },
        quien: "Todo el equipo comercial",
        resumen: "La agenda comercial: visitas, llamadas y reuniones. Alimenta tu productividad.",
        queEs: [
          "Calendario de actividades asociadas a cliente y cotización, con vista por día y por período.",
        ],
        funciones: [
          "Crear actividad: título, acción, estado, cotización asociada, participantes, fecha u horario.",
          "Reuniones con enlace de Google Meet integrado (copiar y abrir).",
          "Crear un cliente nuevo al vuelo desde el formulario.",
        ],
        tips: [
          "El número de actividades del mes es la PRODUCTIVIDAD de la fórmula de comisiones: registra todo lo que haces.",
        ],
      },
      {
        id: "productos",
        titulo: "Productos",
        icono: "Package",
        ruta: "/productos",
        acceso: { tipo: "modulo", key: "productos" },
        quien: "Todo el equipo comercial (SKU y aprobaciones: admin)",
        resumen: "El catálogo maestro: precios por lista, imagen, peso/medidas y ficha técnica PDF.",
        queEs: [
          "Cada producto tiene SKU, marca, categoría, formato, imagen, peso y medidas (el volumen en cm³ alimenta la calculadora de flete) y 3 listas de precios. La Lista 3 se calcula sola (Lista 2 × 1,08).",
        ],
        funciones: [
          "Crear producto: TODOS los campos son obligatorios (la única excepción es el SKU, que lo asigna un admin). Editar: nada es obligatorio salvo la imagen.",
          "Estados automáticos: con SKU → Activo; sin SKU → Transitorio; margen 0-20% sin SKU → Pendiente Aprobación (el admin aprueba desde Editar).",
          "Carga masiva por planilla con historial y rollback (deshace esa carga y las posteriores).",
          "Ficha técnica en PDF con logo, marca de agua e imagen; filtros de completitud (SKU / peso / medidas).",
          "Precios de campaña vigente destacados (ver módulo Campañas).",
        ],
        figura: {
          tipo: "chips",
          titulo: "Estados de un producto",
          items: [
            { t: "Activo", tone: "success" },
            { t: "Transitorio", tone: "neutral" },
            { t: "Pendiente Aprobación", tone: "warning" },
            { t: "Inactivo", tone: "danger" },
          ],
        },
      },
      {
        id: "inventario",
        titulo: "Inventario",
        icono: "Boxes",
        ruta: "/inventario",
        acceso: { tipo: "admin" },
        quien: "Solo administradores",
        resumen: "Stock por SKU con libro de movimientos auditable: entradas, salidas y ajustes.",
        queEs: [
          "El stock vigente vive en cada producto y cada cambio queda en el libro de movimientos con su stock resultante estampado y el usuario que lo hizo.",
        ],
        funciones: [
          "KPIs: SKUs con stock, unidades totales, valorización (stock × costo), bajo mínimo y sin stock (los dos últimos filtran al hacer clic).",
          "Registrar movimiento: entrada, salida (nunca deja stock negativo) o ajuste (ingresas el conteo físico y el sistema calcula el delta).",
          "Stock mínimo editable en la propia tabla (clic en el número; 0 = sin umbral).",
          "Carga masiva por planilla (sku, stock, stock_minimo): cada diferencia queda como ajuste auditado.",
          "Pestaña Movimientos: el libro completo con filtros; export a Excel.",
        ],
        figura: {
          tipo: "tabla",
          titulo: "El libro de movimientos",
          cols: ["Fecha", "SKU", "Tipo", "Cant.", "Stock result."],
          rows: [
            ["12-08", "AM-104", "Entrada", "+200", "350"],
            ["13-08", "AM-104", "Salida", "−80", "270"],
            ["20-08", "AM-104", "Ajuste", "−5", "265"],
          ],
        },
      },
      {
        id: "campanas",
        titulo: "Campañas",
        icono: "Megaphone",
        ruta: "/campanas",
        acceso: { tipo: "modulo", key: "campanas" },
        quien: "Todo el equipo comercial (crear: admin)",
        resumen: "Precios promocionales por SKU con vigencia: sobrescriben la lista al cotizar.",
        funciones: [
          "Campaña = nombre + fechas de inicio y fin + lista de SKUs con su precio de campaña.",
          "Mientras la campaña esté vigente, ese precio reemplaza al de lista en la Nueva Cotización y se destaca en Productos.",
        ],
      },
      {
        id: "ordenes-compra",
        titulo: "Órdenes de Compra a proveedores",
        icono: "FileText",
        ruta: "/ordenes-compra",
        acceso: { tipo: "admin" },
        quien: "Solo administradores",
        resumen: "Las OC de COMPRA que Amsodent emite a sus proveedores (no confundir con la OC del cliente).",
        funciones: [
          "Numeración correlativa (#0001), mismo buscador de productos que la cotización, costo unitario de compra.",
          "Export a PDF con formato de marca; catálogo de Proveedores (razón social, RUT, contacto, rubro) en su módulo propio.",
        ],
      },
    ],
  },
  {
    id: "postventa",
    titulo: "Post-Venta",
    icono: "Truck",
    modulos: [
      {
        id: "trazabilidad",
        titulo: "Trazabilidad",
        icono: "FileText",
        ruta: "/trazabilidad",
        acceso: { tipo: "modulo", key: "trazabilidad" },
        quien: "Jefaturas y administración",
        resumen: "Vigila que cada OC tenga sus guías y su factura a tiempo (SLA de 3 días hábiles).",
        queEs: [
          "Sigue el ciclo documental de cada adjudicada: cuánto de la OC está despachado, qué falta y cuánto tiempo queda.",
        ],
        funciones: [
          "SLA de despacho: 3 días hábiles desde la fecha de la OC, con feriados chilenos (\"Quedan N días háb.\" o \"vencido\").",
          "Pendiente por Despachar = monto OC − guías de los ciclos abiertos.",
          "Subir factura o guía desde la misma fila, con lectura automática del PDF por DamarIA (botón del girasol 🌻: extrae número, fecha, monto y courier).",
          "Cierre forzado de un ciclo con saldo: exige monto forzado y archivo de respaldo; es reversible.",
          "Tracking del envío por N° de seguimiento.",
        ],
        figura: { tipo: "flujo", pasos: ["OC", "Guías (≤ 3 días háb.)", "Factura", "Pago"] },
      },
      {
        id: "seguimiento-pagos",
        titulo: "Seguimiento de Pagos",
        icono: "CreditCard",
        ruta: "/seguimiento-pagos",
        acceso: { tipo: "modulo", key: "seguimiento_pagos" },
        quien: "Contabilidad, jefaturas especiales y administración",
        resumen: "El semáforo de cobro de todas las facturas, con correo de cobro en un clic.",
        queEs: [
          "El vencimiento se calcula solo: fecha de la factura + plazo de la condición de venta (Contado = 0 días, \"30 días\" = 30).",
        ],
        funciones: [
          "8 KPIs clickeables que abren el detalle de sus filas: total, pagadas, en plazo, por vencer, vencidas, factoring, notas de crédito y cierre forzado.",
          "Registrar pago: se digita el monto BRUTO y el sistema guarda el neto; quedan la forma de pago (incluye factoring) y los días de atraso.",
          "Notas de crédito: restan del saldo de la factura.",
          "Botón \"Correo cobro\": genera el borrador con N° de OC, guías, factura y despacho (empresa + seguimiento) para copiar o abrir en tu correo — la plataforma nunca lo envía sola.",
          "Cron diario (08:00): notifica a los jefe_ventas_especial las facturas que se vencen.",
        ],
        tips: [
          "La mora acumulada de un cliente bloquea nuevas cotizaciones para él.",
          "Lo vencido se gestiona en Cobranza; lo cedido, en Factoring.",
        ],
        figura: {
          tipo: "kpis",
          items: [
            { label: "Pagadas", tone: "success" },
            { label: "En plazo", tone: "primary" },
            { label: "Por vencer", tone: "warning" },
            { label: "Vencidas", tone: "danger" },
          ],
        },
      },
      {
        id: "cobranza",
        titulo: "Cobranza",
        icono: "Wallet",
        ruta: "/cobranza",
        acceso: { tipo: "modulo", key: "cobranza" },
        quien: "Contabilidad, jefe de ventas especial y administración",
        resumen: "La gestión de lo vencido: Sin gestión → En gestión → Comprometida.",
        funciones: [
          "Cada factura vencida avanza por los estados de gestión con sus observaciones.",
          "Se alimenta sola desde Seguimiento de Pagos.",
        ],
      },
      {
        id: "factoring",
        titulo: "Factoring",
        icono: "Landmark",
        ruta: "/factoring",
        acceso: { tipo: "modulo", key: "factoring" },
        quien: "Contabilidad, jefe de ventas especial y administración",
        resumen: "Facturas cedidas: empresa de factoring, comisión (% y $) y plazo.",
        funciones: [
          "Registro de la cesión con su costo financiero para descontarlo del análisis.",
        ],
      },
    ],
  },
  {
    id: "logistica",
    titulo: "Logística",
    icono: "Truck",
    modulos: [
      {
        id: "despachos-choferes",
        titulo: "Despachos y Choferes",
        icono: "Truck",
        ruta: "/despachos-choferes",
        acceso: { tipo: "modulo", key: "despachos_choferes" },
        quien: "Logística y administración",
        resumen: "Los choferes internos, sus viajes y sus credenciales del portal.",
        funciones: [
          "KPIs: choferes, por despachar, viajes activos, en ruta ahora.",
          "Pestañas: choferes (contacto, patente, acceso al portal), despachos (asignación de viajes) y estadísticas.",
          "El chofer opera desde su portal público (/portal-chofer): estado del viaje, foto de evidencia y ubicación en vivo.",
        ],
      },
      {
        id: "tracking-choferes",
        titulo: "Tracking en Vivo",
        icono: "MapPin",
        ruta: "/tracking-choferes",
        acceso: { tipo: "modulo", key: "tracking_choferes" },
        quien: "Logística y administración",
        resumen: "Mapa en tiempo real con la posición y el estado de cada chofer.",
        funciones: [
          "Pines coloreados según el viaje activo; KPIs: en línea, en ruta, asignados.",
        ],
      },
      {
        id: "costeo-fletes",
        titulo: "Fletes",
        icono: "Banknote",
        ruta: "/costeo-fletes",
        acceso: { tipo: "modulo", key: "costeo_fletes" },
        quien: "Logística y administración",
        resumen: "El flete estimado vs el cobro real de Starken y Blue, cruzado por N° de seguimiento.",
        queEs: [
          "Agrupa OC → guías → números de seguimiento de las adjudicadas y los cruza contra los archivos de cobro que envían los couriers.",
        ],
        funciones: [
          "Cargar cobros (Starken / Blue): sube el archivo del courier y cruza automático por N° de seguimiento.",
          "KPIs: en conciliación, flete estimado, cobro real, diferencia, cruzadas.",
          "\"Sin match\": seguimientos que no cruzaron, con vínculo manual.",
          "Cerrar / reabrir el costeo por cotización; \"Análisis\" muestra los cerrados con su desviación.",
          "Mantenedor de tarifas que alimenta la calculadora de flete al cotizar.",
        ],
      },
    ],
  },
  {
    id: "portal-cliente",
    titulo: "Portal del Cliente",
    icono: "PackageSearch",
    modulos: [
      {
        id: "monitoreo-stock",
        titulo: "Monitoreo Stock Clientes",
        icono: "PackageSearch",
        ruta: "/monitoreo-stock",
        acceso: { tipo: "modulo", key: "monitoreo_stock" },
        quien: "Ventas especial y administración",
        resumen: "El stock que declaran los clientes en su portal, con semáforo Bajo / Crítico.",
        funciones: [
          "Detalle por cliente y producto con umbrales; correos de alerta configurables por cliente.",
          "Las alertas también llegan a la campana de notificaciones.",
        ],
      },
      {
        id: "portal-accesos",
        titulo: "Acceso Portal Clientes",
        icono: "KeyRound",
        ruta: "/portal-accesos",
        acceso: { tipo: "modulo", key: "portal_accesos" },
        quien: "Administración",
        resumen: "Credenciales del portal de stock: crear, renovar, revocar y recuperaciones.",
        funciones: [
          "Vigencia y expiración por cliente, último acceso, y atención de solicitudes de cambio de clave.",
        ],
      },
      {
        id: "portales-publicos",
        titulo: "Portales públicos",
        icono: "Globe",
        ruta: "/portal · /portal-cliente · /despachos · /portal-chofer",
        acceso: { tipo: "todos" },
        quien: "Clientes, choferes y bodega (sin cuenta interna)",
        resumen: "Lo que ven los externos: cotizaciones, stock consignado, despachos y viajes.",
        funciones: [
          "/portal — el cliente entra con RUT + N° de cotización: ve sus cotizaciones, documentos y sube archivos.",
          "/portal-cliente — stock consignado del cliente con semáforo, y generación de solicitudes de cotización que llegan al sistema.",
          "/despachos — despachos internos: cambio de estado con nota, evidencia (fotos/PDF hasta 20 MB) y firma de recepción dibujada.",
          "/portal-chofer — los viajes del chofer, con evidencia y ubicación en vivo.",
          "/evento y /sorteo — formularios públicos de inscripción.",
        ],
      },
    ],
  },
  {
    id: "reportes",
    titulo: "Reportes",
    icono: "BarChart3",
    modulos: [
      {
        id: "panel-indicadores",
        titulo: "Panel de Indicadores",
        icono: "LayoutDashboard",
        ruta: "/panel-indicadores",
        acceso: { tipo: "modulo", key: "panel_indicadores" },
        quien: "Jefaturas y administración",
        resumen: "Los KPIs del negocio, global y por tipo de cliente (Entidad Pública / Cliente Particular).",
        queEs: [
          "La regla de oro: una cotización cuenta como adjudicada solo cuando tiene su documento — la OC en públicas, la boleta o el efectivo en particulares. La fecha de adjudicación es la de la primera OC.",
          "Columna \"Adjudicado\" = suma de OC (neto). Columna \"Ventas\" = suma de guías de despacho (neto). En particulares, ambas salen de boletas/facturas.",
        ],
        funciones: [
          "KPIs de adjudicadas clickeables: abren el detalle del período con export a Excel.",
          "Panel Entidad Pública: participación, adjudicación y equivalencias.",
          "Panel Cliente Particular: embudo Prospecto → Contactado → Cotiza → Compra.",
          "Márgenes calculados con el costo congelado de cada ítem (si el ítem no tiene costo, usa el del catálogo).",
        ],
        figura: { tipo: "regla-oro" },
      },
      {
        id: "analisis-mp",
        titulo: "Análisis Mercado Público",
        icono: "Scale",
        ruta: "/analisis-mercado-publico",
        acceso: { tipo: "admin" },
        quien: "Solo administradores",
        resumen: "Nuestra oferta vs el ganador real de cada licitación, con simulador de precios.",
        funciones: [
          "Sincronización nocturna con la API de Mercado Público: monto adjudicado real, ganador y competidores.",
          "Brechas de precio contra el ganador y competidores frecuentes.",
          "Simulador de descuento con recomendación estratégica de DamarIA.",
          "Panel de diferencias contra el Panel de Indicadores: conciliación por causa, inconsistencias de estados y export.",
        ],
      },
      {
        id: "panel-ejecutivos",
        titulo: "Panel de Ejecutivos",
        icono: "BarChart3",
        ruta: "/cotizaciones-vendedor",
        acceso: { tipo: "algunModulo", keys: ["cotizaciones_vendedor", "resumen_comercial"] },
        quien: "Jefaturas y administración",
        resumen: "El rendimiento por vendedor: cotizaciones, adjudicaciones y resumen comercial.",
        funciones: [
          "Comparativo del equipo por período, con el detalle de cada ejecutivo.",
        ],
      },
    ],
  },
  {
    id: "metas",
    titulo: "Metas y Comisiones",
    icono: "Trophy",
    modulos: [
      {
        id: "metas-def",
        titulo: "Definición de metas",
        icono: "Target",
        ruta: "/metas",
        acceso: { tipo: "modulo", key: "metas" },
        quien: "Todo el equipo (edición: administración)",
        resumen: "Meta neta y de cantidad por vendedor y mes, asignación de canal y resumen por canal — todo en una sola página.",
        funciones: [
          "Avance neto y bruto, progreso, cumplimiento y brecha por vendedor.",
          "Tarjetas de proyección, top cumplimiento y ritmo del mes.",
          "El CANAL de cada vendedor se asigna aquí mismo (selector en la fila; antes vivía en «Resumen canales») y define qué tablas de comisión se aplican.",
          "Tabla «Resumen por Canal» al pie: meta, avance, cumplimiento y brecha agregados por canal de venta.",
          "Clic en el Avance Neto de un vendedor (o en Cumplimiento Global) abre el detalle de las guías de despacho y boletas que componen el avance, con export a Excel.",
        ],
      },
      {
        id: "comisiones",
        titulo: "Comisiones",
        icono: "Percent",
        ruta: "/comisiones",
        acceso: { tipo: "roles", roles: ["jefe_ventas"] },
        quien: "Administración y Jefe de Ventas",
        resumen: "Configura las tablas por canal y calcula la comisión del mes por vendedor.",
        queEs: [
          "Cada canal tiene 4 tablas de tramos (venta, margen, productividad y conversión; la columna \"Desde\" es el umbral del tramo). La comisión del vendedor se evalúa con las tablas de SU canal.",
        ],
        funciones: [
          "Configuración: editar las 4 tablas por canal, copiarlas desde otro canal y guardar todos los perfiles a la vez.",
          "Cálculo: venta neta adjudicada del mes, margen real (con el costo congelado), productividad (actividades de la Bitácora) y conversión (adjudicadas / ingresadas).",
        ],
        figura: { tipo: "formula" },
      },
    ],
  },
  {
    id: "comunicacion",
    titulo: "Comunicación",
    icono: "Headphones",
    modulos: [
      {
        id: "buzon",
        titulo: "Mi Correo",
        icono: "Mail",
        ruta: "/buzon",
        acceso: { tipo: "modulo", key: "mi_correo" },
        quien: "Todo el equipo",
        resumen: "Tu correo de Google integrado en la plataforma.",
        funciones: [
          "Conectar con OAuth de Google (botón Conectar correo); carpetas del sistema y etiquetas propias.",
          "Búsqueda, solo no leídos, adjuntos y redacción con el compositor integrado.",
        ],
      },
      {
        id: "chat",
        titulo: "Chat Grupal",
        icono: "MessagesSquare",
        ruta: "/bitacora-cotizaciones",
        acceso: { tipo: "modulo", key: "chat" },
        quien: "Todo el equipo",
        resumen: "Salas de equipo y directos 1 a 1, con réplica al WhatsApp del grupo.",
        funciones: [
          "Salas grupales y conversaciones directas, con contador de no leídos en el menú lateral.",
          "Las tomas de Mercado Público publican su tarjeta en la sala General y se replican al WhatsApp del equipo.",
          "Incluye la bitácora de cotizaciones ingresadas (KPIs y tabla).",
        ],
      },
      {
        id: "notificaciones",
        titulo: "Notificaciones",
        icono: "Bell",
        ruta: "Campana del encabezado",
        acceso: { tipo: "todos" },
        quien: "Todo el equipo",
        resumen: "Los avisos de la plataforma, con navegación directa al recurso.",
        funciones: [
          "Stock crítico o bajo de clientes del portal; documentos subidos por el cliente.",
          "Recordatorio de equivalencias pendientes (cada 2 horas, de 08:00 a 20:00).",
          "Facturas vencidas: aviso diario a los jefe_ventas_especial a las 08:00 con link a Seguimiento de Pagos.",
        ],
      },
    ],
  },
  {
    id: "herramientas",
    titulo: "Herramientas",
    icono: "Wrench",
    modulos: [
      {
        id: "eventos",
        titulo: "Sorteo y Eventos",
        icono: "CalendarCheck",
        ruta: "/evento-inscripciones · /sorteo-registros",
        acceso: { tipo: "algunModulo", keys: ["eventos", "sorteo"] },
        quien: "Marketing y administración",
        resumen: "Los registros de los formularios públicos, con QR, invitaciones y confirmaciones.",
        funciones: [
          "QR del portal del evento: generar, copiar el link y descargar el PNG.",
          "Invitaciones por correo con estado de envío y reenvío por fila.",
          "KPIs de inscritos, asistencia confirmada y profesores; envío masivo de correos en el sorteo.",
        ],
      },
      {
        id: "marcaje",
        titulo: "Marcar Asistencia",
        icono: "Clock",
        ruta: "/marcaje",
        acceso: { tipo: "modulo", key: "marcaje" },
        quien: "Trabajadores con marcaje",
        resumen: "El reloj de entrada y salida, con geolocalización puntual.",
        pasos: [
          { t: "Permite la ubicación", d: "El navegador la pide la primera vez; sin GPS el marcaje no se registra." },
          { t: "Marca", d: "Un solo botón grande alterna Entrada / Salida según tu último marcaje." },
          { t: "Comprobante", d: "Queda en pantalla unos segundos y en tu historial." },
        ],
        tips: [
          "Si marcas fuera del radio de la oficina, el marcaje queda etiquetado \"Fuera de radio\" (normativa de la Dirección del Trabajo).",
        ],
      },
      {
        id: "mi-ficha",
        titulo: "Mi Ficha",
        icono: "UserCircle2",
        ruta: "/mi-ficha",
        acceso: { tipo: "todos" },
        quien: "Todo el equipo",
        resumen: "Tu portal del trabajador: vacaciones, liquidaciones para firmar y solicitudes.",
        funciones: [
          "Tarjetas: vacaciones disponibles, días administrativos, antigüedad y última liquidación.",
          "Liquidaciones con detalle (haberes, descuentos, líquido) y FIRMA digital.",
          "Solicitudes de vacaciones y permisos: enviar y anular; las aprueba RRHH.",
          "Tus documentos y evaluaciones.",
        ],
      },
    ],
  },
  {
    id: "administracion",
    titulo: "Administración",
    icono: "Shield",
    modulos: [
      {
        id: "rrhh",
        titulo: "Recursos Humanos",
        icono: "Users",
        ruta: "/recursos-humanos",
        acceso: { tipo: "admin" },
        quien: "Solo administradores",
        resumen: "Fichas, contratos, liquidaciones con normativa chilena, asistencia y prevención.",
        funciones: [
          "8 pestañas: Tablero, Trabajadores (ficha completa con jornada, AFP/salud y documentos), Contratos (con firma digital de empresa), Liquidaciones (generación masiva, PDF), Asistencia (sobre los marcajes), Evaluaciones, Solicitudes (aprobar vacaciones/permisos de Mi Ficha) y Prevención (D.S. 44).",
        ],
      },
      {
        id: "usuarios",
        titulo: "Usuarios",
        icono: "UserCog",
        ruta: "/usuarios",
        acceso: { tipo: "modulo", key: "usuarios" },
        quien: "Administración",
        resumen: "Cuentas, roles y perfiles de permisos por módulo.",
        funciones: [
          "Crear usuario (genera contraseña temporal), editar, reset de clave y eliminar.",
          "Perfiles de permisos: eligen módulo por módulo qué ve un usuario, por sobre el fallback de su rol.",
          "También existen cuentas internas sin correo real (username + dominio interno) creadas por el admin.",
        ],
      },
      {
        id: "monitoreos",
        titulo: "Monitoreos",
        icono: "Activity",
        ruta: "/monitoreo · /monitoreo-marcajes · /monitoreo-sistema",
        acceso: { tipo: "algunModulo", keys: ["monitoreo_usuarios", "monitoreo_asistencia"] },
        quien: "Administración",
        resumen: "Presencia de usuarios, marcajes con distancia a la oficina y salud técnica del sistema.",
        funciones: [
          "Monitoreo de Usuarios: en línea / inactivo / conectado en horario (09-19).",
          "Monitoreo de Asistencia: mantenedor de oficinas (coordenadas + radio) y todos los marcajes.",
          "Monitoreo del Sistema (solo admin): logs en vivo, errores con trace ID y lo que hizo el usuario antes del error.",
        ],
      },
    ],
  },
];

export const GLOSARIO = [
  { t: "Neto / Bruto", d: "Todos los documentos se guardan en NETO; el bruto se calcula ×1,19 al mostrar. La Nota de Crédito es la excepción. El pago se digita en bruto." },
  { t: "Toma", d: "Reserva de una postulación de Mercado Público a nombre de un ejecutivo. Máximo 3 vigentes por persona." },
  { t: "OC (del cliente)", d: "La Orden de Compra que emite el cliente adjudicando. Es el documento que hace que la cotización cuente como adjudicada en los paneles." },
  { t: "Adjudicado vs Ventas", d: "Adjudicado = suma de OC (neto). Ventas = suma de guías de despacho (neto). En particulares, ambas salen de boletas/facturas." },
  { t: "Costo congelado", d: "El costo del ítem se guarda al cotizar y es el que usan los paneles de margen y las comisiones, aunque el costo del catálogo cambie después." },
  { t: "Pendiente Aprobación", d: "Cotización con margen general bajo 20% (o producto nuevo con margen 0-20%): requiere aprobación de una jefatura." },
  { t: "Pendiente Aprobación Peso", d: "Cotización con productos sin peso registrado en el catálogo: un admin debe completar el peso, recalcular el flete y aprobarla para que vuelva a En espera." },
  { t: "SLA de despacho", d: "3 días hábiles desde la fecha de la OC para emitir las guías, contando feriados chilenos." },
  { t: "Cierre forzado", d: "Cerrar un ciclo OC→guías con saldo pendiente, con monto y archivo de respaldo. Reversible." },
  { t: "Condición de venta", d: "Plazo de pago de la factura: Contado (0 días) o 30 días. Define el vencimiento en Seguimiento de Pagos." },
  { t: "Mora", d: "Facturas vencidas sin pagar. Un cliente con mora queda bloqueado para nuevas cotizaciones." },
  { t: "Canal", d: "El perfil comercial del vendedor (Terreno, Tienda, Mercado Público, Web, Freelance…). Se asigna en Metas y define sus tablas de comisión." },
  { t: "Cotización madre / hija", d: "La hija es la variante con productos equivalentes de una cotización madre, para postular con alternativas." },
  { t: "Lista 3", d: "Se calcula sola: Lista 2 × 1,08. No se edita." },
  { t: "DamarIA", d: "La marca de toda la IA de la plataforma (girasol 🌻): guía de ayuda, consultas de datos (admin), lectura de documentos y recomendación de precios." },
];

export const FAQ = [
  {
    q: "¿Por qué no puedo crear la cotización desde una postulación?",
    a: "El botón solo se habilita para quien tiene la TOMA de esa postulación. Tómala primero (o pide a quien la tomó que la libere).",
  },
  {
    q: "¿Por qué mi cotización no genera PDF?",
    a: "Está en \"Pendiente Aprobación\" por margen bajo 20%. Una jefatura debe aprobarla en Cotizaciones o en el Detalle.",
  },
  {
    q: "¿Por qué el panel no muestra mi adjudicada?",
    a: "Falta el documento: en públicas la OC, en particulares la boleta o el efectivo. El estado manual no basta — sube el documento en el Detalle.",
  },
  {
    q: "El sistema no me deja cotizar a un cliente",
    a: "Tiene facturas en mora. Revisa Seguimiento de Pagos / Cobranza; al regularizar el pago se desbloquea.",
  },
  {
    q: "¿El monto de los documentos va con o sin IVA?",
    a: "Los documentos se digitan y guardan en NETO (el sistema muestra el bruto ×1,19). El PAGO es la excepción: se digita el monto bruto del comprobante.",
  },
  {
    q: "¿Cómo cambio mi contraseña?",
    a: "Desde el login: \"¿Olvidaste tu contraseña?\" te envía el enlace al correo. Si tu cuenta es interna (sin correo real), pide a un admin que te la restablezca en Usuarios.",
  },
  {
    q: "Un módulo me dice \"Falta aplicar la migración…\"",
    a: "Es un aviso para el administrador: debe ejecutar ese archivo SQL en Supabase. Avísale con el nombre exacto de la migración.",
  },
  {
    q: "¿Qué mira la fórmula de comisiones?",
    a: "Cuatro cosas del mes: venta neta adjudicada, margen real, productividad (actividades en la Bitácora) y conversión (adjudicadas / ingresadas), evaluadas en las tablas de tu canal.",
  },
];
