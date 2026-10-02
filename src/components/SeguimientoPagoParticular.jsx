import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Banknote, Check, CheckCircle2, CreditCard, Eye, Landmark, Paperclip, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import DateFilter from "./DateFilter";
import DropdownSelect from "./ui/DropdownSelect";
import ConfirmModal from "./ConfirmModal";
import {
  MEDIOS_PARTICULAR,
  OPCIONES_CUOTAS,
  construirSeguimiento,
  esPagoTarjeta,
  etiquetaMedioParticular,
  fechaDelPago,
  fmtCLP,
  hoyISO,
  limitarCuotas,
  medioDelPago,
  planDeFactura,
  recibidoDelPago,
  soloDigitos,
} from "../lib/pagosParticular";

/* ── Seguimiento del pago de un cliente particular (2026-10-02) ──────────────
   Una sola ventana para todo el pago de una factura / boleta:

     1. la forma de pago: transferencia, Transbank, Getnet o efectivo; con
        tarjeta, sin cuotas o en cuotas (hasta 12) y el valor de cada una;
     2. el seguimiento: una línea por cada pago que ya entró (fecha, monto,
        detalle, comprobante) y por cada cuota que falta, donde se ingresa la
        siguiente.

   Los estilos están en styles.css (prefijo `sgp-`). Esta ventana no guarda
   nada por sí misma: la página le pasa las funciones y, cuando un pago cambia,
   vuelve a recibir la cuenta y los pagos ya recalculados. */

const ICONO_MEDIO = { transferencia: Landmark, transbank: CreditCard, getnet: CreditCard, efectivo: Banknote };
const NOTA_MEDIO = {
  transferencia: "A la cuenta corriente",
  transbank: "Tarjeta, con o sin cuotas",
  getnet: "Tarjeta, con o sin cuotas",
  efectivo: "Pago en caja",
};

const fechaCL = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("es-CL") : "Sin fecha");

function CampoMonto({ value, onChange, placeholder = "$0", disabled }) {
  return (
    <input
      className="input"
      inputMode="numeric"
      placeholder={placeholder}
      disabled={disabled}
      value={value ? `$${soloDigitos(value).toLocaleString("es-CL")}` : ""}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
    />
  );
}

/* Formulario de un pago nuevo. `medio` y `monto` parten en null = "lo que diga
   el plan": mientras no se toquen, siguen al medio elegido y al valor de la
   cuota que toca, aunque el plan se cambie con el formulario abierto. */
function formularioNuevo() {
  return {
    modo: "nuevo",
    doc: null,
    fecha: hoyISO(),
    medio: null,
    monto: null,
    comision: "",
    numero: "",
    detalle: "",
    file: null,
  };
}

function formularioDe(doc) {
  return {
    modo: "editar",
    doc,
    fecha: fechaDelPago(doc),
    medio: medioDelPago(doc),
    monto: String(recibidoDelPago(doc) || ""),
    comision: Number(doc?.comision_pago) > 0 ? String(Math.round(Number(doc.comision_pago))) : "",
    numero: doc?.numero || "",
    detalle: doc?.detalle_pago || "",
    file: null,
  };
}

export default function SeguimientoPagoParticular({
  factura,
  cliente,
  cuenta,
  pagos,
  tolerancia = 5,
  sinMigracion = false,
  abrirFormulario = false,
  onCerrar,
  onGuardarPlan,
  onRegistrarPago,
  onEditarPago,
  onEliminarPago,
  onValidar,
  onVerArchivo,
  avisar,
}) {
  // Plan guardado ↔ plan que se está editando en la ventana.
  const guardado = planDeFactura(factura, cuenta);
  const [medio, setMedio] = useState(guardado.medio);
  const [cuotas, setCuotas] = useState(String(guardado.cuotas));
  const [valor, setValor] = useState(guardado.valorCuota > 0 ? String(guardado.valorCuota) : "");
  const [guardandoPlan, setGuardandoPlan] = useState(false);

  const [form, setForm] = useState(() => {
    if (!abrirFormulario) return null;
    const inicial = construirSeguimiento({ factura, cuenta, pagos, tolerancia });
    return inicial.filas.some((x) => x.siguiente) ? formularioNuevo() : null;
  });
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [porEliminar, setPorEliminar] = useState(null);
  const [validando, setValidando] = useState(false);
  const cajaForm = useRef(null);

  const tarjeta = esPagoTarjeta(medio);
  const nCuotas = tarjeta ? limitarCuotas(cuotas) : 1;
  const aCobrar = Math.max(0, Math.round(Number(cuenta?.base || 0) - Number(cuenta?.nc || 0) - Number(cuenta?.multas || 0)));
  // Valor por cuota: el digitado o, vacío, el total repartido en partes iguales.
  const valorAuto = nCuotas > 1 ? Math.round(aCobrar / nCuotas) : 0;
  const valorEf = nCuotas > 1 ? (soloDigitos(valor) > 0 ? soloDigitos(valor) : valorAuto) : 0;
  const valorGuardado = guardado.cuotas > 1 ? (guardado.valorCuota > 0 ? guardado.valorCuota : Math.round(aCobrar / guardado.cuotas)) : 0;
  const planSucio = medio !== guardado.medio || nCuotas !== guardado.cuotas || valorEf !== valorGuardado;
  const planActual = () => ({ forma_pago: medio, cuotas_total: nCuotas, valor_cuota: nCuotas > 1 ? valorEf : null });

  // El seguimiento se arma con el plan que se ve en pantalla: al cambiar las
  // cuotas o su valor, las pendientes se reacomodan antes de guardar.
  const seg = useMemo(
    () =>
      construirSeguimiento({
        factura: { ...factura, forma_pago: medio, cuotas_total: nCuotas, valor_cuota: valorEf },
        cuenta,
        pagos,
        tolerancia,
      }),
    [factura, medio, nCuotas, valorEf, cuenta, pagos, tolerancia],
  );

  const enCuotas = seg.plan.cuotas > 1;
  const completo = seg.saldo <= tolerancia;
  const avance = seg.aCobrar > 0 ? Math.max(0, Math.min(100, Math.round((seg.pagado / seg.aCobrar) * 100))) : completo ? 100 : 0;
  const pctAvance = completo ? 100 : avance;
  const sumaPlan = nCuotas * valorEf;
  const difPlan = sumaPlan - seg.aCobrar;

  let chip;
  if (factura.pagada && completo) chip = { texto: "Pagada", clase: "ok" };
  else if (completo && seg.pagadas > 0) chip = { texto: "Pago completo · falta validar", clase: "info" };
  else if (enCuotas) chip = { texto: `En cuotas ${Math.min(seg.pagadas, seg.plan.cuotas)}/${seg.plan.cuotas}`, clase: "cuotas" };
  else chip = { texto: seg.pagadas > 0 ? "Pago parcial" : "Pendiente de pago", clase: "pend" };

  // Formulario con sus valores efectivos (ver formularioNuevo).
  const esperadoSiguiente = seg.filas.find((x) => x.siguiente)?.esperado || 0;
  const formEf = form && form.modo === "nuevo"
    ? { ...form, medio: form.medio ?? medio, monto: form.monto ?? (esperadoSiguiente > 0 ? String(esperadoSiguiente) : "") }
    : form;

  const tituloFila = (n) => (enCuotas ? `Cuota ${n} de ${seg.total}` : seg.filas.length > 1 ? `Pago ${n}` : "Pago");

  // Al abrir un formulario se lleva a la vista (la lista puede ser larga).
  const claveForm = form ? `${form.modo}-${form.doc?.id ?? "nuevo"}` : "";
  useEffect(() => {
    if (claveForm) cajaForm.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [claveForm]);

  async function guardarPlan() {
    if (guardandoPlan) return;
    setGuardandoPlan(true);
    try {
      await onGuardarPlan(factura, planActual());
      avisar({ type: "success", message: "Forma de pago guardada." });
    } catch (e) {
      console.error(e);
      avisar({ type: "error", message: e?.message || "No se pudo guardar la forma de pago." });
    } finally {
      setGuardandoPlan(false);
    }
  }

  async function guardarPago(e) {
    e?.preventDefault?.();
    if (!formEf || guardandoPago) return;
    const form = formEf;
    const recibido = soloDigitos(form.monto);
    const comision = esPagoTarjeta(form.medio) ? soloDigitos(form.comision) : 0;
    if (!form.fecha) { avisar({ type: "error", message: "Indica la fecha del pago." }); return; }
    if (recibido <= 0 && comision <= 0) { avisar({ type: "error", message: "Indica el monto del pago." }); return; }
    // La transferencia se registra con su comprobante; el resto lo acepta opcional.
    if (form.modo === "nuevo" && form.medio === "transferencia" && !form.file) {
      avisar({ type: "error", message: "Adjunta el comprobante de la transferencia." });
      return;
    }
    setGuardandoPago(true);
    try {
      // Un pago se ingresa contra el plan que se ve: si cambió, se guarda antes.
      if (planSucio) await onGuardarPlan(factura, planActual());
      const valores = {
        fecha: form.fecha,
        medio: form.medio,
        recibido,
        comision,
        numero: String(form.numero || "").trim(),
        detalle: String(form.detalle || "").trim(),
        file: form.file,
      };
      if (form.modo === "editar") await onEditarPago(form.doc, valores);
      else await onRegistrarPago(factura, valores);
      avisar({ type: "success", message: form.modo === "editar" ? "Pago actualizado." : enCuotas ? "Cuota ingresada." : "Pago registrado." });
      setForm(null);
    } catch (err) {
      console.error(err);
      avisar({ type: "error", message: err?.message || "No se pudo guardar el pago." });
    } finally {
      setGuardandoPago(false);
    }
  }

  async function eliminarPago() {
    const doc = porEliminar;
    setPorEliminar(null);
    if (!doc) return;
    try {
      await onEliminarPago(doc);
      if (form?.doc?.id === doc.id) setForm(null);
      avisar({ type: "success", message: "Pago eliminado." });
    } catch (e) {
      console.error(e);
      avisar({ type: "error", message: e?.message || "No se pudo eliminar el pago." });
    }
  }

  async function validar() {
    if (validando) return;
    setValidando(true);
    try {
      await onValidar(factura);
    } finally {
      setValidando(false);
    }
  }

  const ocupado = guardandoPago || guardandoPlan;
  const hayFormNuevo = form?.modo === "nuevo";
  const hayPendientes = seg.filas.some((x) => x.estado === "pendiente");

  const formulario = (titulo) => (
    <FormularioPago
      refCaja={cajaForm}
      form={formEf}
      setForm={setForm}
      titulo={titulo}
      guardando={guardandoPago}
      onGuardar={guardarPago}
      onCancelar={() => setForm(null)}
      onVerArchivo={onVerArchivo}
    />
  );

  return createPortal(
    <div
      className="sgp-fondo"
      // Con un formulario abierto, un clic fuera no cierra: se perdería lo digitado.
      onMouseDown={(e) => { if (e.target === e.currentTarget && !form && !ocupado) onCerrar(); }}
    >
      <ConfirmModal
        open={porEliminar !== null}
        title="¿Eliminar este pago?"
        message={
          porEliminar
            ? `Se borra el pago del ${fechaCL(fechaDelPago(porEliminar))} por ${fmtCLP(recibidoDelPago(porEliminar) + Number(porEliminar.comision_pago || 0))} y su comprobante. El saldo de la factura vuelve a subir.`
            : ""
        }
        confirmText="Eliminar pago"
        onConfirm={eliminarPago}
        onCancel={() => setPorEliminar(null)}
      />

      <div className="sgp-modal" role="dialog" aria-modal="true" aria-label="Seguimiento del pago">
        <div className="sgp-head">
          <span className="sgp-head-ico"><CreditCard size={20} /></span>
          <div className="sgp-head-txt">
            <div className="sgp-head-titulo">
              <strong>Seguimiento del pago</strong>
              <span className={`sgp-chip sgp-chip-${chip.clase}`}>{chip.texto}</span>
            </div>
            <span className="sgp-head-sub">Factura {factura.numero || "S/N"} · {cliente}</span>
          </div>
          <button type="button" className="sgp-icono-btn" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar"><X size={17} /></button>
        </div>

        <div className="sgp-cuerpo">
          {/* Resumen de la cuenta de esta factura */}
          <div>
            <div className="sgp-resumen">
              <div className="sgp-dato">
                <span>Total a cobrar</span>
                <strong>{fmtCLP(seg.aCobrar)}</strong>
                {(cuenta.nc > 0 || cuenta.multas > 0) && (
                  <em>Factura {fmtCLP(cuenta.base)}{cuenta.nc > 0 ? ` − N.C. ${fmtCLP(cuenta.nc)}` : ""}{cuenta.multas > 0 ? ` − multas ${fmtCLP(cuenta.multas)}` : ""}</em>
                )}
              </div>
              <div className="sgp-dato">
                <span>Pagado</span>
                <strong className="sgp-ok">{fmtCLP(seg.pagado)}</strong>
                {cuenta.comision > 0 && <em>Incluye comisión del medio {fmtCLP(cuenta.comision)}</em>}
              </div>
              <div className="sgp-dato">
                <span>Saldo por pagar</span>
                <strong className={seg.saldo > tolerancia ? "sgp-falta" : seg.saldo < -tolerancia ? "sgp-exceso" : "sgp-ok"}>{fmtCLP(seg.saldo)}</strong>
                {seg.saldo < -tolerancia && <em>Hay un pago en exceso</em>}
              </div>
              <div className="sgp-dato">
                <span>{enCuotas ? "Cuotas pagadas" : "Pagos ingresados"}</span>
                <strong>{enCuotas ? `${Math.min(seg.pagadas, seg.plan.cuotas)} de ${seg.plan.cuotas}` : seg.pagadas}</strong>
                {enCuotas && <em>{fmtCLP(seg.valorCuota)} cada una</em>}
              </div>
            </div>
            <div className="sgp-avance">
              <div className="sgp-avance-barra"><span style={{ width: `${pctAvance}%` }} /></div>
              <span>{pctAvance}% pagado</span>
            </div>
          </div>

          {/* Forma de pago: medio y, con tarjeta, cuotas y valor de cada una */}
          <section>
            <h4 className="sgp-titulo">Forma de pago</h4>
            <div className="sgp-medios">
              {MEDIOS_PARTICULAR.map((m) => {
                const Icono = ICONO_MEDIO[m.value];
                const activo = medio === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    className={`sgp-medio${activo ? " activo" : ""}`}
                    onClick={() => setMedio(m.value)}
                    disabled={ocupado}
                    aria-pressed={activo}
                  >
                    <span className="sgp-medio-ico"><Icono size={17} /></span>
                    <span className="sgp-medio-txt">
                      <strong>{m.label}</strong>
                      <em>{NOTA_MEDIO[m.value]}</em>
                    </span>
                    {activo && <Check size={14} className="sgp-medio-check" />}
                  </button>
                );
              })}
            </div>

            {tarjeta && (
              <div className="sgp-cuotas">
                <div className="sgp-campo">
                  <span className="sgp-etq">Modalidad</span>
                  <div className="segmentado">
                    <button type="button" className={nCuotas === 1 ? "activo" : ""} onClick={() => setCuotas("1")} disabled={ocupado}>Sin cuotas</button>
                    <button
                      type="button"
                      className={nCuotas > 1 ? "activo" : ""}
                      onClick={() => { if (nCuotas === 1) setCuotas(String(guardado.cuotas > 1 ? guardado.cuotas : 2)); }}
                      disabled={ocupado}
                    >
                      En cuotas
                    </button>
                  </div>
                </div>
                {nCuotas > 1 && (
                  <>
                    <div className="sgp-campo">
                      <span className="sgp-etq">N° de cuotas</span>
                      <DropdownSelect
                        value={String(nCuotas)}
                        onChange={setCuotas}
                        options={OPCIONES_CUOTAS.filter((o) => o.value !== "1")}
                        minWidth={150}
                        disabled={ocupado}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <label className="sgp-campo">
                      <span className="sgp-etq" title="Lo que paga el cliente en cada cuota, con IVA. Vacío = el total a cobrar dividido en las cuotas.">Valor por cuota</span>
                      <CampoMonto value={valor} onChange={setValor} placeholder={`${fmtCLP(valorAuto)} (automático)`} disabled={ocupado} />
                    </label>
                    <div className="sgp-calculo">
                      {nCuotas} cuotas de {fmtCLP(valorEf)} = <strong>{fmtCLP(sumaPlan)}</strong>
                      {Math.abs(difPlan) > nCuotas && (
                        <span className="sgp-calculo-dif">
                          {" "}· {difPlan > 0 ? "supera" : "queda bajo"} el total a cobrar ({fmtCLP(seg.aCobrar)}) en {fmtCLP(Math.abs(difPlan))}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {sinMigracion && (
              <div className="sgp-aviso">
                <AlertTriangle size={15} />
                <span>Falta aplicar la migración 20261002_pagos_cuotas_particular: mientras tanto, el valor por cuota y el detalle de cada pago no quedan guardados.</span>
              </div>
            )}

            <div className="sgp-plan-pie">
              <span>
                {planSucio
                  ? "Hay cambios sin guardar en la forma de pago."
                  : enCuotas
                    ? `Plan guardado: ${etiquetaMedioParticular(medio)} en ${nCuotas} cuotas de ${fmtCLP(valorEf)}.`
                    : `Forma de pago: ${etiquetaMedioParticular(medio)}${tarjeta ? ", sin cuotas" : ""}.`}
              </span>
              {planSucio && (
                <button type="button" className="btn btn-primary btn-sm" onClick={guardarPlan} disabled={ocupado}>
                  {guardandoPlan ? "Guardando…" : "Guardar forma de pago"}
                </button>
              )}
            </div>
          </section>

          {/* Seguimiento: lo que ya entró y lo que falta */}
          <section>
            <h4 className="sgp-titulo">{enCuotas ? "Seguimiento de cuotas" : "Seguimiento de pagos"}</h4>

            {seg.filas.length === 0 && !hayFormNuevo && (
              <div className="sgp-vacio">
                {factura.pagada
                  ? "La factura está marcada como pagada, sin el detalle de sus pagos."
                  : "Todavía no hay pagos ingresados."}
              </div>
            )}

            <ol className="sgp-linea">
              {seg.filas.map((fila) => {
                if (fila.estado === "pagada") {
                  const doc = fila.pago;
                  const editando = form?.modo === "editar" && form.doc?.id === doc.id;
                  const comision = Math.round(Number(doc.comision_pago || 0));
                  return (
                    <li key={fila.clave} className="sgp-item sgp-pagada">
                      <span className="sgp-marca"><Check size={16} strokeWidth={3} /></span>
                      {editando ? formulario(`Editar ${tituloFila(fila.n).toLowerCase()}`) : (
                        <div className="sgp-card">
                          <div className="sgp-card-top">
                            <div>
                              <div className="sgp-card-titulo">
                                {tituloFila(fila.n)}
                                <span className="sgp-etiqueta-medio">{etiquetaMedioParticular(medioDelPago(doc))}</span>
                              </div>
                              <div className="sgp-card-sub">Pagada el {fechaCL(fechaDelPago(doc))}</div>
                            </div>
                            <div className="sgp-card-monto">{fmtCLP(fila.monto)}</div>
                          </div>
                          {(comision > 0 || doc.numero) && (
                            <div className="sgp-card-datos">
                              {comision > 0 && <span>Recibido <strong>{fmtCLP(recibidoDelPago(doc))}</strong></span>}
                              {comision > 0 && <span>Comisión del medio <strong>{fmtCLP(comision)}</strong></span>}
                              {doc.numero && <span>N° de operación <strong>{doc.numero}</strong></span>}
                            </div>
                          )}
                          {doc.detalle_pago && <p className="sgp-card-detalle">{doc.detalle_pago}</p>}
                          <div className="sgp-card-pie">
                            {doc.bucket && doc.storage_path ? (
                              <button type="button" className="sgp-enlace" onClick={() => onVerArchivo(doc)}>
                                <Eye size={14} /> Ver comprobante
                              </button>
                            ) : (
                              <span className="sgp-sin-archivo"><Paperclip size={13} /> Sin comprobante adjunto</span>
                            )}
                            <span className="sgp-acciones">
                              <button type="button" className="sgp-icono-btn" onClick={() => setForm(formularioDe(doc))} disabled={ocupado} title="Editar este pago: fecha, monto, detalle o comprobante" aria-label="Editar pago">
                                <Pencil size={14} />
                              </button>
                              <button type="button" className="sgp-icono-btn peligro" onClick={() => setPorEliminar(doc)} disabled={ocupado} title="Eliminar este pago" aria-label="Eliminar pago">
                                <Trash2 size={14} />
                              </button>
                            </span>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                }
                const ingresando = hayFormNuevo && fila.siguiente;
                return (
                  <li key={fila.clave} className={`sgp-item sgp-pendiente${fila.siguiente ? " sgp-siguiente" : ""}`}>
                    <span className="sgp-marca">{fila.n}</span>
                    {ingresando ? formulario(`Ingresar ${tituloFila(fila.n).toLowerCase()}`) : (
                      <div className="sgp-card">
                        <div className="sgp-card-top">
                          <div>
                            <div className="sgp-card-titulo">{tituloFila(fila.n)}</div>
                            <div className="sgp-card-sub">{fila.siguiente ? "Siguiente por ingresar" : "Pendiente"}</div>
                          </div>
                          <div className="sgp-card-monto">{fmtCLP(fila.esperado)}</div>
                        </div>
                        {fila.siguiente && (
                          <div className="sgp-card-pie">
                            <span />
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setForm(formularioNuevo())} disabled={ocupado || Boolean(form)}>
                              <Plus size={14} /> {enCuotas ? "Ingresar cuota pagada" : "Registrar pago"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
              {/* Sin saldo pendiente igual se puede sumar un pago (regularizar
                  una factura marcada pagada sin detalle, por ejemplo). */}
              {!hayPendientes && hayFormNuevo && (
                <li className="sgp-item sgp-pendiente sgp-siguiente">
                  <span className="sgp-marca">{seg.pagadas + 1}</span>
                  {formulario("Ingresar pago")}
                </li>
              )}
            </ol>

            {!hayPendientes && !form && (
              <button type="button" className="sgp-enlace sgp-agregar" onClick={() => setForm(formularioNuevo())} disabled={ocupado}>
                <Plus size={14} /> Agregar otro pago
              </button>
            )}
          </section>
        </div>

        <div className="sgp-pie">
          <span>
            {completo && !factura.pagada && seg.pagadas > 0
              ? "Los pagos cubren la factura: valídala para dejarla pagada."
              : "Los montos van con IVA, tal como aparecen en el banco."}
          </span>
          <div className="sgp-pie-botones">
            {completo && !factura.pagada && seg.pagadas > 0 && (
              <button type="button" className="btn btn-primary" onClick={validar} disabled={validando || ocupado || Boolean(form)}>
                <CheckCircle2 size={15} /> {validando ? "Validando…" : "Validar pago"}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onCerrar} disabled={ocupado}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Formulario de un pago o cuota: el mismo para ingresar y para corregir. */
function FormularioPago({ refCaja, form, setForm, titulo, guardando, onGuardar, onCancelar, onVerArchivo }) {
  const cambiar = (campo) => (v) => setForm((prev) => (prev ? { ...prev, [campo]: v } : prev));
  const tarjeta = esPagoTarjeta(form.medio);
  // Un pago antiguo puede traer un medio que ya no se ofrece (cheque, vale vista).
  const medios = MEDIOS_PARTICULAR.some((m) => m.value === form.medio)
    ? MEDIOS_PARTICULAR
    : [...MEDIOS_PARTICULAR, { value: form.medio, label: form.medio }];
  const archivoActual = form.doc?.bucket && form.doc?.storage_path ? form.doc : null;
  const opcional = form.modo === "editar" || form.medio !== "transferencia";

  return (
    <form ref={refCaja} className="sgp-form" onSubmit={onGuardar}>
      <div className="sgp-form-titulo">{titulo}</div>
      <div className="sgp-form-grid">
        <div className="sgp-campo">
          <span className="sgp-etq">Fecha del pago</span>
          <DateFilter value={form.fecha} onChange={cambiar("fecha")} placeholder="Fecha" disabled={guardando} />
        </div>
        <label className="sgp-campo">
          <span className="sgp-etq" title="Lo que efectivamente entró a la cuenta, con IVA">Monto recibido</span>
          <CampoMonto value={form.monto} onChange={cambiar("monto")} disabled={guardando} />
        </label>
        <div className="sgp-campo">
          <span className="sgp-etq">Medio de pago</span>
          <DropdownSelect value={form.medio} onChange={cambiar("medio")} options={medios} minWidth={180} disabled={guardando} style={{ width: "100%" }} />
        </div>
        {tarjeta ? (
          <label className="sgp-campo">
            <span className="sgp-etq" title="Lo que Transbank / Getnet descontó antes de depositar. No se recibió, pero no es deuda del cliente.">Comisión del medio (opcional)</span>
            <CampoMonto value={form.comision} onChange={cambiar("comision")} disabled={guardando} />
          </label>
        ) : (
          <label className="sgp-campo">
            <span className="sgp-etq">N° de operación (opcional)</span>
            <input className="input" value={form.numero} onChange={(e) => cambiar("numero")(e.target.value)} placeholder="N° de operación, banco…" disabled={guardando} />
          </label>
        )}
        {tarjeta && (
          <label className="sgp-campo sgp-campo-ancho">
            <span className="sgp-etq">N° de operación (opcional)</span>
            <input className="input" value={form.numero} onChange={(e) => cambiar("numero")(e.target.value)} placeholder="N° de operación, código de autorización…" disabled={guardando} />
          </label>
        )}
        <label className="sgp-campo sgp-campo-ancho">
          <span className="sgp-etq">Detalle</span>
          <textarea className="input" rows={2} value={form.detalle} onChange={(e) => cambiar("detalle")(e.target.value)} placeholder="Quién pagó, observaciones, acuerdo con el cliente…" disabled={guardando} />
        </label>
        <div className="sgp-campo sgp-campo-ancho">
          <span className="sgp-etq">Comprobante{opcional ? " (opcional)" : ""}</span>
          <label className={`sgp-archivo${form.file ? " con-archivo" : ""}`}>
            <Upload size={15} />
            <span className="sgp-archivo-nombre">
              {form.file ? form.file.name : archivoActual ? "Reemplazar el comprobante (imagen o PDF)" : "Adjuntar el comprobante (imagen o PDF)"}
            </span>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => cambiar("file")(e.target.files?.[0] || null)} disabled={guardando} />
          </label>
          {archivoActual && !form.file && (
            <button type="button" className="sgp-enlace" onClick={() => onVerArchivo(archivoActual)}>
              <Eye size={13} /> Ver el comprobante actual
            </button>
          )}
        </div>
      </div>
      {tarjeta && (
        <div className="sgp-form-nota">
          Recibido + comisión = lo que pagó el cliente: {fmtCLP(soloDigitos(form.monto) + soloDigitos(form.comision))}
        </div>
      )}
      <div className="sgp-form-pie">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancelar} disabled={guardando}>Cancelar</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={guardando}>
          {guardando ? "Guardando…" : form.modo === "editar" ? "Guardar cambios" : "Guardar pago"}
        </button>
      </div>
    </form>
  );
}
