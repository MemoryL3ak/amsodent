// Base de conocimiento del Centro de Ayuda: el manual operativo completo de la
// plataforma Amsodent, en markdown, que se inyecta (con prompt caching) al
// system prompt del endpoint /ia/ayuda. Es la única fuente que DamarIA usa
// para responder "cómo se hace X en el sistema" — no tiene acceso a SQL aquí.
//
// Mantener sincronizado con el manual visual del frontend
// (src/data/manualAyuda.jsx) cuando cambien flujos o módulos.

export const MANUAL_SISTEMA = `
# PLATAFORMA DE GESTIÓN AMSODENT — MANUAL OPERATIVO

Amsodent es una empresa chilena de insumos dentales. Esta plataforma cubre todo su
ciclo comercial: detectar oportunidades en Mercado Público, cotizar, adjudicar,
despachar, facturar, cobrar y pagar comisiones — más productos, inventario,
clientes, RRHH y comunicación interna.

## ROLES Y PERMISOS

Roles: admin (Administrador, ve todo), jefe_ventas (Jefe de Ventas, único no-admin
que ve Comisiones), jefe_ventas_especial (Jefe de Ventas Especial, ve Post-Venta
completa: Seguimiento de Pagos, Cobranza, Factoring; recibe alertas de facturas
vencidas), ventas (Ventas), ventas_especial (Ventas Especial: además Sorteo y
Monitoreo Stock), contabilidad (Contabilidad: correo, chat, Seguimiento de Pagos,
Cobranza, metas).
Además el admin puede crear "perfiles de permisos" a medida (módulo Usuarios) que
asignan módulos específicos a un usuario, por sobre el fallback del rol.
Solo admin (nunca asignable por perfil): Órdenes de Compra a proveedores,
Proveedores, Inventario, Análisis Mercado Público, Recursos Humanos,
Comunicaciones (correo masivo), Monitoreo del Sistema, widget DamarIA de datos.
"Mi Ficha" y el "Centro de Ayuda" los ven todos los usuarios autenticados.

## FLUJO DE NEGOCIO COMPLETO (el ciclo de una venta pública)

1. DETECCIÓN — Mercado Público (menú Comercial → Mercado Público): se explora la
   API de Mercado Público por palabra clave, región, estado y fechas. Cada
   resultado se puede agregar al listado interno o tomar directo.
2. TOMA — "Tomar" reserva la postulación para un ejecutivo (máximo 3 tomas
   vigentes por persona; no se pueden tomar vencidas). La toma se publica como
   tarjeta en el Chat Grupal (sala General) y se replica al WhatsApp del equipo.
   Solo quien tomó la postulación puede crear la cotización desde ella.
   Alternativas: marcarla "No aplica" (reversible) o dejarla vencer (se cierra).
3. COTIZACIÓN — "Cargar" abre Nueva Cotización prellenada. Campos clave: código
   (id_licitacion), cliente/entidad (RUT), tipo de cliente (Entidad Pública o
   Cliente Particular), tipo de compra (Compra ágil, Compra directa, Licitación
   0-8 meses, Licitación 9-24 meses, Cliente particular), condición de venta
   (30 días / Contado), lista de precios (1/2/3), flete estimado, ítems con SKU,
   cantidad, precio y COSTO congelado (ese costo es el que leerán los paneles de
   margen para siempre). El margen por línea de ítem es visible para todos.
   Estado inicial: "En espera"; si el margen general es menor a 20% queda
   "Pendiente Aprobación" (sin PDF) hasta que un admin/jefe apruebe.
   El sistema bloquea cotizar a clientes con facturas en mora.
4. RESULTADO — En el Detalle de la cotización se cambia el estado: Adjudicada,
   Perdida (con motivo), Desierta, Descartada (con motivo) o Cancelada. Al
   adjudicar se confirma el monto y la cotización queda bloqueada para edición.
5. ORDEN DE COMPRA DEL CLIENTE — Se sube el documento "orden_compra" (número,
   monto NETO, fecha, PDF). ESTA es la verdad para los paneles: una cotización
   sin OC no cuenta como adjudicada en los indicadores, y la fecha de la primera
   OC es la fecha de adjudicación. "Adjudicado" en paneles = suma de OC (neto).
6. DESPACHO — Se sube la "guia_despacho", que siempre deriva de una OC (fecha,
   empresa de despacho, N° de seguimiento, monto neto, PDF). "Ventas" en paneles
   = suma de guías (neto). Trazabilidad vigila el ciclo OC→guías con SLA de 3
   días hábiles (feriados chilenos incluidos) y muestra el Pendiente por
   Despachar; permite cierre forzado con respaldo. El despacho interno se opera
   en el Portal de Despachos y el Portal del Chofer (estados, evidencia
   fotográfica, firma de recepción).
7. FACTURA — Pública: documento "factura". Particular: "factura_boleta" (el
   comprobante de pago, webpay o efectivo cuelga de ella). TODOS los montos de
   documentos se guardan en NETO; el bruto se calcula ×1,19 al mostrar (la Nota
   de Crédito es la excepción).
8. COBRO — Seguimiento de Pagos calcula el vencimiento = fecha de factura +
   plazo de la condición de venta (Contado = 0, "30 días" = 30). Semáforo:
   Pagada / En plazo / Por vencer / Vencida. Al registrar el pago se digita el
   monto BRUTO y el sistema guarda el neto; queda forma de pago (incluye
   factoring) y días de atraso. Las notas de crédito restan del saldo. Botón
   "Correo cobro": genera un borrador con N° OC, guías, factura y datos de
   despacho para copiar o abrir en el correo (nunca se envía solo). Un cron
   diario notifica a los jefe_ventas_especial cuando una factura se vence.
   Lo vencido se gestiona en Cobranza; lo cedido, en Factoring.
9. COSTEO REAL DEL FLETE — En Fletes se cargan los cobros reales de Starken y
   Blue Express y se cruzan por N° de seguimiento contra las guías: flete
   estimado vs cobro real, diferencia y desviación por OC. Se cierra por
   cotización.
10. COMISIONES — Por vendedor y según su canal (definido en Metas):
    Comisión = (Full venta + Full productividad) × multiplicador de margen ×
    multiplicador de conversión, con 4 tablas de tramos por canal. Venta = suma
    de adjudicadas del mes; margen usa el costo congelado del ítem;
    productividad = actividades de la Bitácora; conversión = adjudicadas /
    ingresadas.
11. LECTURA — Panel de Indicadores (global y por tipo de cliente), Panel de
    Ejecutivos (por vendedor), Definición de metas (con resumen por canal), y
    Análisis Mercado Público (nuestra oferta vs el ganador).

## MÓDULOS — GRUPO COMERCIAL

### Cotizaciones (/listar)
Listado central de cotizaciones con filtros y acciones. Desde aquí se aprueban
las cotizaciones "Pendiente Aprobación" (margen < 20%). Cada fila abre el
Detalle (/detalle/:id).

### Nueva Cotización (/crear)
Formulario de creación: cliente, tipo de compra, condición de venta, lista de
precios, ítems (buscador por SKU con modal de productos), flete estimado con
calculadora por courier, margen por línea visible para todos. Si hay productos
equivalentes se ofrece crear una cotización hija (jerarquía madre/hija). Puede
nacer vinculada a una postulación de Mercado Público o a una solicitud del
portal de stock de clientes.

### Detalle de Cotización (/detalle/:id)
La ficha completa: ítems, márgenes, estado, y el árbol de DOCUMENTOS del ciclo:
orden_compra → guia_despacho (con empresa y N° seguimiento) → factura /
factura_boleta → comprobante_pago / webpay / efectivo / nota_credito. Cada
documento lleva número, fecha, monto NETO y PDF adjunto. Además: aprobar margen
(admin/jefe), compartir el Portal del Cliente, exportar PDF de la cotización.
DamarIA puede leer un PDF de factura o guía y precargar sus datos (botón con el
girasol en Trazabilidad).

### Mercado Público (/licitaciones-disponibles)
Explorador de la API de Mercado Público (búsqueda por texto, región, estado,
fechas) con filtros locales sobre los resultados (texto, tipo, vigencia, rango
de cierre). Acciones por postulación: Tomar (reserva, máx. 3), No aplica,
Cargar → crea la cotización. El botón de crear cotización solo se habilita para
quien tiene la toma. La sincronización nocturna (23:00) trae los resultados de
adjudicación para el Análisis Mercado Público.

### Órdenes de Compra a proveedores (/ordenes-compra) — solo admin
OC de COMPRA a proveedores (no confundir con la OC que emite el cliente).
Numeración correlativa #0001, mismo buscador de productos que la cotización,
costo unitario de compra, export a PDF con formato de marca.

### Proveedores (/proveedores) — solo admin
Catálogo de proveedores: razón social, RUT, contacto, correo, teléfono, rubro.

### Clientes (/clientes), Mis clientes (/mis-clientes)
Cartera de clientes con RUT, tipo, región/comuna, vendedor asignado. El detalle
del cliente tiene 6 pestañas: resumen (KPIs), cotizaciones, documentos,
actividades, productos y sucursales. "Mis clientes" es la vista reducida con la
cartera propia del ejecutivo.

### Bitácora actividades (/bitacora-actividades)
Agenda comercial: visitas, llamadas, reuniones (con enlace de Google Meet
integrado), asociadas a cliente y cotización. Alimenta la PRODUCTIVIDAD del
cálculo de comisiones — si no registras actividades, tu comisión baja.

### Productos (/productos)
Catálogo maestro: SKU, marca, categoría, formato, 3 listas de precios (Lista 3
= Lista 2 × 1,08, solo lectura), precios de campaña, imagen, peso y medidas
(cm³ para el cálculo de flete), ficha técnica en PDF. Estados: Activo (con
SKU), Transitorio (sin SKU), Pendiente Aprobación (margen 0-20%), Inactivo.
Al CREAR un producto todos los campos son obligatorios (excepto el SKU, que lo
asigna un admin); al EDITAR nada es obligatorio salvo la imagen. Carga masiva
por planilla con historial y rollback (deshace esa carga y las posteriores).
Filtros de completitud: SKU asignado, con/sin peso, con/sin medidas.

### Inventario (/inventario) — solo admin
Stock por SKU + libro de movimientos auditable (entrada / salida / ajuste, con
stock resultante estampado y usuario). KPIs: SKUs con stock, unidades,
valorización (stock × costo), bajo mínimo, sin stock. El mínimo se edita en la
tabla misma; el ajuste pide el conteo físico y el sistema calcula el delta.
Carga masiva por planilla (sku, stock, stock_minimo) — cada diferencia queda
como ajuste en el libro. La salida nunca deja stock negativo.
Integración BSALE (donde Amsodent factura): el stock disponible de Bsale se
sincroniza al sistema automáticamente (y con el botón "Sincronizar ahora" de
la tarjeta Bsale); cada cambio queda como ajuste "Sincronización Bsale" en el
libro, y las diferencias de catálogo (SKUs en Bsale sin producto interno y
productos internos sin SKU en Bsale) se listan y exportan a Excel. La
sincronización NO crea ni borra productos.

### Campañas (/campanas)
Precios de campaña por SKU con vigencia (inicio/fin): sobrescriben la lista de
precios al cotizar y se destacan en Productos. Crear campañas es solo admin.

## MÓDULOS — GRUPO POST-VENTA

### Trazabilidad (/trazabilidad)
Vigila el ciclo documental de cada adjudicada: OC → guías → factura. SLA de 3
días hábiles para despachar desde la OC (con feriados chilenos). Muestra
"Pendiente por Despachar" (OC − guías), tracking del envío, subida de
documentos desde la misma fila (con lectura automática por DamarIA), y cierre
forzado de ciclos con saldo (exige monto y archivo de respaldo; reversible).

### Seguimiento de Pagos (/seguimiento-pagos)
El semáforo de cobro: 8 KPIs clickeables (total, pagadas, en plazo, por vencer,
vencidas, factoring, notas de crédito, cierre forzado) que abren el detalle de
sus filas. Vencimiento = fecha factura + plazo de la condición de venta.
Registrar pago (monto bruto → guarda neto), forma de pago, días de atraso.
Botón "Correo cobro" genera el borrador de cobranza (OC, guía, factura,
despacho) para que el usuario lo envíe desde su propio correo. La mora
acumulada de un cliente bloquea nuevas cotizaciones para ese cliente.

### Cobranza (/cobranza)
Gestión de lo vencido: Sin gestión → En gestión → Comprometida. Acceso: admin,
contabilidad y jefe_ventas_especial.

### Factoring (/factoring)
Facturas cedidas a factoring: empresa, comisión (% y $), plazo.

## MÓDULOS — GRUPO LOGÍSTICA

### Despachos y Choferes (/despachos-choferes)
Choferes (contacto, patente, credenciales del portal), asignación de viajes y
estadísticas. KPIs: choferes, por despachar, viajes activos, en ruta.

### Tracking en Vivo (/tracking-choferes)
Mapa en tiempo real con la posición de los choferes y el estado del viaje.

### Fletes (/costeo-fletes)
Costeo real del flete de las adjudicadas: agrupa OC → guías → N° de
seguimiento, cruza los archivos de cobro de Starken y Blue Express por N° de
seguimiento, y compara flete estimado vs cobro real (diferencia y desviación).
Subsecciones "Sin match" (vincular manualmente) y "Análisis" (costeos
cerrados). Incluye el mantenedor de tarifas que alimenta la calculadora de
flete al cotizar.

## MÓDULOS — PORTAL DEL CLIENTE

### Monitoreo Stock Clientes (/monitoreo-stock)
Vista interna del stock que declaran los clientes en su portal, con umbrales
Bajo y Crítico (semáforo) y correos de alerta por cliente.

### Acceso Portal Clientes (/portal-accesos)
Credenciales del portal de stock: crear, renovar, revocar; y pestaña de
recuperaciones de contraseña.

### Portales públicos (sin sesión interna)
- /portal — Portal del Cliente: entra con RUT + N° de cotización; ve sus
  cotizaciones, documentos y puede subir archivos.
- /portal-cliente — Portal de Stock del cliente: acuerdo de confidencialidad,
  inventario propio con semáforo, y generación de solicitudes de cotización
  que llegan al sistema.
- /despachos — Portal de Despachos internos: estado, evidencia (fotos/PDF
  hasta 20 MB), firma de recepción dibujada y bitácora.
- /portal-chofer — Portal del Chofer: sus viajes, cambio de estado, foto de
  evidencia y ubicación en vivo cuando está "En ruta".
- /evento, /evento-vina — inscripción a eventos; /sorteo — registro al sorteo.

## MÓDULOS — GRUPO REPORTES

### Panel de Indicadores (/panel-indicadores, /panel-publica, /panel-particular)
KPIs globales y por tipo de cliente. REGLAS DE ORO: una cotización cuenta como
adjudicada solo cuando tiene documento OC (pública) o boleta/efectivo
(particular); la fecha de adjudicación es la fecha de la primera OC. Columna
"Ventas" = suma de guías de despacho (neto); columna "Adjudicado" = suma de OC
(neto); en particulares ambas salen de boletas/facturas. Los KPIs de
adjudicadas se abren con clic y muestran el detalle con export a Excel. El
panel Particular incluye el embudo Prospecto → Contactado → Cotiza → Compra.

### Análisis Mercado Público (/analisis-mercado-publico) — solo admin
Compara nuestra postulación vs el ganador real de cada licitación (datos de la
API de Mercado Público, sincronización nocturna): brechas de precio,
competidores frecuentes, simulador de descuento con recomendación de DamarIA, y
el panel de diferencias contra el Panel de Indicadores (conciliación por causa,
inconsistencias de estados, export).

### Panel de Ejecutivos (/cotizaciones-vendedor)
Rendimiento por vendedor: cotizaciones, adjudicaciones, ventas y resumen
comercial.

## MÓDULOS — GRUPO METAS

### Definición de metas (/metas)
Meta neta y meta de cantidad por vendedor y mes; aquí se asigna el CANAL de
cada vendedor (Vendedor Terreno, Tienda, Mercado Público, Página Web,
Freelance, etc.), que determina qué tablas de comisión se le aplican. Muestra
avance, cumplimiento, brecha, proyección y ritmo del mes. Incluye al pie la
tabla "Resumen por Canal" (meta, avance, cumplimiento y brecha agregados por
canal; antes era la página separada "Resumen canales", hoy fusionada aquí).
Clic en el Avance Neto de un vendedor o en Cumplimiento Global abre el
detalle de las guías de despacho y boletas que componen el avance (export a
Excel). El avance se mide por los montos NETOS de guías de despacho
(públicas) y boletas/facturas o efectivo (particulares) de cotizaciones
adjudicadas en el mes.

### Comisiones (/comisiones) — admin y jefe_ventas
Pestaña Configuración: 4 tablas de tramos por canal (venta, margen,
productividad, conversión; columna "Desde" = umbral del tramo) con copia entre
canales. Pestaña Cálculo: la liquidación del mes por vendedor con la fórmula
Comisión = (Full venta + Full productividad) × ×Margen × ×Conversión.

## MÓDULOS — GRUPO COMUNICACIÓN

### Mi Correo (/buzon)
Cliente de correo integrado (OAuth de Google): carpetas, etiquetas propias,
búsqueda, adjuntos y redacción.

### Chat Grupal (/bitacora-cotizaciones)
Salas grupales y directos 1 a 1, con contador de no leídos en el menú. Las
tomas de Mercado Público publican tarjetas en la sala General y se replican al
grupo de WhatsApp del equipo. Incluye la bitácora de cotizaciones ingresadas.

### Notificaciones (campana del encabezado)
Avisos en la plataforma: stock crítico/bajo de clientes, documentos subidos por
el portal, recordatorio de equivalencias (cada 2 horas, 08:00-20:00) y facturas
vencidas (a jefe_ventas_especial, 08:00). Clic en la notificación navega al
recurso.

## MÓDULOS — GRUPO HERRAMIENTAS

### Sorteo (/sorteo-registros) y Evento (/evento-inscripciones)
Administración de los registros públicos: KPIs, filtros, QR del portal del
evento (generar, copiar link, descargar PNG), invitaciones por correo con
estado de envío y reenvío, confirmación de asistencia.

### Marcar Asistencia (/marcaje)
Reloj de marcaje de entrada/salida con geolocalización puntual: pide el GPS al
marcar, y si el marcaje cae fuera del radio de la oficina queda etiquetado
"Fuera de radio" (según normativa de la Dirección del Trabajo). Comprobante en
pantalla e historial propio.

### Mi Ficha (/mi-ficha) — todos
El portal del trabajador: vacaciones disponibles, días administrativos,
antigüedad, liquidaciones (ver detalle y FIRMAR digitalmente), documentos,
evaluaciones y solicitudes de vacaciones/permisos (enviar y anular).

## MÓDULOS — GRUPO ADMINISTRACIÓN

### Recursos Humanos (/recursos-humanos) — solo admin
8 pestañas: Tablero, Trabajadores (ficha completa: datos, jornada, AFP/salud,
documentos en bucket privado), Contratos (borrador → enviado a firma → firmado;
firma digital de empresa), Liquidaciones (generación masiva con normativa
chilena: AFP, salud, impuesto; PDF), Asistencia (resumen por persona y detalle
por día sobre los marcajes), Evaluaciones, Solicitudes (aprobar/rechazar
vacaciones y permisos de Mi Ficha) y Prevención (D.S. 44: checklist y registro
art. 72).

### Usuarios (/usuarios)
Cuentas y roles: crear usuario (genera contraseña temporal), editar, reset de
clave, eliminar. Perfiles de permisos configurables por módulo. También existen
cuentas internas sin correo real (username + dominio interno) que puede crear
el admin.

### Monitoreo de Usuarios (/monitoreo)
Presencia en tiempo real: en línea, inactivo, conectado en horario (09-19),
desconectado.

### Monitoreo de Asistencia (/monitoreo-marcajes)
Mantenedor de oficinas (coordenadas + radio en metros + trabajadores asignados)
y tabla de todos los marcajes con distancia a la oficina.

### Monitoreo del Sistema (/monitoreo-sistema) — solo admin
Logs técnicos en vivo (errores, latencia, trace ID, migas de pan de lo que hizo
el usuario antes del error) y pestaña de problemas.

## DAMARIA (la IA de la plataforma)

DamarIA es la marca de TODA la inteligencia artificial de Amsodent (ícono: un
girasol 🌻). Hoy ayuda en:
- Centro de Ayuda (/ayuda): responde cómo usar la plataforma (todos los roles).
- Widget flotante de datos (solo admin): consultas en lenguaje natural sobre la
  base de datos, con gráficos, tablas, export a Excel/PDF y voz.
- Lectura de documentos: al subir una factura o guía en Trazabilidad, el botón
  del girasol extrae número, fecha, monto y courier automáticamente.
- Recomendación de precios en el simulador del Análisis Mercado Público.

## CONCEPTOS Y REGLAS TRANSVERSALES

- MONTOS: todos los documentos se guardan en NETO; el bruto = neto × 1,19. La
  Nota de Crédito es la excepción. Al registrar un pago se digita el bruto.
- ESTADOS DE COTIZACIÓN: En espera → Adjudicada / Perdida / Desierta /
  Descartada / Cancelada; "Pendiente Aprobación" si margen < 20%;
  "Pendiente Aprobación Peso" si algún producto de los ítems no tiene peso
  registrado en el catálogo (los admin reciben una notificación, completan el
  peso en Productos, recalculan el flete con la calculadora y aprueban con el
  botón "Aprobar peso" para que vuelva a En espera). En ambos estados
  pendientes no se puede generar el PDF.
- ADJUDICADA REAL: en los paneles manda el documento (OC o boleta), no el
  estado manual.
- TOMAS: máximo 3 postulaciones tomadas vigentes por persona.
- MORA: cliente con facturas vencidas queda bloqueado para nuevas cotizaciones.
- SLA DESPACHO: 3 días hábiles desde la OC (feriados chilenos).
- LISTAS DE PRECIO: Lista 3 = Lista 2 × 1,08 (automática).
- Si un módulo muestra "Falta aplicar la migración X": el admin debe ejecutar
  ese archivo SQL en Supabase (carpeta supabase/migrations).
`;
