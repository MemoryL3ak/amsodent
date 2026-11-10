import { esNotaSinSuFactura } from "./notasSinFactura";

/* ── Cuenta por factura (movido desde SeguimientoPagos.jsx el 2026-11-09) ──
   Vencimiento, saldo y estado de pago de cada factura. Lo usan Seguimiento de
   Pagos (equipo) y la sección «Facturas» del portal del cliente, para que los
   dos vean exactamente las mismas cifras. Funciones puras: sin React ni API.
   Convenciones: ver [[montos-documentos-neto]] — facturas y pagos NETOS
   (× 1,19 al leer); notas de crédito, débito y multas BRUTAS. */

// Monto BRUTO de una cotización para pagos. Convención de los datos:
//  - La OC se carga NETA ("Monto Neto OC") → bruto = OC × 1,19.
//  - Los comprobantes/pagos (transferencia, webpay, efectivo) se guardan
//    NETOS, igual que la factura → bruto = neto × 1,19 al leerlos aquí.
// El saldo siempre compara bruto contra bruto. Sin OC, cae al bruto de la
// cotización (total_con_iva, o total_sin_iva × 1,19).
export function montoBrutoPago(ocSum, lic) {
  const oc = Number(ocSum || 0);
  if (oc > 0) return Math.round(oc * 1.19);
  const conIva = Number(lic?.total_con_iva || 0);
  if (conIva > 0) return conIva;
  return Math.round(Number(lic?.total_sin_iva || 0) * 1.19);
}

export function diasEntre(fechaIso) {
  if (!fechaIso) return null;
  const f = new Date(`${fechaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ms = hoy.getTime() - f.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function plazoDias(condVenta) {
  const c = (condVenta || "").toString().toLowerCase();
  const m = c.match(/(\d+)/);
  if (m) return Number(m[1]);
  if (c.includes("contado")) return 0;
  return 30;
}

// Elimina facturas duplicadas para que los KPIs y la tabla no cuenten ni sumen
// dos veces la misma. Una factura se considera repetida si tiene el MISMO número
// dentro de la MISMA cotización (case-insensitive). Las facturas sin número no se
// pueden identificar como duplicadas, así que se conservan todas. Entre repetidas
// se conserva la más completa: primero la que tenga monto cargado; si empatan, la
// de id menor (la primera que se cargó). También descarta filas con id repetido.
export function dedupFacturas(arr) {
  const porId = new Map();
  for (const f of arr || []) {
    if (f?.id == null) continue;
    if (!porId.has(f.id)) porId.set(f.id, f);
  }
  const porClave = new Map();
  const sinNumero = [];
  for (const f of porId.values()) {
    const num = String(f?.numero || "").trim().toLowerCase();
    if (!num) { sinNumero.push(f); continue; }
    const clave = `${f.licitacion_id}::${num}`;
    const prev = porClave.get(clave);
    if (!prev) { porClave.set(clave, f); continue; }
    const fTieneMonto = Number(f?.monto || 0) > 0;
    const prevTieneMonto = Number(prev?.monto || 0) > 0;
    let mejor;
    if (fTieneMonto !== prevTieneMonto) mejor = fTieneMonto ? f : prev;
    else mejor = Number(f.id) < Number(prev.id) ? f : prev;
    porClave.set(clave, mejor);
  }
  return [...porClave.values(), ...sinNumero];
}

export function calcularFechaVencimiento(fechaFacturaIso, condVenta) {
  if (!fechaFacturaIso) return null;
  const f = new Date(`${fechaFacturaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const plazo = plazoDias(condVenta);
  f.setDate(f.getDate() + plazo);
  return f;
}

/* ── Cuenta de cada factura (2026-10-01) ─────────────────────────────────────
   Antes el saldo se calculaba POR COTIZACIÓN y se le colgaba a cada una de sus
   facturas: base = la orden de compra entera, pagado = todos los comprobantes
   de la cotización. Con una sola factura por OC daba bien; con varias, no:

     OC 5215-253-SE26 por $8.494.101, factura 501 por $5.393.080 ya pagada.
     Saldo que se mostraba para la 501: 8.494.101 − 5.393.080 = $3.101.021,
     y la factura quedaba "Pendiente de pago" — por plata que en realidad
     era de la factura 757 más $808.962 que todavía ni se facturan. Y como el
     mismo saldo se repetía en cada factura de la OC, el reporte lo sumaba
     una vez por factura.

   Ahora cada factura lleva su propia cuenta:

     saldo por pagar = bruto de ESA factura − sus notas de crédito − sus
                       multas − los pagos imputados a ESA factura

   y lo que la OC tiene sin facturar es otra cifra, aparte y por OC ("saldo por
   facturar"), que no toca el estado de pago de ninguna factura.

   Imputación: los pagos, notas de crédito y multas registrados desde este
   módulo guardan `deriva_de_id` = la factura. Los que no lo traen (comprobantes
   subidos desde Trazabilidad) se aplican en cascada a las facturas de la
   cotización, de la más antigua a la más nueva, hasta cubrir cada una; con una
   sola factura eso equivale a imputárselo a ella. Excepción: una nota de
   crédito/débito emitida desde la app que perdió su factura (se eliminó la
   factura) no se reparte; ver lib/notasSinFactura.js. */
/* Diferencia que se considera redondeo y no deuda. Los montos se guardan
   netos y se llevan a bruto × 1,19 al leer; el pago se digita bruto y se
   guarda neto. Entre una conversión y otra se pierden unos pocos pesos: la
   factura 253 (Maipú, $11,6 millones) quedaba "pendiente" por $3. Cinco pesos
   cubren eso sin tragarse nada real — una comisión de Transbank, la
   diferencia legítima más chica que se ha visto, ronda los $100. */
export const TOLERANCIA_SALDO = 5;

export function calcularCuentas({ facturas, licMap, montoOcMap, pagosMap, notasCreditoMap, notasDebitoMap, multasMap, guiasMap }) {
  const porFactura = {};
  const porLic = {};

  const grupos = new Map();
  for (const f of facturas || []) {
    if (!grupos.has(f.licitacion_id)) grupos.set(f.licitacion_id, []);
    grupos.get(f.licitacion_id).push(f);
  }
  const brutoDe = (f) => {
    const neto = Number(f?.monto || 0);
    return neto > 0 ? Math.round(neto * 1.19) : 0;
  };
  const claveOrden = (f) => `${String(f.fecha_factura || f.created_at || "9999")}|${String(f.id).padStart(12, "0")}`;

  for (const [lid, lista] of grupos) {
    const lic = (licMap || {})[lid] || {};
    const particular = esClienteParticular(lic);
    const ordenadas = [...lista].sort((a, b) => claveOrden(a).localeCompare(claveOrden(b)));
    const ocBruto = Number(montoOcMap?.[lid] || 0) > 0 ? Math.round(Number(montoOcMap[lid]) * 1.19) : 0;
    const baseLic = particular ? Number(lic.total_con_iva) || 0 : montoBrutoPago(montoOcMap?.[lid], lic);
    const sumaFacturado = ordenadas.reduce((acc, f) => acc + brutoDe(f), 0);
    const haySinMonto = ordenadas.some((f) => brutoDe(f) === 0);

    const cuentas = ordenadas.map((f) => {
      const propio = brutoDe(f);
      return {
        id: f.id,
        // Factura sin monto cargado (datos antiguos): se le atribuye lo que la
        // cotización no tiene cubierto por las demás, que con una sola factura
        // es el total de siempre.
        base: propio > 0 ? propio : Math.max(0, baseLic - sumaFacturado),
        recibido: 0,
        comision: 0,
        nc: 0,
        // Nota de débito (2026-10-07): suma a lo que se debe de la factura (bruta).
        nd: 0,
        multas: 0,
        abonos: 0,
        // Medio del último pago imputado. Para el cliente particular la
        // factura no guarda forma_pago: el medio vive en sus comprobantes.
        medio: null,
      };
    });
    const porId = new Map(cuentas.map((c) => [c.id, c]));
    const faltaDe = (c) => c.base + c.nd - c.nc - c.multas - c.recibido - c.comision;

    const repartir = (docs, aplicar, montoDe) => {
      const sueltos = [];
      for (const d of docs || []) {
        const c = d?.deriva_de_id != null ? porId.get(d.deriva_de_id) : null;
        if (c) aplicar(c, d, montoDe(d));
        else sueltos.push(d);
      }
      // Sin vínculo a una factura: en cascada, de la más antigua a la más nueva.
      for (const d of sueltos) {
        let resto = montoDe(d);
        for (const c of cuentas) {
          if (resto <= 0) break;
          const falta = faltaDe(c);
          if (falta <= 0) continue;
          const toma = Math.min(resto, falta);
          aplicar(c, d, toma);
          resto -= toma;
        }
        // Lo que sobra (pago en exceso) queda a la vista en la última factura.
        if (resto > 0) aplicar(cuentas[cuentas.length - 1], d, resto);
      }
    };

    // (2026-11-03) Una nota emitida desde la app que perdió su factura (se
    // eliminó la factura y el vínculo quedó en NULL) no se reparte: en Bsale
    // sigue anulando a la original y no debe descontar de la factura nueva
    // (#5125: las NC 185 y 186 de la 862 aparecían descontando la 922).
    const conSuFactura = (docs) => (docs || []).filter((d) => !esNotaSinSuFactura(d, (id) => porId.has(id)));
    repartir(conSuFactura(notasDebitoMap?.[lid]), (c, _d, m) => { c.nd += m; }, (d) => Number(d?.monto || 0));
    repartir(conSuFactura(notasCreditoMap?.[lid]), (c, _d, m) => { c.nc += m; }, (d) => Number(d?.monto || 0));
    repartir(multasMap?.[lid], (c, _d, m) => { c.multas += m; }, (d) => Number(d?.monto || 0));
    // Pagos: lo recibido se guarda NETO (× 1,19 al leer). La comisión del
    // medio de pago (Transbank/Getnet) va aparte y en bruto: no se recibió,
    // pero tampoco se le debe cobrar al cliente, así que también salda.
    repartir(
      pagosMap?.[lid],
      (c, d, m) => {
        const total = Math.round(Number(d?.monto || 0) * 1.19) + Number(d?.comision_pago || 0);
        const comision = total > 0 ? Math.round(m * (Number(d?.comision_pago || 0) / total)) : 0;
        c.recibido += m - comision;
        c.comision += comision;
        c.abonos += 1;
        c.medio =
          d?.forma_pago ||
          (d?.tipo === "webpay" ? "transbank" : d?.tipo === "efectivo" ? "efectivo" : c.medio || "transferencia");
      },
      (d) => Math.round(Number(d?.monto || 0) * 1.19) + Number(d?.comision_pago || 0),
    );

    for (const c of cuentas) {
      const pagado = c.recibido + c.comision;
      porFactura[c.id] = {
        base: c.base,
        recibido: c.recibido,
        comision: c.comision,
        pagado,
        nc: c.nc,
        nd: c.nd,
        multas: c.multas,
        abonos: c.abonos,
        medio: c.medio,
        cargas: pagado + c.nc + c.multas,
        /* Cierre forzado: el saldo que se contabiliza es 0. Un pago anotado por
           el total de la orden (así lo sugería el formulario antes) dejaba la
           factura con saldo NEGATIVO por lo que la orden nunca facturó; en una
           orden cerrada eso no es un pago en exceso, es saldo que ya no cuenta. */
        saldo: lic.ciclo_cerrado
          ? Math.max(0, Math.round(c.base + c.nd - c.nc - c.multas - pagado))
          : Math.round(c.base + c.nd - c.nc - c.multas - pagado),
      };
    }

    // Saldo de la OC por facturar: solo sector público con OC, ciclo abierto y
    // todas las facturas con su monto (si a alguna le falta, no se puede saber).
    // La tolerancia cubre el redondeo de aplicar el IVA factura por factura.
    let porFacturar = 0;
    if (!particular && ocBruto > 0 && !lic.ciclo_cerrado && !haySinMonto) {
      const dif = ocBruto - sumaFacturado;
      if (dif > ordenadas.length + 1) porFacturar = dif;
    }
    /* Con cuánto saldo se cerró una orden con cierre forzado (neto, OC − guías,
       igual que en Trazabilidad). No se contabiliza —el saldo de una orden
       cerrada es 0— pero no se pierde: se informa. Sale de `monto_forzado`; si
       el cierre es antiguo y no lo guardó, se calcula de los documentos. */
    let saldoAlCerrar = null;
    if (lic.ciclo_cerrado) {
      const guardado = Number(lic.monto_forzado || 0);
      const guiasNeto = (guiasMap?.[lid] || []).reduce((acc, g) => acc + Number(g?.monto || 0), 0);
      const calculado = Math.max(0, Math.round(Number(montoOcMap?.[lid] || 0) - guiasNeto));
      saldoAlCerrar = guardado > 0 ? guardado : calculado;
    }
    porLic[lid] = { ocBruto, facturado: sumaFacturado, porFacturar, facturas: ordenadas.length, saldoAlCerrar };
  }
  return { porFactura, porLic };
}

export function esClienteParticular(lic) {
  return (lic?.tipo_cliente || "").toString().toLowerCase().includes("particular");
}

/* ── Estado de pago de UNA factura a partir de su cuenta (2026-11-09) ────────
   Antes vivían como funciones internas de SeguimientoPagos.jsx (descalceMontos,
   cubiertaPorPagos, estaPagada, saldoMostrado, enCuotasDe); ahora reciben la
   factura y su cuenta (de calcularCuentas) y la pantalla solo las llama. */
export const CUENTA_VACIA = { base: 0, recibido: 0, comision: 0, pagado: 0, nc: 0, nd: 0, multas: 0, abonos: 0, medio: null, cargas: 0, saldo: 0 };

// Punto 17: con montos de pago cargados que no cuadran, la factura no está
// pagada aunque tenga el flag. Sin montos cargados se respeta «marcar pagada».
export function descalceDeCuenta(f, c) {
  if (c.cargas <= 0) return false; // nada cargado aún
  if (f?.pagada && c.abonos <= 0) return false; // marcada pagada sin pagos (multa o NC después)
  return c.saldo > TOLERANCIA_SALDO;
}

// Cubierta por sus pagos aunque nadie la haya marcado pagada (2026-10-07).
export function cuentaCubierta(c) {
  return c.abonos > 0 && c.saldo <= TOLERANCIA_SALDO;
}

// Pagada «efectiva»: el flag (salvo descalce) o cubierta por sus pagos.
export function pagadaSegunCuenta(f, c) {
  return (Boolean(f?.pagada) && !descalceDeCuenta(f, c)) || cuentaCubierta(c);
}

// Saldo que se muestra: marcada pagada sin montos = 0; si no, lo que falta.
export function saldoMostradoDe(f, c) {
  return f?.pagada && c.abonos <= 0 ? 0 : c.saldo;
}

// En cuotas: se pactó en más de una y todavía falta que el medio deposite.
export function enCuotasSegunCuenta(f, c, lic) {
  if (!(Number(f?.cuotas_total) > 1)) return false;
  if (f?.pagada && c.abonos <= 0) return false; // marcada pagada sin montos
  if (c.cargas <= 0 && !esClienteParticular(lic)) return false;
  return c.saldo > TOLERANCIA_SALDO;
}

/* Estado de una factura para mostrarla, con el mismo orden de reglas que la
   columna «Estado» de Seguimiento de Pagos, más «Anulada»: una factura que sus
   notas de crédito cubren entera (Seguimiento lo muestra con el estado de
   Bsale; el cliente no lo tiene). `hoyIso` = fecha de hoy (AAAA-MM-DD). */
export function estadoDeFactura(f, c, lic, hoyIso) {
  const venc = calcularFechaVencimiento(f?.fecha_factura, lic?.condicion_venta);
  const vencimiento = venc ? `${venc.getFullYear()}-${String(venc.getMonth() + 1).padStart(2, "0")}-${String(venc.getDate()).padStart(2, "0")}` : null;
  const restantes = vencimiento && hoyIso
    ? Math.round((new Date(`${vencimiento}T00:00:00`) - new Date(`${hoyIso}T00:00:00`)) / 86400000)
    : null;
  const saldo = Math.max(0, saldoMostradoDe(f, c));
  const base = { vencimiento, dias_restantes: restantes, saldo };
  // Aunque se hubiera pagado: lo pagado vuelve como devolución o saldo a favor.
  if (c.base > 0 && c.nc >= c.base - TOLERANCIA_SALDO) return { ...base, saldo: 0, clave: "anulada", etiqueta: "Anulada con nota de crédito" };
  if (enCuotasSegunCuenta(f, c, lic)) return { ...base, clave: "en_cuotas", etiqueta: `En cuotas ${Math.min(c.abonos, Number(f.cuotas_total))}/${Number(f.cuotas_total)}` };
  if (descalceDeCuenta(f, c)) return { ...base, clave: "pendiente", etiqueta: "Pendiente de pago" };
  if (pagadaSegunCuenta(f, c)) return { ...base, saldo: 0, clave: "pagada", etiqueta: "Pagada" };
  if (restantes == null) return { ...base, clave: "sin_fecha", etiqueta: "Sin fecha" };
  if (restantes < 0) return { ...base, clave: "vencida", etiqueta: "Vencida" };
  if (restantes <= 5) return { ...base, clave: "por_vencer", etiqueta: "Por vencer" };
  return { ...base, clave: "en_plazo", etiqueta: "En plazo" };
}
