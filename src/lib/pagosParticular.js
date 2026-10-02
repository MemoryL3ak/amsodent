/* ── Pago del cliente particular (Seguimiento de Pagos, 2026-10-02) ──────────
   Lógica pura del seguimiento: con qué medio paga, en cuántas cuotas, cuánto
   vale cada una y qué cuotas ya entraron. La pantalla y la ventana de
   seguimiento usan estas mismas funciones, así no hay dos formas de contar.

   Dónde vive cada dato (tabla `licitacion_documentos`):
     · en la FACTURA / boleta → el plan: `forma_pago` (medio), `cuotas_total`
       (1 = sin cuotas) y `valor_cuota` (bruto, lo que paga el cliente en cada
       una);
     · en cada COMPROBANTE → un pago: `fecha_oc`, `monto` (neto: lo recibido
       ÷ 1,19), `comision_pago` (bruto), `numero` (N° de operación),
       `detalle_pago` y el archivo.
   La cuota de cada pago sale de su orden por fecha: el primero es la cuota 1. */

export const MAX_CUOTAS = 12;

export const MEDIOS_PARTICULAR = [
  { value: "transferencia", label: "Transferencia" },
  { value: "transbank", label: "Transbank" },
  { value: "getnet", label: "Getnet" },
  { value: "efectivo", label: "Efectivo" },
];

// «Sin cuotas» y de 2 a 12: lo mismo en todos los formularios de pago.
export const OPCIONES_CUOTAS = [
  { value: "1", label: "Sin cuotas" },
  ...Array.from({ length: MAX_CUOTAS - 1 }, (_, i) => ({ value: String(i + 2), label: `${i + 2} cuotas` })),
];

// Medios que depositan con comisión descontada y pueden ir en cuotas.
export const esPagoTarjeta = (forma) => forma === "transbank" || forma === "getnet";

export const soloDigitos = (v) => Math.round(Number(String(v ?? "").replace(/[^\d]/g, "")) || 0);

export const limitarCuotas = (n) => Math.max(1, Math.min(MAX_CUOTAS, Math.round(Number(n) || 1)));

export const fmtCLP = (v) => `$${Math.round(Number(v || 0)).toLocaleString("es-CL")}`;

// Fecha de hoy en hora local (toISOString la pasaría a UTC y de noche corre el día).
export function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Medio de un pago ya registrado. Los antiguos no traen `forma_pago`: sale del tipo.
export function medioDelPago(doc) {
  return (
    doc?.forma_pago ||
    (doc?.tipo === "webpay" ? "transbank" : doc?.tipo === "efectivo" ? "efectivo" : "transferencia")
  );
}

export const etiquetaMedioParticular = (valor) =>
  MEDIOS_PARTICULAR.find((x) => x.value === valor)?.label || valor || "";

// Lo que entró a la cuenta por un pago, con IVA (se guarda neto).
export const recibidoDelPago = (doc) => Math.round(Number(doc?.monto || 0) * 1.19);

export const fechaDelPago = (doc) => String(doc?.fecha_oc || doc?.created_at || "").slice(0, 10);

/* Plan guardado de una factura. El medio es el de la factura; si nunca se
   guardó, el de su último pago; si tampoco hay pagos, transferencia. Las
   cuotas solo existen con tarjeta. */
export function planDeFactura(factura, cuenta) {
  const valido = (m) => MEDIOS_PARTICULAR.some((x) => x.value === m);
  const medio = valido(factura?.forma_pago) ? factura.forma_pago : valido(cuenta?.medio) ? cuenta.medio : "transferencia";
  const cuotas = esPagoTarjeta(medio) ? limitarCuotas(factura?.cuotas_total) : 1;
  const valorCuota = cuotas > 1 ? Math.max(0, Math.round(Number(factura?.valor_cuota) || 0)) : 0;
  return { medio, cuotas, valorCuota };
}

/* Arma el seguimiento de una factura: una fila por cada pago que ya entró y,
   mientras quede saldo, una por cada cuota que falta.

     { plan, aCobrar, pagado, saldo, valorCuota, pagadas, total, filas }

   filas: { clave, n, estado: "pagada", pago, monto }           ← ya entró
          { clave, n, estado: "pendiente", esperado, siguiente } ← falta

   `cuenta` es la cuenta de la factura que calcula Seguimiento de Pagos
   (base, nc, multas, pagado, saldo). La última cuota pendiente se lleva lo
   que quede de saldo, así el redondeo de dividir no deja pesos sueltos. */
export function construirSeguimiento({ factura, cuenta, pagos, tolerancia = 5 }) {
  const plan = planDeFactura(factura, cuenta);
  const aCobrar = Math.max(0, Math.round(Number(cuenta?.base || 0) - Number(cuenta?.nc || 0) - Number(cuenta?.multas || 0)));
  const saldo = Math.round(Number(cuenta?.saldo || 0));
  const valorCuota = plan.cuotas > 1 ? (plan.valorCuota > 0 ? plan.valorCuota : Math.round(aCobrar / plan.cuotas)) : aCobrar;

  const orden = (d) => `${fechaDelPago(d) || "9999-99-99"}|${String(d?.id ?? "").padStart(12, "0")}`;
  const ordenados = [...(pagos || [])].sort((a, b) => orden(a).localeCompare(orden(b)));

  const filas = ordenados.map((pago, i) => ({
    clave: `pago-${pago.id ?? i}`,
    n: i + 1,
    estado: "pagada",
    pago,
    monto: recibidoDelPago(pago) + Math.round(Number(pago?.comision_pago || 0)),
  }));

  let restante = saldo > tolerancia ? saldo : 0;
  if (restante > 0) {
    const porVenir = plan.cuotas > 1 ? Math.max(1, plan.cuotas - ordenados.length) : 1;
    for (let k = 1; k <= porVenir && restante > 0; k++) {
      const esperado = k === porVenir ? restante : Math.min(valorCuota, restante);
      filas.push({ clave: `pendiente-${k}`, n: ordenados.length + k, estado: "pendiente", esperado, siguiente: k === 1 });
      restante -= esperado;
    }
  }

  return {
    plan,
    aCobrar,
    pagado: Math.round(Number(cuenta?.pagado || 0)),
    saldo,
    valorCuota,
    pagadas: ordenados.length,
    // Con pagos de más o de menos que lo pactado, manda lo que realmente hay.
    total: Math.max(plan.cuotas, filas.length),
    filas,
  };
}
