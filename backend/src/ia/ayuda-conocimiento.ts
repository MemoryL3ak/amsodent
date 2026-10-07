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
   AL APROBARSE sale un aviso automático: al vendedor de la cotización (campana
   + correo, con quién la aprobó) y, si la cotización nació de un pedido del
   portal del cliente, también al cliente (aviso en su portal + correo) para
   que la valide o pida una modificación.
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
   factoring) y días de atraso. Las notas de crédito restan del saldo, igual
   que las MULTAS cursadas a Amsodent (botón "Multa" junto al de nota de
   crédito: monto bruto tal cual, archivo opcional, cuelga de la factura). Botón
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
11. LECTURA — MARGEN % de los paneles = (venta − costo) / venta sobre los
    ítems de lo adjudicado; costo = el guardado en el ítem, si no el del
    catálogo por SKU y luego por nombre (igual que la cotización); las líneas
    sin costo NO entran (el KPI dice qué % de la venta quedó fuera).
    Panel de Indicadores (global y por tipo de cliente), Panel de
    Ejecutivos (por vendedor), Definición de metas (con resumen por canal), y
    Análisis Mercado Público (nuestra oferta vs el ganador).

## MÓDULOS — GRUPO COMERCIAL

### Cotizaciones (/listar)
Listado central de cotizaciones con filtros y acciones. Desde aquí se aprueban
las cotizaciones "Pendiente Aprobación" (margen < 20%). Cada fila abre el
Detalle (/detalle/:id).

### Nueva Cotización (/crear)
Formulario de creación: cliente, tipo de compra, condición de venta, lista de
precios, ítems (buscador por SKU con modal de productos; botón "Ficha" en cada
línea para abrir la ficha técnica en PDF del producto), flete estimado con
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
Catálogo de proveedores: razón social, RUT, contacto, correo, teléfono, rubro,
MARCAS que distribuye (selector con las marcas del catálogo de productos; se
puede crear una marca nueva escribiéndola) y PALABRAS CLAVE libres. Marcas y
palabras clave entran en el buscador del listado.

### Clientes (/clientes), Mis clientes (/mis-clientes)
Cartera de clientes con RUT, tipo, región/comuna, vendedor asignado. El detalle
del cliente tiene 6 pestañas: resumen (KPIs), cotizaciones, documentos,
actividades, productos y sucursales. "Mis clientes" es la vista reducida con la
cartera propia del ejecutivo.
ASIGNACIÓN DE CARTERA (/asignacion-cartera, solo admin; también con el botón
"Asignar cartera" de Clientes): para repartir clientes entre vendedores EN
MASA. Se filtra por nombre/RUT, tipo, región, vendedor asignado y "le cotiza"
(el vendedor que más cotizaciones le ha hecho a ese cliente), se marcan filas
sueltas, la página o todos los del filtro, se elige el vendedor y se asignan
de una vez (o se les quita el vendedor). Arriba se ve cuántos clientes tiene
cada vendedor. No se puede asignar a un usuario bloqueado.

### Bitácora actividades (/bitacora-actividades)
Agenda comercial: visitas, llamadas, reuniones (con enlace de Google Meet
integrado), asociadas a cliente y cotización. Alimenta la PRODUCTIVIDAD del
cálculo de comisiones — si no registras actividades, tu comisión baja.
También registra actividades AUTOMÁTICAS de otros módulos (correos de
cobranza, calendario de cobranza): el sistema les resuelve el cliente por RUT
para que aparezcan en la ficha 360° y en el filtro por cliente.
SINCRONIZACIÓN CON GOOGLE CALENDAR (bidireccional, requiere la cuenta de
Google conectada en «Mi Correo» con el permiso de Calendar): (1) toda
actividad con fecha creada en la bitácora se espeja como evento en el
calendario del usuario (y se actualiza/borra al editarla/eliminarla); (2) AL
ABRIR LA BITÁCORA se importa al instante el calendario del propio usuario, y
además un respaldo automático cada 5 minutos importa el de todas las cuentas
conectadas — entran los eventos del calendario que
tengan AL MENOS OTRO INVITADO (reuniones reales; los recordatorios personales
sin invitados no se importan), sin duplicar y sin re-importar los eventos que
creó el propio sistema. Las importadas llegan como tipo Reunión con la nota
"Importada desde Google Calendar".
CAMPOS PROPIOS DEL FORMULARIO: un administrador puede agregar campos al
formulario de actividad con el botón "Campos del formulario" (texto corto o
largo, número, fecha, lista de opciones, sí/no), marcarlos como obligatorios,
ordenarlos y desactivarlos. Aparecen para todos los usuarios en el formulario
y en el detalle de la actividad. Desactivar un campo lo oculta sin perder lo
ya llenado; eliminarlo borra solo la definición.

### Productos (/productos)
Catálogo maestro: SKU, marca, categoría, formato, 3 listas de precios (Lista 3
= Lista 2 × 1,08, solo lectura), precios de campaña, imagen, peso y medidas
(cm³ para el cálculo de flete), ficha técnica en PDF. Estados: Activo (con
SKU), Transitorio (sin SKU), Pendiente Aprobación (margen 0-20%), Inactivo.
En los productos de la categoría Prevención e Higiene (los del Showroom del
portal) hay un campo VENTA SHOWROOM al crear y en la ficha: el precio sugerido
de venta al público, con la ganancia que le deja al cliente del portal sobre la
lista 2.
Al CREAR un producto todos los campos son obligatorios (excepto el SKU, que lo
asigna un admin); al EDITAR nada es obligatorio salvo la imagen. Ventas puede
editar peso y dimensiones de los Transitorios y Pendientes de Aprobación. Al
usar en una cotización un transitorio con MÁS DE 30 DÍAS de creado, el sistema
pide validar que su costo siga vigente (muestra costo y antigüedad) antes de
agregarlo al ítem. Carga masiva
por planilla con historial y rollback (deshace esa carga y las posteriores).
Filtros de completitud: SKU asignado, con/sin peso, con/sin medidas. Al crear
un producto queda a la vista con botones "Abrir ficha técnica", "Descargar
PDF" y "Ver / editar producto".
BSALE: un producto nuevo con SKU, o uno al que se le asigna SKU, se crea solo
en Bsale: producto (tipo = su categoría), variante con el SKU como código y
precios netos (lista 1 → WEB-PARTICULAR, lista 2 → PRECIO MP). Si el SKU ya
existe en Bsale solo se enlaza. La ficha del producto dice si está en Bsale y
tiene el botón "Enviar a Bsale" para reintentar. En la carga masiva los nuevos
se crean en Bsale en segundo plano. Cambiar después un precio NO lo cambia en
Bsale. TRANSITORIOS (2026-10-07): un producto SIN SKU también se crea en Bsale
(variante sin código); si allá hay uno con el mismo nombre se enlaza. Al
asignarle el SKU después, se le pone a esa misma variante. «Pendientes en
Bsale» (admin, en Productos) envía los que quedaron sin enviar: Simular cuenta
cuántos (por defecto solo los sin SKU) y «Enviar a Bsale» los procesa de a uno
en segundo plano mostrando el avance.

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
precios al cotizar y se destacan en Productos. Al crear una campaña se elige la
LISTA DE PRECIOS asociada (1, 2 o 3): el precio unitario de referencia de cada
SKU sale de esa lista. Crear campañas es solo admin.

### Venta directa (/venta-directa)
Módulo comercial (2026-10-07) para boletas y facturas al instante: «Nueva
boleta» / «Nueva factura» emite en Bsale y crea sola la cotización con esos
productos. Lista TODAS las ventas directas con documento (PDF y estado en
Bsale), cliente y cotización, total con notas de crédito y débito y pago
(Pagada, Por cobrar, Anulada, Sin emitir); filtros por documento y pago. Cada
fila se despliega con condición, comprobantes, notas (también las hechas a mano
en Bsale), guías y quién la emitió. Por venta: «N. crédito» y, en facturas,
«N. débito». No ofrece guía: la venta directa ya rebaja stock y una guía en
Bsale lo rebaja otra vez. La ven quienes tienen Venta directa o Facturación;
emitir exige rol administración, contabilidad o jefatura de ventas especial.

### Campañas de margen (/campanas-margen)
Campaña por MARCA, CATEGORÍA y/o lista de SKUs, sobre una lista de precios
(1, 2 o 3) y con vigencia. En vez de fijar un precio por SKU, aplica un % de
DESCUENTO sobre el precio de lista (desde 2026-10-07; antes era un margen fijo):
mientras está vigente, el precio de esos productos en esa lista es precio de
lista × (1 − descuento). Ej.: 10 % sobre $10.000 → $9.000. No
reescribe el catálogo: al terminar la vigencia vuelve solo el precio de lista.
Al crearla se ve una simulación: a cuántos productos alcanza y con qué margen
queda cada uno; avisa los que quedan bajo su costo o con menos de 20 %.
Pestaña «Productos y margen»: catálogo completo con filtros (texto, marcas,
categorías, lista, en campaña, margen) y KPIs del filtro: margen promedio a
precio de lista y con campañas vigentes, cuántos bajo 20 % y sin costo.
Descuento masivo (admin): % sobre la lista de los filtrados, «Simular» (margen
antes/después) y «Crear campaña» (abre la campaña armada por marca/categoría o
por los SKUs filtrados para ponerle nombre y fechas). Marcas, categorías o SKUs vacíos = todos; con más
de un filtro, el producto debe cumplirlos todos (solo SKUs = solo esos
productos). Los SKUs se pegan como texto (coma, espacio o salto de línea) y la
pantalla avisa cuáles no están en el catálogo. Productos sin precio en esa
lista quedan fuera. Orden al
cotizar: campaña por producto (SKU) → campaña de margen → precio de lista; si
dos campañas de margen alcanzan al mismo producto manda la más nueva. Si tras
el descuento queda margen bajo 20%, la cotización queda "Pendiente Aprobación". Se puede
pausar y reanudar. La ve quien ve Campañas; crear y cambiar es solo admin.

## MÓDULOS — GRUPO POST-VENTA

### Trazabilidad (/trazabilidad)
Vigila el ciclo documental de cada adjudicada: OC → guías → factura. SLA de 3
días hábiles para despachar desde la OC (con feriados chilenos). Muestra
"Pendiente por Despachar" (OC − guías), tracking del envío, subida de
documentos desde la misma fila (con lectura automática por DamarIA), y cierre
forzado de ciclos con saldo (exige monto, MOTIVO y archivo de respaldo;
reversible). El ícono de paquete junto a cada guía consulta la guía
electrónica en BSALE: lista los productos despachados (SKU, cantidad, precio)
y cruza las referencias de la guía contra el N° de la OC de la cotización. El
ícono de camión junto a cada OC busca en Bsale TODAS las guías que la
referencian (incluidas las no registradas en el sistema) y muestra el monto
despachado y CUÁNTO FALTA POR DESPACHAR = monto OC − despachado según Bsale.
EMITIR FACTURA EN BSALE (administración, contabilidad y jefe_ventas_especial).
Hay dos entradas a lo mismo: el módulo FACTURACIÓN (/facturacion, menú
Post-venta) y, en Trazabilidad, el botón "Emitir factura" de cada guía sin
factura. El módulo tiene tres pestañas: POR DESPACHAR (órdenes de compra de
cotizaciones adjudicadas y abiertas; "Emitir guía" arma la guía de despacho
con los productos de la cotización, descontando lo que ya se despachó según
las guías que hay en Bsale para esa orden, se elige cuánto va en esta entrega,
dirección y tipo de traslado; Bsale descuenta el stock y la guía queda en
Trazabilidad; "Registrar orden en Bsale" deja la orden del cliente como NOTA
DE VENTA en Bsale, sin SII ni stock, y las guías salen enlazadas a ella), POR
FACTURAR (guías sin factura, las más antiguas primero) y EMITIDAS (historial de
facturas, guías y órdenes). Arriba, "Nueva guía" y "Nueva factura" arman un
documento LIBRE, sin orden de compra: cliente por RUT (si no está en Bsale se
crea; giro obligatorio), productos del catálogo con cantidad y precio neto,
despacho (guía) o forma de pago (factura), referencia opcional a OC o guía, y
la cotización donde debe quedar registrado (si no se indica, queda solo en
Bsale y en Emitidas). Referencias a la orden de compra: en guías y notas de
venta la cotización va como FOLIO y el N° de OC como RAZÓN; en facturas el N°
de OC va en el folio (Mercado Público cruza la factura con la OC por ese campo)
y también en la razón; la fila de la GUÍA en una factura lleva el N° de la
guía como folio y el N° de OC como razón. VENTA DIRECTA (botón arriba y
pestaña propia): boleta o factura al instante, sin cotización previa. Boleta:
cliente opcional (sin RUT = consumidor final). Factura: RUT y giro. Pagada al
emitir (efectivo, transferencia, tarjeta, Webpay) o, solo factura, a crédito
con plazo (un cliente bloqueado por mora no puede a crédito). Al emitir se
crea sola la cotización particular ADJUDICADA con esos productos, con la
boleta/factura registrada y, si se pagó, su comprobante de pago; a crédito
queda por cobrar en Seguimiento de Pagos. VISTA PREVIA: al simular, el
documento se ve con su formato (emisor AMSODENT MEDICAL SPA, recuadro del SII,
receptor, referencias con folio y razón, detalle y totales); folio y timbre
los asigna el SII al emitir. ANULAR DOCUMENTO (botón arriba o «Anular» en cada
factura/boleta de Emitidas): anula una factura o boleta COMPLETA con nota de
crédito en Bsale; se busca por tipo y N° (también las hechas a mano en Bsale),
se escribe el motivo y se elige qué pasa con el dinero (rebajar la deuda,
devolver el dinero o sin movimiento); simular y después emitir. Bsale
reingresa el stock. Si está en una cotización, la nota de crédito queda ahí
colgada de la factura y Seguimiento de Pagos la descuenta. No se anula dos
veces. COMPROBANTE AL EMITIR: con la factura o boleta emitida y registrada
aparece "Agregar N° de comprobante de pago" (N°, fecha, monto con IVA, medio);
queda como pago de ese documento y, si cubre el total, lo deja pagado.
EMITIR BOLETA / FACTURA en Trazabilidad: en un cliente particular con la
factura pendiente, arma la boleta o factura con el cliente y los productos de
la cotización y la registra ahí (ítems sin SKU se avisan: no van en Bsale).
GUÍA DESDE LA COTIZACIÓN: en el Detalle de una cotización ADJUDICADA, el botón
"Emitir guía de despacho" (sección Documentos): con una OC sale de ella; con
varias pregunta de cuál; sin OC (particular) se arma con los productos de la
cotización. Empresa de transporte y N° de seguimiento son opcionales: si no se
tienen, la guía muestra "+ N° de seguimiento" para agregarlo después (despacho
interno no: lleva su correlativo AMSO). OBSERVACIÓN DE LA GUÍA: la
observación de cada producto de la cotización se propone en el campo
«Observación» (atributo adicional) de la guía en Bsale; editable antes de
simular, hasta 250 caracteres (sirve también para instrucciones de entrega).
NOTAS DE CRÉDITO: tres modos — anular completa, devolución parcial (cuánto de
cada producto, reingresa ese stock) y ajuste de precio (rebaja por unidad, no
mueve stock); varias mientras quede saldo. NOTA DE DÉBITO: aumenta lo que el
cliente debe por una factura (intereses, diferencia de precio…), líneas de
texto libre y el motivo en la referencia; queda en la cotización y Seguimiento
de Pagos la suma al saldo. TRAZABILIDAD → pestaña FACTURAS: guías por facturar
con «Emitir factura», todas las facturas/boletas con su estado en Bsale y los
botones «N. crédito» / «N. débito», «Nueva factura» y notas por N°. ESTADO EN
BSALE: etiquetas «Anulada en Bsale», «Anulada con NC N°» (sus notas de crédito
suman el total: ya no se cobra), «NC parcial $…», «SII pendiente», «Rechazada
SII» o «No está en Bsale» junto a guías y facturas (Trazabilidad, Pagos,
cotización, Facturación). Cuentan también las NC hechas a mano en Bsale; las que
solo corrigen texto (giro, dirección) no cambian el monto. En la pestaña
Facturas la anulada se ve en gris, con «Anulada» en Pago y sin botones de
notas, y un filtro separa vigentes / anuladas / NC parcial / con nota de débito.
VENTA DIRECTA: pagada al emitir pide el N° de comprobante (salvo efectivo) y
queda en la pestaña «Venta directa» con su cotización. CLIENTE NUEVO EN BSALE:
si el RUT no está, una ventana pide los datos que Bsale exige y lo crea
(«Simular» / «Crear en Bsale»). FICHAS TÉCNICAS EN ZIP: en la cotización
(todas las de sus productos) y en Productos (las filtradas con ficha completa). Las GUÍAS se anulan en Bsale (no hay forma documentada por la API). Una factura libre sin guía descuenta stock en Bsale; si
referencia una guía, no. Un producto sin SKU o cuyo SKU no está en Bsale no
puede ir en ningún documento. El borrador de factura abre
un borrador armado desde la guía que ya existe en Bsale: mismo cliente, mismos
productos y precios, con referencia a la orden de compra y a la guía. Se elige
fecha de emisión, plazo de vencimiento y forma de pago (y se puede corregir el
N° de orden de compra), se marca la casilla de confirmación y se emite: la
factura electrónica va al SII, su PDF queda guardado y aparece registrada en la
cotización, enlazada a su guía. No vuelve a descontar stock. Solo se puede
facturar desde una guía emitida en Bsale; una guía ya facturada (en el sistema
o en Bsale) queda bloqueada, y también si la guía de Bsale es de OTRO cliente
(el número de guía está mal digitado en Trazabilidad: se corrige ahí). El
número de guía es el que encabeza el campo; se puede dejar una nota después
("709 - 2da entrega"). Una factura emitida solo se anula con nota de
crédito, que se hace en Bsale. Todos los borradores (factura, guía, orden) van
en DOS PASOS obligatorios: 1) "Simular" muestra el documento como quedaría
—cliente, productos, totales, referencias, despacho— sin emitir ni guardar nada
(el JSON técnico queda plegado); 2) solo con esa simulación a la vista aparece
"Emitir … oficial", que emite de verdad y se habilita al marcar la casilla de
confirmación. Si se cambia un dato después de simular, hay que simular de
nuevo. Nada se emite solo: siempre es ese botón.

### Seguimiento de Pagos (/seguimiento-pagos)
DOS PESTAÑAS: "Cliente particular" y "Entidad pública". Cada una muestra sus
facturas, sus KPIs y su propio flujo de pago (la pestaña elegida se recuerda).
ORDEN: primero las que faltan por pagar, al final las pagadas. OJO en la
columna Estado (solo pagadas): abre los comprobantes de esa factura (tipo, N°,
fecha, monto bruto, medio) con su archivo. Una factura cuyos pagos cargados
suman el total cuenta como PAGADA aunque nadie la haya marcado; el sistema la
marca sola al registrar el pago que la completa.
El semáforo de cobro: 8 KPIs clickeables (total, pagadas, en plazo, por vencer,
vencidas, factoring —en la pestaña de particulares, "En cuotas"—, notas de
crédito, cierre forzado) que abren el detalle de sus filas. Vencimiento =
fecha factura + plazo de la condición de venta.
PAGO DEL CLIENTE PARTICULAR: el botón "Registrar pago" de la fila (o
"Seguimiento") abre la ventana de seguimiento del pago. Ahí se elige la FORMA
DE PAGO: transferencia, Transbank, Getnet o efectivo. Con Transbank o Getnet se
elige "Sin cuotas" o "En cuotas" (de 2 a 12) y el VALOR POR CUOTA (si se deja
vacío, es el total a cobrar dividido en las cuotas); "Guardar forma de pago"
lo deja en la factura. Debajo está el SEGUIMIENTO: una línea con cada cuota —
las pagadas con su fecha, monto, medio, comisión, detalle y comprobante; las
pendientes con su valor—. En la siguiente pendiente, "Ingresar cuota pagada"
(o "Registrar pago" sin cuotas) pide fecha, monto recibido, medio, comisión
del medio (tarjeta), N° de operación, detalle y el comprobante (imagen o PDF;
obligatorio en transferencia, opcional en el resto). Cada pago se puede
corregir (lápiz) o eliminar (basurero). Cuando los pagos cubren la factura,
"Validar pago" la deja pagada; mientras falten cuotas el estado es "En cuotas
2/6" y la fila muestra una barra de avance.
PAGO DE ENTIDAD PÚBLICA: Registrar pago (abre una ventana; monto bruto →
guarda neto), forma de pago, días de atraso. Si la forma de pago es FACTORING, la ventana pide además el
margen (%) y el plazo (en días o con la fecha de vencimiento; uno calcula al
otro desde la fecha de pago), ambos obligatorios, y la empresa de factoring
(opcional). Esos datos quedan en el módulo Factoring.
CADA FACTURA LLEVA SU PROPIA CUENTA: saldo por pagar = bruto de esa factura −
sus notas de crédito − sus multas − los pagos de esa factura. Lo que una orden
de compra todavía tiene SIN FACTURAR es otra cifra, aparte: se muestra como
"OC por facturar" y no deja pendiente a ninguna factura ya pagada.
PAGOS CON TARJETA: la forma de pago distingue "Tarjeta · Transbank" y "Tarjeta
· Getnet" (ambos depositan en la misma cuenta). Se puede anotar la COMISIÓN
que descontó el medio (lo recibido es menor que la factura, pero la comisión
no es deuda del cliente: la factura queda saldada) y en cuántas CUOTAS se
pagó (máximo 12); cada depósito se registra como un abono y el estado muestra
"En cuotas 3/6". Dónde se registra: en entidades públicas, en "Registrar
pago"; en clientes particulares, en la ventana de seguimiento del pago (ver
arriba), o en el detalle de la cotización como documento "Pago con tarjeta
(Transbank / Getnet)". Para CORREGIR un pago ya registrado (medio, fecha,
monto recibido, comisión) o las cuotas pactadas: en entidades públicas, botón
"Pagos" de la fila; en clientes particulares, botón "Seguimiento". La columna
"Saldo por pagar" muestra lo que le falta a cada factura (su monto completo si
no tiene pagos, 0 si está pagada). El reporte en Excel (de la pestaña que se
está viendo) trae RUT del cliente, recibido, comisión, cuotas, valor de la
cuota y una hoja aparte "OC por facturar".
Botón "Correo cobro" genera el borrador de cobranza (OC, guía, factura,
despacho) para que el usuario lo envíe desde su propio correo. La mora
acumulada de un cliente bloquea nuevas cotizaciones para ese cliente.
CALENDARIO DE COBRANZA automático (08:00, días HÁBILES respecto del
vencimiento): 3 días antes → correo; al vencer → correo; +5 → correo; +7 →
llamada; +10 → correo; +15 → visita. Cada hito alerta en la campana a los
jefe_ventas_especial y agenda la gestión como actividad pendiente en su
Bitácora; el correo lo envía siempre la persona (nada sale automático).

### Cobranza (/cobranza)
Gestión de lo vencido: Sin gestión → En gestión → Comprometida. Acceso: admin,
contabilidad y jefe_ventas_especial.

### Factoring (/factoring)
Facturas cedidas a factoring: empresa, margen (% y $), plazo. El margen y el
plazo llegan desde Seguimiento de Pagos (se piden al registrar el pago por
factoring); aquí se completa lo que falte. Con empresa, margen y plazo
cargados, la fila queda bloqueada salvo para administración.
SEMÁFORO DEL PLAZO (según la fecha de vencimiento del factoring): verde si
faltan más de 7 días, amarillo si faltan 7 o menos (incluye el día del
vencimiento), rojo si ya venció. Sobre la tabla, los botones "En plazo", "Por
vencer", "Vencidos" y "Sin plazo" muestran cuántas facturas hay en cada color
y filtran la tabla con un clic; lo más urgente queda arriba.
AVISOS AUTOMÁTICOS por campana y correo (desde las 08:00): 7 y 3 días antes del
vencimiento, el mismo día, y 1, 7 y 15 días después. Cada aviso sale una sola
vez por factura; si se corrige la fecha de vencimiento, el calendario parte de
nuevo. Una factura sin fecha de vencimiento no tiene semáforo ni avisos.

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

### Ofertas del Portal (/ofertas-portal)
Las OFERTAS ESPECIALES que el cliente ve en la pestaña "Ofertas" de su portal.
Una oferta es un descuento en % por PRODUCTO, CATEGORÍA o MARCA, con fecha de
inicio y de término. El descuento se aplica sobre el precio del cliente del
portal (lista 2); el cliente ve el precio normal tachado, el precio de oferta,
cuánto ahorra y hasta cuándo rige, y agrega los productos al carrito de
siempre. Al crear la oferta se muestra una simulación: cuántos productos
entran y cuántos quedan bajo el costo o bajo 20 % de margen (en ese caso la
cotización puede quedar "Pendiente Aprobación"). Si dos ofertas alcanzan al
mismo producto, el cliente ve la de mayor descuento. Se pueden pausar y
reanudar. El precio de oferta lo valida el servidor al recibir el pedido (si
la oferta ya venció, la línea vuelve al precio normal), se ve en Pedidos del
Portal con la marca "Oferta", y al crear la cotización desde el pedido el ítem
nace con ese precio y la observación "Oferta especial". Verlas: quien ve
Pedidos del Portal. Crear, editar, pausar y eliminar: solo admin.

### Acceso Portal Clientes (/portal-accesos)
MÓDULOS POR CLIENTE: el botón "Módulos" de cada cliente enciende o apaga las
secciones de su portal (Gestión de Stock, Mis cotizaciones, Ofertas, Showroom,
Explorador de precios, Actividad), p. ej. Showroom sí y Ofertas no. Resumen
siempre está; Usuarios depende del rol. Mis cotizaciones queda encendida
mientras el cliente pueda pedir desde otra sección. Sin Explorador, el carrito
sigue como "Mi pedido". El servidor lo exige: una sección apagada no entrega
sus datos y, sin Ofertas, los pedidos van a precio normal.
Credenciales del portal de stock: crear, renovar, revocar; y pestaña de
recuperaciones de contraseña.

### Portales públicos (sin sesión interna)
- /portal — Portal del Cliente: entra con RUT + N° de cotización; ve sus
  cotizaciones, documentos y puede subir archivos.
- /portal-cliente — Portal de Stock del cliente: acuerdo de confidencialidad,
  inventario propio con semáforo, y generación de solicitudes de cotización
  que llegan al sistema. Incluye el Explorador de precios: el cliente busca un
  insumo por palabra clave y el portal compara en vivo los precios de las
  tiendas dentales chilenas online (la tienda propia amsodentmedical.cl SIEMPRE
  primera y destacada, más Orbis, Gexa, SP Dental, Clandent, J-Dent, Techdent y
  Denteeth), guardando un histórico por producto (mínimo registrado
  y variación contra la captura anterior), estilo Knasta/SoloTodo.
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
adjudicadas y de VENTAS TOTALES se abren con clic y muestran el detalle de
documentos con export a Excel. Orden del panel: KPIs → Avance de Metas
(global + tarjeta por ejecutivo, solo equipo de ventas) → gráficos →
indicadores → Resumen por Región → COMPARATIVO DE FACTURACIÓN Bsale vs
sistema (neto emitido en Bsale — facturas+boletas−NC — contra las
facturas/boletas registradas; solo admin) → ÓRDENES DE COMPRA CON SALDO POR
CONSUMIR (OC − despachado/facturado, SIN filtro de fecha, con export). El
panel Particular incluye el embudo Prospecto → Contactado → Cotiza → Compra,
más el KPI de VENTA TOTAL del mes (neto).

### Análisis Mercado Público (/analisis-mercado-publico) — solo admin
Compara nuestra postulación vs el ganador real de cada licitación (datos de la
API de Mercado Público, sincronización nocturna): brechas de precio,
competidores frecuentes, simulador de descuento con recomendación de DamarIA, y
el panel de diferencias contra el Panel de Indicadores (conciliación por causa,
inconsistencias de estados, export). Al pie: ANÁLISIS DE PRODUCTOS de nuestras
fichas (qué ganamos/perdemos y a qué precio) y ANÁLISIS GLOBAL DE PRODUCTOS
"sin haber licitado": barre las licitaciones ADJUDICADAS de todo Mercado
Público de los últimos 30 días que calzan con el catálogo de palabras clave y
muestra por producto los procesos, cantidades, precio unitario adjudicado
promedio, monto y ganador frecuente. Se actualiza SOLO cada día a las 06:00
(MP_ANALISIS_GLOBAL_AUTO); si una corrida falla o se corta, el panel muestra
el motivo y conserva el resultado anterior. Refrescarlo a mano gasta ~110
llamadas del ticket (solo exploradores autorizados).

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
  Se puede mover: el botón del girasol se arrastra, y el panel abierto se
  arrastra desde su cabecera (doble clic en la cabecera lo devuelve a la
  esquina). La posición queda recordada en ese navegador.
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
  pendientes no se puede generar el PDF. BYPASS: si la cotización ya tiene una
  orden de compra cargada, la aprobación pendiente no retiene — cualquier
  usuario puede avanzar el estado (el cliente ya compró) y al guardar no se
  fuerza de vuelta a los estados pendientes.
- ADJUDICADA REAL: en los paneles manda el documento (OC o boleta), no el
  estado manual.
- TOMAS: máximo 3 postulaciones tomadas vigentes por persona.
- MORA: cliente con facturas vencidas queda bloqueado para nuevas cotizaciones.
- SLA DESPACHO: 3 días hábiles desde la OC (feriados chilenos).
- LISTAS DE PRECIO: Lista 3 = Lista 2 × 1,08 (automática).
- FLETE GRATIS: dos reglas — (1) destino San Bernardo: SIEMPRE gratis, sin
  mínimo de compra; (2) compra ≥ $70.000 (bruto) con destino en la Región
  Metropolitana (cualquier tipo de cotización y courier). En cualquier otro
  caso el flete se calcula con la Calculadora de Flete.
- FLETE POR PAGAR (solo cliente particular): checkbox en la sección de flete;
  la cotización no cobra flete (queda "POR PAGAR"), el cliente lo paga
  directo al courier al recibir, y el PDF lo declara como ítem "Despacho /
  Flete — POR PAGAR". Con esta opción no se exige calcular el flete.
- FLETE OBLIGATORIO PARA EL PDF: no se puede generar el PDF de una cotización
  sin haber calculado y aplicado el flete (aunque el resultado sea $0). El
  sistema recuerda con un aviso pasar por la Calculadora de Flete.
- PDF CLIENTE PARTICULAR: el flete aparece como un ítem aparte ("Despacho /
  Flete") con los precios de los productos sin el flete diluido. En entidad
  pública el flete sigue prorrateado dentro del precio de cada producto.
- PRODUCTOS SIN PESO: al crear una cotización, los ítems cuyo producto no
  tiene peso registrado se destacan en color violeta con el aviso "Producto
  sin peso registrado".
- MEDIDAS Y PESO DE PRODUCTOS: solo se pueden editar en productos
  TRANSITORIOS (y en Pendiente Aprobación); en los Activos vienen del maestro
  y quedan de solo lectura.
- HISTORIAL DE LA COTIZACIÓN: en el detalle de cada cotización, el botón
  "Historial" abre una línea de tiempo con todos los hitos (creación,
  adjudicación, documentos, pagos, actividades y gestiones de cobranza).
- SEGUNDO CONTACTO: las cotizaciones tipo licitación (entidad pública) tienen
  campos adicionales Nombre/Correo/Teléfono (contacto 2).
- FILTRO RUT: el listado de cotizaciones permite filtrar por RUT del cliente
  (sin importar el formato de puntos y guion).
- BANCO DEL PAGO: al registrar un pago en Seguimiento de Pagos (todas las
  formas salvo efectivo) se elige el banco receptor: Itaú o Santander.
- COBRANZA ESTILO GMAIL: en Cobranza → Historial de gestiones, cada correo
  enviado guarda su hilo de Gmail; "Ver conversación completa" muestra el
  correo enviado y TODAS las respuestas del cliente en la misma vista.
- EXPLORADOR DE PRECIOS INTERNO (/explorador-precios, solo admin): el mismo
  buscador del portal desde la plataforma. Cada tarjeta tiene «Crear producto»:
  lo crea como TRANSITORIO (sin SKU) con nombre, categoría y formato (marca,
  costo y listas opcionales), el link de la tienda en «link de referencia» y su
  imagen; «Simular» revisa sin crear. Si ya hay un producto con ese link (se
  compara sin ?srsltid, www ni barra final), la tarjeta dice «Ya creado» y
  enlaza a su ficha. El explorador del portal cliente no tiene ese botón.
- CARRITO DEL PORTAL: en el Explorador de Precios del portal cliente, el botón
  "Agregar" junta productos en "Mi pedido". Checkout en 2 pasos: primero se
  edita el carrito (cantidades, nota) y "Revisar pedido" abre el resumen
  formal (cliente, fecha, detalle con subtotales, total referencial y datos
  de contacto opcionales); recién "Confirmar y enviar pedido" lo despacha —
  nunca se envía directo. Llega al equipo como solicitud (campana + correo)
  con precio y tienda de referencia por producto. Cada producto del carrito
  acepta una OBSERVACION del cliente (tono, formato, marca) que el equipo ve
  en Pedidos del Portal y en el PDF del pedido. Las tarjetas del explorador
  muestran el chip "EN EL PEDIDO" con contador -/+ cuando el producto ya está
  en el carrito.
- TIENDAS DEL EXPLORADOR (mantenedor, solo admin): en Acceso Portal Clientes →
  pestaña "Tiendas del Explorador" se administran las páginas que consulta el
  buscador (agregar/editar/activar/ordenar). Se soportan tiendas Shopify,
  WooCommerce con API pública y Odoo; la de Amsodent es tipo "Web Amsodent"
  (su web propia desde octubre 2026: se lee el catálogo y cada ficha para el SKU
  real y las variantes); el botón "Probar conexión" valida el sitio
  con una búsqueda real antes de activarlo. Amsodent siempre va primera y no
  se puede desactivar. Requiere la migración 20260910_explorador_tiendas.
- SALDO OC (Despachos y Choferes → pestaña "Saldo OC"): detalle de las OC de
  adjudicadas con ciclo abierto en dos grupos — pendientes de envío (sin
  ninguna guía) y con saldo por consumir (OC − guías > 0, despachos
  parciales) — con antigüedad, montos netos y link a la cotización.
- PEDIDOS DEL PORTAL (/pedidos-portal): bandeja interna con TODOS los pedidos
  generados desde el portal cliente, sin importar el origen (carrito del
  Explorador de Precios o Gestión de Stock). Muestra cliente, contacto,
  sucursal, ítems con referencias, nota y mensajes; permite cambiar estado,
  abrir la cotización vinculada o crear una nueva precargada desde el pedido.
  Acceso: mismos permisos que Monitoreo Stock (ventas especial y admin).
- CORREO ALTERNO: en Usuarios, cada persona puede tener una segunda casilla
  asociada (profiles.email_alterno); la plataforma reconoce ambos correos
  como el mismo usuario (ej: Jeremías con jer.consorcio@gmail.com y
  jer.alarcon@amsodentmedical.cl).
- Si un módulo muestra "Falta aplicar la migración X": el admin debe ejecutar
  ese archivo SQL en Supabase (carpeta supabase/migrations).
`;
