import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { Link } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DateFilter from "../components/DateFilter";
import { Eye, CheckCircle2, Circle, AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Download, ChevronDown, Upload, FileMinus } from "lucide-react";

// Normaliza el nombre de archivo para el storage (sin acentos ni símbolos).
function normalizarNombreArchivo(nombre) {
  const base = (nombre || "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/_+/g, "_").replace(/^_|_$/g, "")
    .toLowerCase();
  return base || "archivo";
}

// Monto BRUTO de una cotización para pagos. Convención de los datos:
//  - La OC se carga NETA ("Monto Neto OC") → bruto = OC × 1,19.
//  - Los comprobantes/pagos (transferencia, webpay, efectivo) se guardan
//    NETOS, igual que la factura → bruto = neto × 1,19 al leerlos aquí.
// El saldo siempre compara bruto contra bruto. Sin OC, cae al bruto de la
// cotización (total_con_iva, o total_sin_iva × 1,19).
function montoBrutoPago(ocSum, lic) {
  const oc = Number(ocSum || 0);
  if (oc > 0) return Math.round(oc * 1.19);
  const conIva = Number(lic?.total_con_iva || 0);
  if (conIva > 0) return conIva;
  return Math.round(Number(lic?.total_sin_iva || 0) * 1.19);
}

const FORMAS_PAGO = [
  { value: "transferencia", label: "Transferencia" },
  { value: "cheque", label: "Cheque" },
  { value: "vale_vista", label: "Vale Vista" },
  { value: "efectivo", label: "Efectivo" },
  { value: "factoring", label: "Factoring" },
];

function diasEntre(fechaIso) {
  if (!fechaIso) return null;
  const f = new Date(`${fechaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const ms = hoy.getTime() - f.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function plazoDias(condVenta) {
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
function dedupFacturas(arr) {
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

function calcularFechaVencimiento(fechaFacturaIso, condVenta) {
  if (!fechaFacturaIso) return null;
  const f = new Date(`${fechaFacturaIso}T00:00:00`);
  if (Number.isNaN(f.getTime())) return null;
  const plazo = plazoDias(condVenta);
  f.setDate(f.getDate() + plazo);
  return f;
}

function fmtDateCL(d) {
  if (!d) return "—";
  if (typeof d === "string") {
    return new Date(`${d}T00:00:00`).toLocaleDateString("es-CL");
  }
  return d.toLocaleDateString("es-CL");
}

function fmtCLP(value) {
  return `$${Number(value || 0).toLocaleString("es-CL")}`;
}

function esClienteParticular(lic) {
  return (lic?.tipo_cliente || "").toString().toLowerCase().includes("particular");
}

function semaforo(diasRestantes, pagada) {
  if (pagada) return { color: "#15803d", bg: "#dcfce7", label: "Pagada" };
  if (diasRestantes == null) return { color: "#6b7280", bg: "#f3f4f6", label: "Sin fecha" };
  if (diasRestantes < 0) return { color: "#dc2626", bg: "#fee2e2", label: `Vencida (${Math.abs(diasRestantes)}d)` };
  if (diasRestantes <= 5) return { color: "#b45309", bg: "#fef3c7", label: `Por vencer (${diasRestantes}d)` };
  if (diasRestantes <= 15) return { color: "#0d9488", bg: "#ccfbf1", label: `${diasRestantes}d restantes` };
  return { color: "#1d4ed8", bg: "#dbeafe", label: `${diasRestantes}d restantes` };
}

export default function SeguimientoPagos() {
  const { user, rol, cargando } = useAuth();
  const rolNorm = (rol ?? "").toString().trim().toLowerCase();
  const esAdmin = rolNorm === "admin";
  // Acceso al módulo: mismos roles que la ruta y el menú (admin, jefe de
  // ventas especial y contabilidad). Los vendedores no acceden aquí.
  const puedeVer = esAdmin || rolNorm === "jefe_ventas_especial" || rolNorm === "contabilidad";
  const [facturas, setFacturas] = useState([]);
  const [comprobantesMap, setComprobantesMap] = useState({});
  // Suma de comprobantes (transferencia/comprobante, webpay y efectivo) por
  // cotización; sirve para el saldo por pagar del cliente particular.
  const [comprobantesSumMap, setComprobantesSumMap] = useState({});
  // Notas de crédito por cotización: lista (para ver/abrir) y suma (descuenta del monto).
  const [notasCreditoMap, setNotasCreditoMap] = useState({});
  const [notasCreditoSumMap, setNotasCreditoSumMap] = useState({});
  // Suma de órdenes de compra por cotización (monto a cobrar de la columna Monto).
  const [montoOcMap, setMontoOcMap] = useState({});
  // OC por id: permite resolver el monto de la factura pública que deriva de una
  // OC concreta (deriva_de_id), en vez de sumar todas las OC de la cotización.
  const [ocByIdMap, setOcByIdMap] = useState({});
  // Guía por id: la factura pública deriva de una guía (deriva_de_id) y la guía
  // deriva de la OC; sirve para encadenar factura → guía → OC → monto.
  const [guiaByIdMap, setGuiaByIdMap] = useState({});
  // N° de OC por cotización (para los reportes). Varias OC → separadas por coma.
  const [ocNumMap, setOcNumMap] = useState({});
  const [licMap, setLicMap] = useState({});
  const [usuariosMap, setUsuariosMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirmDesmarcar, setConfirmDesmarcar] = useState(null);

  // Subida de voucher (comprobante de transferencia) o nota de crédito.
  const [voucherFor, setVoucherFor] = useState(null); // factura (f) a la que se vincula
  const [voucherTipo, setVoucherTipo] = useState("comprobante"); // "comprobante" | "nota_credito"
  const [vFile, setVFile] = useState(null);
  const [vMonto, setVMonto] = useState("");
  const [vFecha, setVFecha] = useState("");
  const [vNumero, setVNumero] = useState("");
  const [subiendoVoucher, setSubiendoVoucher] = useState(false);

  // Filtros
  const [filtroEstado, setFiltroEstado] = useState("todas");
  const [filtroCierreForzado, setFiltroCierreForzado] = useState("todas"); // todas | forzado | abiertos
  const [filtroEntidad, setFiltroEntidad] = useState("");
  const [filtroNumero, setFiltroNumero] = useState("");
  const [filtroTipoCotizacion, setFiltroTipoCotizacion] = useState("");
  const [filtroTipoCompra, setFiltroTipoCompra] = useState("");
  // Tipo de pago: selección múltiple (forma_pago). Vacío = todas.
  const [filtroFormaPago, setFiltroFormaPago] = useState([]);
  const [openFormaPago, setOpenFormaPago] = useState(false);
  const formaPagoRef = useRef(null);
  // Filtro de fecha (por fecha de factura) y empresa despachadora (desde la
  // guía de despacho de cada cotización, módulo Trazabilidad).
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [filtroEmpresaDespacho, setFiltroEmpresaDespacho] = useState("");
  const [empresaDespachoMap, setEmpresaDespachoMap] = useState({}); // licitacion_id → empresa

  useEffect(() => {
    const onClickOutside = (e) => {
      if (formaPagoRef.current && !formaPagoRef.current.contains(e.target)) {
        setOpenFormaPago(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Ordenamiento
  const [sortCol, setSortCol] = useState("vencimiento");
  const [sortDir, setSortDir] = useState("asc");

  function toggleSort(col) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }
  function SortIcon({ col }) {
    if (sortCol !== col) return <ArrowUpDown size={11} style={{ color: "#cbd5e1" }} />;
    return sortDir === "asc"
      ? <ArrowUp size={11} style={{ color: "var(--primary-dark, #28aeb1)" }} />
      : <ArrowDown size={11} style={{ color: "var(--primary-dark, #28aeb1)" }} />;
  }

  // Edición de pago
  const [pagandoId, setPagandoId] = useState(null);
  const [fechaPago, setFechaPago] = useState("");
  const [formaPago, setFormaPago] = useState("transferencia");
  const [montoPago, setMontoPago] = useState("");
  const [guardando, setGuardando] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const recargar = () => setReloadKey((k) => k + 1);

  // Actualiza un solo registro en memoria (sin refetch ni pantalla de carga).
  function actualizarFacturaLocal(id, cambios) {
    setFacturas((prev) => prev.map((f) => (f.id === id ? { ...f, ...cambios } : f)));
  }

  // Punto 36: dropdown descarga reporte
  const [openDescargar, setOpenDescargar] = useState(false);

  useEffect(() => {
    if (cargando) return;

    async function load() {
      setLoading(true);
      try {
        // 1. Cotizaciones adjudicadas
        const lics = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre_entidad,fecha_adjudicada,total_con_iva,total_sin_iva,creado_por,condicion_venta,comuna,tipo_compra,tipo_cliente"
        );
        let rows = (lics || []).filter((l) => l.estado === "Adjudicada" || l.estado == null);

        // Cotizaciones adjudicadas reales
        const licsAdj = await api.get(
          "/licitaciones/with-fields?fields=id,id_licitacion,nombre_entidad,fecha_adjudicada,total_con_iva,total_sin_iva,creado_por,condicion_venta,comuna,estado,tipo_compra,tipo_cliente,ciclo_cerrado,monto_forzado"
        );
        rows = (licsAdj || []).filter((l) => l.estado === "Adjudicada");

        const rolNorm = (rol ?? "").toString().trim().toLowerCase();
        const emailUser = (user?.email || "").trim().toLowerCase();
        if ((rolNorm === "ventas" || rolNorm === "ventas_especial") && emailUser) {
          rows = rows.filter((l) => (l.creado_por || "").trim().toLowerCase() === emailUser);
        }

        const mapa = {};
        rows.forEach((l) => { mapa[l.id] = l; });
        setLicMap(mapa);

        // 2. Facturas de esas cotizaciones
        const ids = rows.map((l) => l.id);
        let allFacturas = [];
        const compMap = {};
        const compSum = {};
        const ocSum = {};
        const ocById = {};
        const guiaById = {};
        const ocNums = {};
        const ncList = {};
        const ncSum = {};
        const empresaMap = {};
        if (ids.length > 0) {
          const docs = await api.post("/licitaciones/documentos/filter", {
            // Orden de compra (monto a cobrar), factura (Entidad Pública),
            // factura/boleta (Cliente Particular) y los comprobantes de pago del
            // particular (transferencia/comprobante, webpay y efectivo).
            filter: {
              licitacion_ids: ids,
              tipo: ["orden_compra", "factura", "factura_boleta", "comprobante_pago", "webpay", "efectivo", "nota_credito", "guia_despacho"],
            },
            fields: "*",
          });
          (docs || []).forEach((d) => {
            const lid = d.licitacion_id;
            if (d.tipo === "guia_despacho") {
              // Empresa despachadora de la cotización (de su guía de despacho).
              const emp = String(d.empresa_despacho || "").trim();
              if (emp && !empresaMap[lid]) empresaMap[lid] = emp;
              guiaById[d.id] = d; // para encadenar factura → guía → OC
              return;
            }
            if (d.tipo === "factura" || d.tipo === "factura_boleta") {
              allFacturas.push(d);
              return;
            }
            if (d.tipo === "orden_compra") {
              // Monto de la cotización a efectos de pago = suma de sus OC.
              ocSum[lid] = (ocSum[lid] || 0) + Number(d.monto || 0);
              ocById[d.id] = d; // para resolver la factura por su OC de origen
              const num = String(d.numero || "").trim();
              if (num) (ocNums[lid] = ocNums[lid] || []).push(num);
              return;
            }
            if (d.tipo === "nota_credito") {
              // Nota de crédito: descuenta del monto a cobrar de la factura.
              // Se usa TAL CUAL está cargada: estos montos se ingresan brutos.
              (ncList[lid] = ncList[lid] || []).push(d);
              ncSum[lid] = (ncSum[lid] || 0) + Number(d.monto || 0);
              return;
            }
            // Comprobantes de pago (transferencia/webpay/efectivo): acumulamos
            // el monto pagado por cotización. Se guardan NETOS (igual que la
            // factura) → se convierten a bruto ×1,19 para comparar contra el
            // bruto de la factura.
            compSum[lid] = (compSum[lid] || 0) + Math.round(Number(d.monto || 0) * 1.19);
            if (d.tipo === "comprobante_pago") {
              // Para la columna "Pago" nos quedamos con el comprobante más reciente.
              const fa = String(d.fecha_oc || d.created_at || "");
              const prev = compMap[lid];
              const fp = prev ? String(prev.fecha_oc || prev.created_at || "") : "";
              if (!prev || fa > fp) compMap[lid] = d;
            }
          });
        }
        setFacturas(dedupFacturas(allFacturas));
        setEmpresaDespachoMap(empresaMap);
        setComprobantesMap(compMap);
        setComprobantesSumMap(compSum);
        setMontoOcMap(ocSum);
        setOcByIdMap(ocById);
        setGuiaByIdMap(guiaById);
        setNotasCreditoMap(ncList);
        setNotasCreditoSumMap(ncSum);
        const ocNumFinal = {};
        Object.entries(ocNums).forEach(([lid, arr]) => {
          ocNumFinal[lid] = Array.from(new Set(arr)).join(", ");
        });
        setOcNumMap(ocNumFinal);

        // 3. Vendedores
        const emails = Array.from(new Set(rows.map((l) => l.creado_por).filter(Boolean)));
        if (emails.length > 0) {
          try {
            const perfiles = await api.post("/usuarios/profiles/by-emails", { emails });
            const m = {};
            (perfiles || []).forEach((p) => {
              const e = (p?.email || "").trim().toLowerCase();
              if (e) m[e] = (p?.nombre || "").trim();
            });
            setUsuariosMap(m);
          } catch { /* */ }
        }
      } catch (e) {
        console.error(e);
        setToast({ type: "error", message: "Error cargando facturas." });
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [cargando, rol, user?.email, reloadKey]);

  // Tipos de compra disponibles (según las cotizaciones cargadas).
  const tiposCompra = useMemo(() => {
    const set = new Set();
    Object.values(licMap || {}).forEach((l) => {
      const t = (l?.tipo_compra || "").toString().trim();
      if (t) set.add(t);
    });
    return [...set].sort();
  }, [licMap]);

  // Tipos de cotización disponibles (tipo_cliente: Entidad Pública / Cliente Particular).
  const tiposCotizacion = useMemo(() => {
    const set = new Set();
    Object.values(licMap || {}).forEach((l) => {
      const t = (l?.tipo_cliente || "").toString().trim();
      if (t) set.add(t);
    });
    return [...set].sort();
  }, [licMap]);

  // Empresas despachadoras disponibles (desde las guías de despacho).
  const empresasDespacho = useMemo(() => {
    const set = new Set();
    Object.values(empresaDespachoMap || {}).forEach((e) => {
      const t = (e || "").toString().trim();
      if (t) set.add(t);
    });
    // Orden fijo: Blue Express, Starken, Despacho interno, …(otras), Otro al final.
    const rank = (s) => {
      const v = s.toLowerCase();
      if (v.includes("blue")) return 0;
      if (v.includes("starken")) return 1;
      if (v.includes("interno")) return 2;
      if (v === "otro") return 99;
      return 50;
    };
    return [...set].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "es"));
  }, [empresaDespachoMap]);

  // ── Notas de crédito / reconciliación de montos ──────────────────────────
  // Monto base a cobrar (antes de notas de crédito), en BRUTO: particular →
  // bruto de la factura/boleta; público → bruto de la OC. Los comprobantes se
  // guardan netos y se convierten a bruto al acumularlos, así que la base
  // debe ser bruta para que el saldo cuadre.
  function montoBaseFactura(f, lic) {
    if (esClienteParticular(lic)) return montoFacturaBruto(f) || Number(lic?.total_con_iva) || 0;
    return montoBrutoPago(montoOcMap[lic?.id], lic);
  }
  // Neto de la OC detrás de un id que puede ser una OC directa o una guía de
  // despacho (la guía deriva de la OC). Devuelve 0 si no resuelve.
  function ocNetoDesdeRef(refId) {
    if (refId == null) return 0;
    const oc = ocByIdMap[refId];
    if (oc) return Number(oc.monto || 0);
    const guia = guiaByIdMap[refId];
    if (guia && guia.deriva_de_id != null) {
      const ocDeGuia = ocByIdMap[guia.deriva_de_id];
      if (ocDeGuia) return Number(ocDeGuia.monto || 0);
    }
    return 0;
  }

  // Monto MOSTRADO de la factura = bruto (con IVA) del monto (neto) que se cargó
  // en Trazabilidad para ESA factura: neto × 1,19. TODOS los KPIs de este módulo
  // se basan en este valor. Si la factura todavía no tiene su monto cargado en
  // Trazabilidad, NO se estima con la OC ni con el total de la cotización: cuenta
  // como $0 hasta que se cargue el monto real de la factura.
  function montoFacturaBruto(f) {
    const neto = Number(f?.monto || 0);
    return neto > 0 ? Math.round(neto * 1.19) : 0;
  }
  function notasCreditoDe(f) {
    return Number(notasCreditoSumMap[f.licitacion_id] || 0);
  }
  // Saldo por cobrar = base − notas de crédito − comprobantes cargados.
  function saldoFactura(f, lic) {
    const base = montoBaseFactura(f, lic);
    const pagado = Number(comprobantesSumMap[f.licitacion_id] || 0);
    return Math.round(base - notasCreditoDe(f) - pagado);
  }
  // Punto 17: si los montos cargados (comprobantes/transferencias + notas de
  // crédito) no cuadran con el total a cobrar (saldo ≠ 0), la factura no puede
  // considerarse pagada — queda "pendiente de pago", aunque tenga el flag de
  // pagada. Aplica a cualquier tipo de cliente. Si todavía no se cargó ningún
  // monto, no se fuerza el descalce (respeta el flujo simple de "marcar pagada").
  function descalceMontos(f, lic) {
    const cargas = Number(comprobantesSumMap[f.licitacion_id] || 0) + notasCreditoDe(f);
    if (cargas <= 0) return false; // nada cargado aún
    return saldoFactura(f, lic) > 1; // tolerancia $1
  }
  // Pagada "efectiva": respeta el flag salvo que los montos cargados no calcen.
  function estaPagada(f, lic) {
    return Boolean(f.pagada) && !descalceMontos(f, lic);
  }

  // Filtros base: todos MENOS el de estado. Los KPIs se calculan sobre estas
  // facturas para que respeten los filtros (entidad, fecha, empresa, etc.) sin
  // que el filtro de estado anule el resto de los baldes (los KPIs SON el
  // desglose por estado).
  const facturasFiltradasBase = useMemo(() => {
    return facturas.filter((f) => {
      const lic = licMap[f.licitacion_id];
      if (!lic) return false;

      const entidad = (lic.nombre_entidad || "").toLowerCase();
      if (filtroEntidad && !entidad.includes(filtroEntidad.toLowerCase())) return false;

      if (filtroTipoCotizacion && (lic.tipo_cliente || "").toString().trim() !== filtroTipoCotizacion) {
        return false;
      }

      if (filtroTipoCompra && (lic.tipo_compra || "").toString().trim() !== filtroTipoCompra) {
        return false;
      }

      if (filtroNumero) {
        const num = (f.numero || "").toString().toLowerCase();
        if (!num.includes(filtroNumero.toLowerCase())) return false;
      }

      // Empresa despachadora (de la guía de despacho de la cotización).
      if (filtroEmpresaDespacho) {
        const emp = (empresaDespachoMap[f.licitacion_id] || "").toString().trim();
        if (emp !== filtroEmpresaDespacho) return false;
      }

      // Rango de fecha (por fecha de la factura).
      const ff = String(f.fecha_factura || "").slice(0, 10);
      if (filtroDesde && (!ff || ff < filtroDesde)) return false;
      if (filtroHasta && (!ff || ff > filtroHasta)) return false;

      // Tipo de pago (forma_pago): solo aplica a facturas con forma registrada.
      if (filtroFormaPago.length > 0) {
        if (!f.forma_pago || !filtroFormaPago.includes(f.forma_pago)) return false;
      }

      // Cierre forzado de ciclo (Trazabilidad → ciclo_cerrado).
      if (filtroCierreForzado === "forzado" && !lic.ciclo_cerrado) return false;
      if (filtroCierreForzado === "abiertos" && lic.ciclo_cerrado) return false;

      return true;
    });
  }, [facturas, licMap, filtroEntidad, filtroNumero, filtroTipoCotizacion, filtroTipoCompra, filtroFormaPago, filtroEmpresaDespacho, empresaDespachoMap, filtroDesde, filtroHasta, filtroCierreForzado]);

  // Filtros aplicados a la tabla = base + filtro de estado.
  const facturasFiltradas = useMemo(() => {
    if (filtroEstado === "todas") return facturasFiltradasBase;
    return facturasFiltradasBase.filter((f) => {
      const lic = licMap[f.licitacion_id];
      if (!lic) return false;
      const plazo = plazoDias(lic.condicion_venta);
      const dias = diasEntre(f.fecha_factura);
      const diasRestantes = dias != null ? plazo - dias : null;
      const pagadaEf = estaPagada(f, lic);
      if (filtroEstado === "pagadas" && !pagadaEf) return false;
      if (filtroEstado === "pendientes" && pagadaEf) return false;
      if (filtroEstado === "vencidas" && (pagadaEf || diasRestantes == null || diasRestantes >= 0)) return false;
      if (filtroEstado === "por_vencer" && (pagadaEf || diasRestantes == null || diasRestantes < 0 || diasRestantes > 5)) return false;
      return true;
    });
  }, [facturasFiltradasBase, licMap, filtroEstado, notasCreditoSumMap, comprobantesSumMap, montoOcMap]);

  // Ordenamiento
  const facturasOrdenadas = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...facturasFiltradas];
    arr.sort((a, b) => {
      const licA = licMap[a.licitacion_id] || {};
      const licB = licMap[b.licitacion_id] || {};
      switch (sortCol) {
        case "cotizacion": return ((licA.id || 0) - (licB.id || 0)) * dir;
        case "entidad": {
          const va = (licA.nombre_entidad || "").toLowerCase();
          const vb = (licB.nombre_entidad || "").toLowerCase();
          return va.localeCompare(vb) * dir;
        }
        case "factura": {
          const va = (a.numero || "").toLowerCase();
          const vb = (b.numero || "").toLowerCase();
          return va.localeCompare(vb) * dir;
        }
        case "fecha_factura": {
          const va = a.fecha_factura || "";
          const vb = b.fecha_factura || "";
          return va.localeCompare(vb) * dir;
        }
        case "vencimiento": {
          const va = calcularFechaVencimiento(a.fecha_factura, licA.condicion_venta);
          const vb = calcularFechaVencimiento(b.fecha_factura, licB.condicion_venta);
          if (!va && !vb) return 0;
          if (!va) return 1;
          if (!vb) return -1;
          return (va.getTime() - vb.getTime()) * dir;
        }
        case "monto": return ((Number(licA.total_con_iva) || 0) - (Number(licB.total_con_iva) || 0)) * dir;
        case "estado": {
          // Orden lógico: vencida (peor) → por vencer → pendientes → pagada
          const orden = (f, lic) => {
            if (f.pagada) return 4;
            const dias = diasEntre(f.fecha_factura);
            const restantes = dias != null ? plazoDias(lic.condicion_venta) - dias : null;
            if (restantes == null) return 5;
            if (restantes < 0) return 0;
            if (restantes <= 5) return 1;
            return 2;
          };
          return (orden(a, licA) - orden(b, licB)) * dir;
        }
        default: return 0;
      }
    });
    return arr;
  }, [facturasFiltradas, licMap, sortCol, sortDir]);

  /* ── Reporte descargable (Punto 36) ────────────────────────── */
  function construirFilasReporte() {
    const fmtFecha = (d) => {
      if (!d) return "";
      try { return new Date(d).toISOString().slice(0, 10); } catch { return String(d).slice(0, 10); }
    };
    return facturasOrdenadas.map((f) => {
      const lic = licMap[f.licitacion_id] || {};
      const venc = calcularFechaVencimiento(f.fecha_factura, lic.condicion_venta);
      const dias = diasEntre(f.fecha_factura);
      const restantes = dias != null ? plazoDias(lic.condicion_venta) - dias : null;
      const particular = esClienteParticular(lic);
      const descalce = descalceMontos(f, lic);
      let estado;
      if (descalce) estado = "Pendiente de pago";
      else if (estaPagada(f, lic)) estado = "Pagada";
      else if (restantes == null) estado = "Sin fecha";
      else if (restantes < 0) estado = "Vencida";
      else if (restantes <= 5) estado = "Por vencer";
      else estado = "En plazo";
      const nc = notasCreditoDe(f);
      // Saldo por cobrar: lo mostramos cuando hay montos cargados (notas de
      // crédito o comprobantes); si no se ha cargado nada, queda en blanco.
      const cargas = Number(comprobantesSumMap[f.licitacion_id] || 0) + nc;
      const saldoPorPagar = cargas > 0 ? saldoFactura(f, lic) : "";
      return {
        "ID Cotización": lic.id_licitacion || lic.id || "",
        "Cliente": lic.nombre_entidad || "",
        "N° OC": ocNumMap[lic.id] || "",
        "N° Factura": f.numero || "",
        "Fecha Factura": fmtFecha(f.fecha_factura),
        "Vencimiento": venc ? venc.toISOString().slice(0, 10) : "",
        "Condición Venta": lic.condicion_venta || "",
        "Monto": montoFacturaBruto(f, lic),
        "Notas de crédito": nc || "",
        "Saldo por pagar": saldoPorPagar,
        "Estado": estado,
        "Pagada": estaPagada(f, lic) ? "Sí" : "No",
        "Fecha Pago": fmtFecha(f.fecha_pago),
        "Forma Pago": f.forma_pago || "",
      };
    });
  }

  async function descargarReporte(formato) {
    const filas = construirFilasReporte();
    if (filas.length === 0) {
      setToast({ type: "info", message: "No hay datos en el filtro actual para exportar." });
      return;
    }
    const ts = new Date().toISOString().slice(0, 10);
    const nombreArchivo = `seguimiento_pagos_${ts}`;
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(filas);
      if (formato === "xlsx") {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Seguimiento");
        XLSX.writeFile(wb, `${nombreArchivo}.xlsx`);
      } else {
        const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
        const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${nombreArchivo}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
      }
      setToast({ type: "success", message: `Reporte ${formato.toUpperCase()} generado.` });
    } catch (err) {
      console.error(err);
      setToast({ type: "error", message: "No se pudo generar el reporte." });
    }
  }

  // Stats — se calculan sobre las facturas filtradas (base, sin el filtro de
  // estado) para que los KPIs respeten los filtros aplicados.
  const stats = useMemo(() => {
    let total = 0, pagadas = 0, pendientes = 0, vencidas = 0, porVencer = 0;
    let montoPagadas = 0, montoEnPlazo = 0, montoPorVencer = 0, montoVencidas = 0;
    let factoringCount = 0, montoFactoring = 0;
    let totalFacturadoCount = 0, totalFacturadoMonto = 0;
    const licsEnVista = new Set();
    facturasFiltradasBase.forEach((f) => {
      const lic = licMap[f.licitacion_id];
      if (!lic) return;
      licsEnVista.add(f.licitacion_id);
      // Monto de cada KPI = bruto (con IVA) de la factura cargada.
      const monto = montoFacturaBruto(f, lic);
      total++;
      // Total facturado = bruto (con IVA) de la factura, antes de notas de crédito.
      totalFacturadoCount++;
      totalFacturadoMonto += montoFacturaBruto(f, lic);
      // Pagada solo si los montos calzan (punto 17); si no, cae a pendiente.
      if (estaPagada(f, lic)) {
        pagadas++; montoPagadas += monto;
        if (f.forma_pago === "factoring") { factoringCount++; montoFactoring += monto; }
        return;
      }
      pendientes++;
      const plazo = plazoDias(lic.condicion_venta);
      const dias = diasEntre(f.fecha_factura);
      const diasRestantes = dias != null ? plazo - dias : null;
      if (diasRestantes != null && diasRestantes < 0) { vencidas++; montoVencidas += monto; }
      else if (diasRestantes != null && diasRestantes <= 5) { porVencer++; montoPorVencer += monto; }
      else { montoEnPlazo += monto; }
    });
    // Notas de crédito y forzado a cierre de las cotizaciones en la vista filtrada.
    let ncCount = 0, ncMonto = 0;
    let forzadoCount = 0, forzadoMonto = 0;
    licsEnVista.forEach((lid) => {
      ncCount += (notasCreditoMap[lid]?.length || 0);
      ncMonto += Number(notasCreditoSumMap[lid] || 0);
      const lic = licMap[lid];
      if (lic?.ciclo_cerrado) {
        forzadoCount++;
        forzadoMonto += Number(lic.monto_forzado || 0);
      }
    });
    return { total, pagadas, pendientes, vencidas, porVencer, montoPagadas, montoEnPlazo, montoPorVencer, montoVencidas, factoringCount, montoFactoring, ncCount, ncMonto, totalFacturadoCount, totalFacturadoMonto, forzadoCount, forzadoMonto };
  }, [facturasFiltradasBase, licMap, montoOcMap, notasCreditoMap, notasCreditoSumMap, comprobantesSumMap]);

  async function abrirDocumento(doc) {
    if (!doc?.bucket || !doc?.storage_path) return;
    try {
      const data = await api.get(
        `/licitaciones/storage/signed-url?bucket=${encodeURIComponent(doc.bucket)}&path=${encodeURIComponent(doc.storage_path)}`
      );
      if (!data?.signedUrl) {
        setToast({ type: "error", message: "No se pudo abrir el documento." });
        return;
      }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setToast({ type: "error", message: "No se pudo abrir el documento." });
    }
  }

  function iniciarPago(f) {
    setPagandoId(f.id);
    setFechaPago(f.fecha_pago || new Date().toISOString().slice(0, 10));
    setFormaPago(f.forma_pago || "transferencia");
    // Prefill con el saldo pendiente (base − notas de crédito − comprobantes),
    // que en el caso normal es el total a cobrar. Editable o se puede dejar en
    // blanco si no se quiere registrar el valor del pago.
    const lic = licMap[f.licitacion_id] || {};
    const saldo = saldoFactura(f, lic);
    setMontoPago(saldo > 0 ? String(saldo) : "");
  }

  function cancelarPago() {
    setPagandoId(null);
    setFechaPago("");
    setFormaPago("transferencia");
    setMontoPago("");
  }

  async function confirmarPago(f) {
    if (!fechaPago) {
      setToast({ type: "error", message: "Debes ingresar la fecha de pago." });
      return;
    }
    setGuardando(true);
    // Días de atraso = fecha de pago − fecha de vencimiento (fecha factura + plazo).
    // Se guarda para analizar después cuánto se demora cada cliente en pagar.
    const lic = licMap[f.licitacion_id];
    const venc = calcularFechaVencimiento(f.fecha_factura, lic?.condicion_venta);
    let diasAtraso = null;
    if (venc && fechaPago) {
      const fp = new Date(`${fechaPago}T00:00:00`);
      if (!Number.isNaN(fp.getTime())) {
        diasAtraso = Math.round((fp.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24));
      }
    }
    // Monto del pago (opcional), ingresado en BRUTO (lo que realmente se
    // transfirió). Los comprobantes se guardan NETOS (convención de toda la
    // app), así que se divide por 1,19 antes de registrar; al leerlo, este
    // módulo lo vuelve a multiplicar por 1,19 y cuadra con el total a cobrar
    // (punto 17): si no cubre el total, la factura queda "pendiente de pago".
    const montoNum = Math.round(Number(String(montoPago).replace(/[^\d]/g, "")) || 0);
    const montoNetoPago = Math.round(montoNum / 1.19);
    try {
      await api.put(`/licitaciones/documentos/${f.id}`, {
        pagada: true,
        fecha_pago: fechaPago,
        forma_pago: formaPago,
        dias_atraso_pago: diasAtraso,
      });
      if (montoNum > 0) {
        await api.post("/licitaciones/documentos", {
          licitacion_id: Number(f.licitacion_id),
          tipo: "comprobante_pago",
          monto: montoNetoPago, // neto: bruto digitado ÷ 1,19
          fecha_oc: fechaPago,
          deriva_de_id: Number(f.id),
        });
      }
      setToast({ type: "success", message: "Pago registrado." });
      cancelarPago();
      // Si se registró un monto, recargamos para recalcular saldos y estado.
      if (montoNum > 0) {
        recargar();
      } else {
        actualizarFacturaLocal(f.id, { pagada: true, fecha_pago: fechaPago, forma_pago: formaPago, dias_atraso_pago: diasAtraso });
      }
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "Error al registrar el pago." });
    } finally {
      setGuardando(false);
    }
  }

  // Cliente Particular: "Validar Pago" comprueba que la factura esté cubierta por
  // los comprobantes (transferencia + webpay + efectivo). Si el saldo llega a 0
  // (o menos), se marca como pagada; si aún queda saldo, no se valida.
  async function validarPagoParticular(f) {
    const lic = licMap[f.licitacion_id] || {};
    // Saldo = factura − notas de crédito − comprobantes.
    const saldo = saldoFactura(f, lic);
    if (saldo > 0) {
      setToast({ type: "info", message: `Aún queda saldo por pagar: ${fmtCLP(saldo)}. No se puede validar el pago.` });
      return;
    }
    // La fecha de pago del particular es la del comprobante de pago adjuntado.
    const comp = comprobantesMap[f.licitacion_id];
    const fecha =
      (comp?.fecha_oc ? String(comp.fecha_oc).slice(0, 10) : "") ||
      f.fecha_factura ||
      (f.fecha_oc ? String(f.fecha_oc).slice(0, 10) : "") ||
      (f.created_at ? String(f.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10));
    try {
      await api.put(`/licitaciones/documentos/${f.id}`, {
        pagada: true,
        fecha_pago: fecha,
        forma_pago: null,
      });
      actualizarFacturaLocal(f.id, { pagada: true, fecha_pago: fecha, forma_pago: null });
      setToast({ type: "success", message: "Pago validado y registrado." });
    } catch (e) {
      console.error(e);
      setToast({ type: "error", message: "Error al validar el pago." });
    }
  }

  function desmarcarPago(f) {
    setConfirmDesmarcar(f);
  }

  // ── Voucher (comprobante de transferencia) ───────────────────────────────
  function abrirVoucher(f) {
    setVoucherTipo("comprobante");
    setVoucherFor(f);
    setVFile(null);
    setVMonto("");
    setVFecha(new Date().toISOString().slice(0, 10));
    setVNumero("");
  }
  function abrirNotaCredito(f) {
    setVoucherTipo("nota_credito");
    setVoucherFor(f);
    setVFile(null);
    setVMonto("");
    setVFecha(new Date().toISOString().slice(0, 10));
    setVNumero("");
  }
  function cerrarVoucher() {
    setVoucherFor(null);
    setVoucherTipo("comprobante");
    setVFile(null);
    setVMonto("");
    setVFecha("");
    setVNumero("");
  }
  async function subirVoucher(e) {
    e?.preventDefault?.();
    if (!voucherFor || subiendoVoucher) return;
    const esNC = voucherTipo === "nota_credito";
    const etiqueta = esNC ? "nota de crédito" : "comprobante";
    // El comprobante requiere archivo; la nota de crédito lo acepta opcional.
    if (!esNC && !vFile) { setToast({ type: "error", message: "Selecciona el archivo del comprobante." }); return; }
    const montoNum = Math.round(Number(String(vMonto).replace(/[^\d]/g, "")) || 0);
    if (montoNum <= 0) { setToast({ type: "error", message: `Ingresa el monto de la ${etiqueta}.` }); return; }
    if (!vFecha) { setToast({ type: "error", message: `Ingresa la fecha de la ${etiqueta}.` }); return; }
    setSubiendoVoucher(true);
    const bucket = "factura";
    let storagePath = null;
    try {
      if (vFile) {
        const ext = (vFile.name.split(".").pop() || "pdf").toLowerCase();
        const safe = normalizarNombreArchivo(vFile.name.replace(/\.[^.]+$/, ""));
        storagePath = `${voucherFor.licitacion_id}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safe}.${ext}`;
        const fd = new FormData();
        fd.append("file", vFile);
        await api.postForm(`/licitaciones/storage/upload?bucket=${bucket}&path=${encodeURIComponent(storagePath)}`, fd);
      }
      try {
        await api.post("/licitaciones/documentos", {
          licitacion_id: Number(voucherFor.licitacion_id),
          tipo: esNC ? "nota_credito" : "comprobante_pago",
          numero: (vNumero || "").trim() || null,
          // El comprobante se digita en BRUTO (lo transferido) pero se guarda
          // NETO (÷1,19), la convención de toda la app. La nota de crédito se
          // usa en bruto tal cual se digita.
          monto: esNC ? montoNum : Math.round(montoNum / 1.19),
          fecha_oc: vFecha,
          deriva_de_id: Number(voucherFor.id),
          bucket: storagePath ? bucket : null,
          storage_path: storagePath,
          file_name: vFile ? vFile.name : null,
          mime_type: vFile ? (vFile.type || "application/pdf") : null,
          size_bytes: vFile ? Number(vFile.size || 0) : null,
        });
      } catch (insErr) {
        if (storagePath) {
          try { await api.delete(`/licitaciones/storage/file?bucket=${bucket}&path=${encodeURIComponent(storagePath)}`); } catch { /* */ }
        }
        throw insErr;
      }
      setToast({ type: "success", message: esNC ? "Nota de crédito cargada." : "Comprobante de transferencia cargado." });
      cerrarVoucher();
      recargar();
    } catch (err) {
      console.error(err);
      setToast({ type: "error", message: `No se pudo cargar la ${etiqueta}.` });
    } finally {
      setSubiendoVoucher(false);
    }
  }

  async function confirmarDesmarcarPago() {
    const f = confirmDesmarcar;
    setConfirmDesmarcar(null);
    if (!f) return;
    try {
      await api.put(`/licitaciones/documentos/${f.id}`, {
        pagada: false,
        fecha_pago: null,
        forma_pago: null,
        dias_atraso_pago: null,
      });
      actualizarFacturaLocal(f.id, { pagada: false, fecha_pago: null, forma_pago: null, dias_atraso_pago: null });
      setToast({ type: "success", message: "Pago desmarcado." });
    } catch (e) {
      setToast({ type: "error", message: "Error desmarcando el pago." });
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">Seguimiento de Pagos</h1>
        </div>
        <p className="text-gray-500 text-sm mt-4">Cargando...</p>
      </div>
    );
  }

  if (!cargando && !puedeVer) {
    return (
      <div className="page">
        <div className="surface">
          <div className="surface-body" style={{ color: "var(--danger)" }}>
            Acceso restringido: esta sección es para administración, jefatura de ventas especial y contabilidad.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page vista-compacta">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        open={confirmDesmarcar !== null}
        title="¿Marcar esta factura como NO pagada?"
        message="Se revertirá el estado del pago. Tendrás que volver a registrar la fecha y forma de pago si la marcas pagada de nuevo."
        confirmText="Marcar como no pagada"
        cancelText="Cancelar"
        confirmTone="warning"
        onConfirm={confirmarDesmarcarPago}
        onCancel={() => setConfirmDesmarcar(null)}
      />

      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 className="page-title">Seguimiento de Pagos</h1>
          <p className="page-subtitle">
            {facturasFiltradas.length} factura{facturasFiltradas.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setOpenDescargar((v) => !v)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            disabled={facturasFiltradas.length === 0}
          >
            <Download size={14} /> Descargar reporte <ChevronDown size={14} />
          </button>
          {openDescargar && (
            <div
              style={{
                position: "absolute",
                right: 0,
                marginTop: 4,
                background: "var(--surface, #fff)",
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 8,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                zIndex: 30,
                minWidth: 160,
              }}
              onMouseLeave={() => setOpenDescargar(false)}
            >
              <button
                type="button"
                onClick={() => { setOpenDescargar(false); descargarReporte("xlsx"); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", fontSize: 13 }}
              >
                Excel (.xlsx)
              </button>
              <button
                type="button"
                onClick={() => { setOpenDescargar(false); descargarReporte("csv"); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer", fontSize: 13 }}
              >
                CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats — cantidad + monto por estado. Respetan los filtros aplicados. */}
      <div className="stats-row stats-8">
        <div className="stat-card">
          <div className="stat-label">Total facturado</div>
          <div className="stat-value" style={{ color: "var(--text)" }}>{stats.totalFacturadoCount}</div>
          <div className="stat-money" style={{ color: "var(--text)" }}>{fmtCLP(stats.totalFacturadoMonto)}</div>
          <div className="stat-sub">facturas emitidas · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pagadas</div>
          <div className="stat-value" style={{ color: "var(--success)" }}>{stats.pagadas}</div>
          <div className="stat-money" style={{ color: "var(--success)" }}>{fmtCLP(stats.montoPagadas)}</div>
          <div className="stat-sub">facturas · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value" style={{ color: "var(--primary)" }}>
            {Math.max(0, stats.pendientes - stats.porVencer - stats.vencidas)}
          </div>
          <div className="stat-money" style={{ color: "var(--primary)" }}>{fmtCLP(stats.montoEnPlazo)}</div>
          <div className="stat-sub">aún en plazo · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Por vencer</div>
          <div className="stat-value" style={{ color: "var(--warning)" }}>{stats.porVencer}</div>
          <div className="stat-money" style={{ color: "var(--warning)" }}>{fmtCLP(stats.montoPorVencer)}</div>
          <div className="stat-sub">próximas a vencer · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Vencidas</div>
          <div className="stat-value" style={{ color: "var(--danger)" }}>{stats.vencidas}</div>
          <div className="stat-money" style={{ color: "var(--danger)" }}>{fmtCLP(stats.montoVencidas)}</div>
          <div className="stat-sub">fuera de plazo · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Factoring</div>
          <div className="stat-value" style={{ color: "#7c3aed" }}>{stats.factoringCount}</div>
          <div className="stat-money" style={{ color: "#7c3aed" }}>{fmtCLP(stats.montoFactoring)}</div>
          <div className="stat-sub">pagadas por factoring · con IVA</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Notas de crédito</div>
          <div className="stat-value" style={{ color: "#0ea5e9" }}>{stats.ncCount}</div>
          <div className="stat-money" style={{ color: "#0ea5e9" }}>{fmtCLP(stats.ncMonto)}</div>
          <div className="stat-sub">descuento aplicado a facturas</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Forzado a cierre</div>
          <div className="stat-value" style={{ color: "#dc2626" }}>{stats.forzadoCount}</div>
          <div className="stat-money" style={{ color: "#dc2626" }}>{fmtCLP(stats.forzadoMonto)}</div>
          <div className="stat-sub">cotizaciones de ciclo cerrado · monto forzado</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filter-bar">
        <div className="filter-field">
          <label className="filter-label">Estado</label>
          <select className="input" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="pagadas">Pagadas</option>
            <option value="pendientes">Pendientes</option>
            <option value="por_vencer">Por vencer</option>
            <option value="vencidas">Vencidas</option>
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Cierre de ciclo</label>
          <select className="input" value={filtroCierreForzado} onChange={(e) => setFiltroCierreForzado(e.target.value)}>
            <option value="todas">Todos</option>
            <option value="forzado">Cierre forzado</option>
            <option value="abiertos">Ciclos abiertos</option>
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Entidad</label>
          <input
            type="text"
            className="input"
            placeholder="Buscar entidad..."
            value={filtroEntidad}
            onChange={(e) => setFiltroEntidad(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">N° Factura / Boleta</label>
          <input
            type="text"
            className="input"
            placeholder="Buscar N° factura o boleta..."
            value={filtroNumero}
            onChange={(e) => setFiltroNumero(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo de Cotización</label>
          <select
            className="input"
            value={filtroTipoCotizacion}
            onChange={(e) => setFiltroTipoCotizacion(e.target.value)}
          >
            <option value="">Todas</option>
            {tiposCotizacion.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo de Compra</label>
          <select
            className="input"
            value={filtroTipoCompra}
            onChange={(e) => setFiltroTipoCompra(e.target.value)}
          >
            <option value="">Todos</option>
            {tiposCompra.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="filter-field" style={{ position: "relative" }} ref={formaPagoRef}>
          <label className="filter-label">Tipo de Pago</label>
          <button
            type="button"
            className="dropdown-trigger input"
            onClick={() => setOpenFormaPago((v) => !v)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {filtroFormaPago.length === 0
                ? "Todos"
                : FORMAS_PAGO.filter((fp) => filtroFormaPago.includes(fp.value)).map((fp) => fp.label).join(", ")}
            </span>
            <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
          </button>
          {openFormaPago && (
            <div className="dropdown-menu" style={{ zIndex: 40 }}>
              <div className="dropdown-menu-header">
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroFormaPago(FORMAS_PAGO.map((fp) => fp.value))}>
                  Todos
                </button>
                <button className="btn btn-sm btn-secondary" onClick={() => setFiltroFormaPago([])}>
                  Limpiar
                </button>
              </div>
              <div className="dropdown-menu-body">
                {FORMAS_PAGO.map((fp) => (
                  <label key={fp.value} className="dropdown-option">
                    <input
                      type="checkbox"
                      checked={filtroFormaPago.includes(fp.value)}
                      onChange={(e) => {
                        if (e.target.checked) setFiltroFormaPago((prev) => [...prev, fp.value]);
                        else setFiltroFormaPago((prev) => prev.filter((x) => x !== fp.value));
                      }}
                    />
                    {fp.label}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        {empresasDespacho.length > 0 && (
          <div className="filter-field">
            <label className="filter-label">Empresa despachadora</label>
            <select
              className="input"
              value={filtroEmpresaDespacho}
              onChange={(e) => setFiltroEmpresaDespacho(e.target.value)}
            >
              <option value="">Todas</option>
              {empresasDespacho.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>
          </div>
        )}
        <div className="filter-field">
          <label className="filter-label">Fecha Factura desde</label>
          <DateFilter value={filtroDesde} onChange={setFiltroDesde} maxDate={filtroHasta ? new Date(`${filtroHasta}T00:00:00`) : undefined} placeholder="Desde…" />
        </div>
        <div className="filter-field">
          <label className="filter-label">Fecha Factura hasta</label>
          <DateFilter value={filtroHasta} onChange={setFiltroHasta} minDate={filtroDesde ? new Date(`${filtroDesde}T00:00:00`) : undefined} placeholder="Hasta…" />
        </div>
      </div>

      {/* Tabla */}
      <div
        className="table-wrap"
        style={{
          boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04), 0 0 0 1px rgba(15, 23, 42, 0.04)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div className="table-scroll" style={{ maxHeight: "calc(100vh - 240px)" }}>
          <table className="data-table trazabilidad-table table-fit">
            <colgroup>
              <col style={{ width: "17%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "7%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr>
                <th onClick={() => toggleSort("entidad")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Cotización / Cliente <SortIcon col="entidad" />
                  </span>
                </th>
                <th onClick={() => toggleSort("factura")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Factura <SortIcon col="factura" />
                  </span>
                </th>
                <th onClick={() => toggleSort("fecha_factura")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Fecha Factura <SortIcon col="fecha_factura" />
                  </span>
                </th>
                <th onClick={() => toggleSort("vencimiento")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Vencimiento <SortIcon col="vencimiento" />
                  </span>
                </th>
                <th style={{ textAlign: "left" }}>Cond.</th>
                <th onClick={() => toggleSort("monto")} style={{ cursor: "pointer", userSelect: "none", textAlign: "right" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                    Monto <SortIcon col="monto" />
                  </span>
                </th>
                <th style={{ textAlign: "right" }} title="Solo cliente particular: factura menos comprobantes (transferencia + webpay + efectivo)">
                  Saldo por pagar
                </th>
                <th onClick={() => toggleSort("estado")} style={{ cursor: "pointer", userSelect: "none", textAlign: "left" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Estado <SortIcon col="estado" />
                  </span>
                </th>
                <th style={{ textAlign: "left" }}>Pago</th>
                <th style={{ textAlign: "right" }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {facturasOrdenadas.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                    No hay facturas que coincidan con los filtros.
                  </td>
                </tr>
              ) : (
                facturasOrdenadas.map((f) => {
                  const lic = licMap[f.licitacion_id];
                  if (!lic) return null;
                  const plazo = plazoDias(lic.condicion_venta);
                  const dias = diasEntre(f.fecha_factura);
                  const diasRestantes = dias != null ? plazo - dias : null;
                  const descalce = descalceMontos(f, lic);
                  const pagadaEf = estaPagada(f, lic);
                  const ncMonto = notasCreditoDe(f);
                  // Punto 17: si los montos no calzan, la factura queda "pendiente de pago".
                  const sem = descalce
                    ? { color: "#b45309", bg: "#fef3c7", label: "Pendiente de pago" }
                    : semaforo(diasRestantes, pagadaEf);
                  const editando = pagandoId === f.id;
                  const fechaVenc = calcularFechaVencimiento(f.fecha_factura, lic.condicion_venta);
                  const particular = esClienteParticular(lic);
                  // Cliente Particular: fecha y monto del pago = comprobante de pago.
                  const comprobante = comprobantesMap[lic.id];
                  const fechaPagoMostrar = particular
                    ? (comprobante?.fecha_oc ? String(comprobante.fecha_oc).slice(0, 10) : f.fecha_pago)
                    : f.fecha_pago;
                  // Monto del pago mostrado: el comprobante se guarda neto → ×1,19.
                  const montoParticular = comprobante?.monto != null
                    ? Math.round(Number(comprobante.monto) * 1.19)
                    : montoFacturaBruto(f);

                  return (
                    <tr key={f.id}>
                      <td style={{ verticalAlign: "middle" }}>
                        <Link to={`/detalle/${lic.id}`} className="table-link" style={{ fontWeight: 600 }}>
                          #{lic.id}
                        </Link>
                        {lic.id_licitacion && (
                          <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: 6 }}>
                            {lic.id_licitacion}
                          </span>
                        )}
                        <div style={{ fontWeight: 500, fontSize: "13px", color: "#1f2937", marginTop: 2 }}>
                          {lic.nombre_entidad || "—"}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "1px 8px",
                              borderRadius: "999px",
                              fontSize: "10px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: ".4px",
                              color: particular ? "#6d28d9" : "#0369a1",
                              background: particular ? "#ede9fe" : "#e0f2fe",
                            }}
                          >
                            {particular ? "Particular" : "Pública"}
                          </span>
                          {lic.ciclo_cerrado && (
                            <span
                              title={lic.monto_forzado ? `Monto forzado: $${Number(lic.monto_forzado).toLocaleString("es-CL")}` : "Ciclo cerrado de forma forzada en Trazabilidad"}
                              style={{
                                display: "inline-block",
                                padding: "1px 8px",
                                borderRadius: "999px",
                                fontSize: "10px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                letterSpacing: ".4px",
                                color: "#b91c1c",
                                background: "#fee2e2",
                              }}
                            >
                              Cierre forzado
                            </span>
                          )}
                          {lic.comuna && (
                            <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{lic.comuna}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 500, color: "#1f2937" }}>{f.numero || "S/N"}</span>
                          <button
                            type="button"
                            onClick={() => abrirDocumento(f)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0 }}
                            title="Ver PDF"
                          >
                            <Eye size={13} />
                          </button>
                        </div>
                      </td>
                      <td style={{ verticalAlign: "middle", color: "var(--text-muted)" }}>
                        {f.fecha_factura
                          ? new Date(`${f.fecha_factura}T00:00:00`).toLocaleDateString("es-CL")
                          : f.created_at
                          ? new Date(f.created_at).toLocaleDateString("es-CL")
                          : "—"}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        {fechaVenc ? (
                          <div>
                            <div style={{ color: "#1f2937", fontWeight: 500 }}>{fmtDateCL(fechaVenc)}</div>
                            {!f.pagada && diasRestantes != null && (
                              <div style={{ fontSize: 11, color: diasRestantes < 0 ? "#dc2626" : diasRestantes <= 5 ? "#b45309" : "var(--text-muted)" }}>
                                {diasRestantes < 0
                                  ? `Hace ${Math.abs(diasRestantes)}d`
                                  : `En ${diasRestantes}d`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle", color: "var(--text-muted)" }}>
                        {lic.condicion_venta || "—"}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {(() => {
                          // Monto = bruto (con IVA) de la factura cargada.
                          const m = montoFacturaBruto(f, lic);
                          return m > 0 ? `$${m.toLocaleString("es-CL")}` : "—";
                        })()}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                        {(() => {
                          // Saldo por pagar: base − notas de crédito − comprobantes.
                          // Lo mostramos cuando hay montos cargados (comprobantes
                          // o notas de crédito); aplica a cualquier tipo de cliente.
                          const pagado = Number(comprobantesSumMap[lic.id] || 0);
                          const cargas = pagado + ncMonto;
                          if (cargas <= 0) {
                            return <span style={{ color: "var(--text-muted)" }}>—</span>;
                          }
                          const saldo = saldoFactura(f, lic);
                          const color = saldo > 1 ? "#b45309" : saldo < -1 ? "#dc2626" : "#16a34a";
                          return (
                            <div>
                              <div style={{ fontWeight: 600, color, whiteSpace: "nowrap" }}>{fmtCLP(saldo)}</div>
                              {pagado > 0 && (
                                <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                                  Pagado {fmtCLP(pagado)}
                                </div>
                              )}
                              {ncMonto > 0 && (
                                <div style={{ fontSize: 11, color: "#7c3aed", whiteSpace: "nowrap" }}>
                                  N. crédito −{fmtCLP(ncMonto)}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        {particular && !f.pagada && !descalce ? (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "3px 10px",
                              borderRadius: "999px",
                              fontSize: "11px",
                              fontWeight: 600,
                              color: sem.color,
                              backgroundColor: sem.bg,
                            }}
                          >
                            {(descalce || (!pagadaEf && diasRestantes != null && diasRestantes <= 5)) && <AlertTriangle size={11} />}
                            {sem.label}
                          </span>
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle" }}>
                        {particular ? (
                          // Particular: mostramos fecha y monto del comprobante de
                          // pago aunque la factura/boleta no esté marcada pagada.
                          <div>
                            <div style={{ color: f.pagada ? "#15803d" : "#1f2937", fontWeight: 500, fontSize: "12px" }}>
                              {fechaPagoMostrar ? new Date(`${fechaPagoMostrar}T00:00:00`).toLocaleDateString("es-CL") : "—"}
                            </div>
                            <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                              {montoParticular != null ? fmtCLP(montoParticular) : "—"}
                            </div>
                            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                onClick={() => abrirVoucher(f)}
                                className="btn btn-secondary btn-sm"
                                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                                title="Subir comprobante de transferencia"
                              >
                                <Upload size={12} /> Subir voucher
                              </button>
                              {comprobante?.bucket && comprobante?.storage_path && (
                                <button
                                  type="button"
                                  onClick={() => abrirDocumento(comprobante)}
                                  className="btn btn-secondary btn-sm"
                                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                                  title="Ver comprobante"
                                >
                                  <Eye size={12} /> Ver
                                </button>
                              )}
                            </div>
                          </div>
                        ) : f.pagada ? (
                          <div>
                            <div style={{ color: "#15803d", fontWeight: 500, fontSize: "12px" }}>
                              {fechaPagoMostrar ? new Date(`${fechaPagoMostrar}T00:00:00`).toLocaleDateString("es-CL") : "—"}
                            </div>
                            <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
                              {FORMAS_PAGO.find((x) => x.value === f.forma_pago)?.label || f.forma_pago || "—"}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                       <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                        {editando ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", textAlign: "left" }}>
                            <DateFilter
                              value={fechaPago}
                              onChange={setFechaPago}
                              placeholder="Fecha pago"
                              disabled={guardando}
                            />
                            <select
                              className="input"
                              value={formaPago}
                              onChange={(e) => setFormaPago(e.target.value)}
                              disabled={guardando}
                            >
                              {FORMAS_PAGO.map((fp) => (
                                <option key={fp.value} value={fp.value}>{fp.label}</option>
                              ))}
                            </select>
                            <input
                              className="input"
                              inputMode="numeric"
                              placeholder="Monto del pago (opcional)"
                              value={montoPago ? `$${Number(String(montoPago).replace(/[^\d]/g, "")).toLocaleString("es-CL")}` : ""}
                              onChange={(e) => setMontoPago(e.target.value.replace(/[^\d]/g, ""))}
                              disabled={guardando}
                            />
                            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.3 }}>
                              Si el monto no cubre el total a cobrar, la factura queda «pendiente de pago».
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                              <button type="button" onClick={() => confirmarPago(f)} disabled={guardando} className="btn btn-primary btn-sm">
                                {guardando ? "..." : "Confirmar"}
                              </button>
                              <button type="button" onClick={cancelarPago} disabled={guardando} className="btn btn-secondary btn-sm">
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : f.pagada ? (
                          <button
                            type="button"
                            onClick={() => desmarcarPago(f)}
                            className="btn btn-secondary btn-sm"
                            title="Desmarcar pago"
                          >
                            <CheckCircle2 size={13} style={{ color: "#15803d", marginRight: 4 }} /> Desmarcar
                          </button>
                        ) : particular ? (
                          <button
                            type="button"
                            onClick={() => validarPagoParticular(f)}
                            className="btn btn-primary btn-sm"
                            title="Valida que los comprobantes cubran la factura (saldo 0)"
                          >
                            <CheckCircle2 size={13} style={{ marginRight: 4 }} /> Validar Pago
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => iniciarPago(f)}
                            className="btn btn-primary btn-sm"
                          >
                            <Circle size={12} style={{ marginRight: 4 }} /> Registrar Pago
                          </button>
                        )}
                        {!editando && (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                            {(notasCreditoMap[lic.id]?.length || 0) > 0 && (
                              <span style={{ fontSize: 11, color: "#7c3aed", whiteSpace: "nowrap" }}>
                                {notasCreditoMap[lic.id].length} N.C.
                                {notasCreditoMap[lic.id].some((n) => n.bucket && n.storage_path) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const conArchivo = notasCreditoMap[lic.id].find((n) => n.bucket && n.storage_path);
                                      if (conArchivo) abrirDocumento(conArchivo);
                                    }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: "0 0 0 4px", verticalAlign: "middle" }}
                                    title="Ver nota de crédito"
                                  >
                                    <Eye size={12} />
                                  </button>
                                )}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => abrirNotaCredito(f)}
                              className="btn btn-secondary btn-sm"
                              style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                              title="Agregar nota de crédito (descuenta del total a cobrar)"
                            >
                              <FileMinus size={12} /> Nota de crédito
                            </button>
                          </div>
                        )}
                       </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {voucherFor && createPortal(
        <div
          onClick={cerrarVoucher}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={subirVoucher}
            style={{ width: 420, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden", boxShadow: "var(--shadow-lg)" }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
              <strong style={{ fontSize: 15 }}>
                {voucherTipo === "nota_credito" ? "Agregar nota de crédito" : "Subir comprobante de transferencia"}
              </strong>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                Factura {voucherFor.numero || "S/N"} · {licMap[voucherFor.licitacion_id]?.nombre_entidad || ""}
              </div>
              {voucherTipo === "nota_credito" && (
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
                  El monto se descontará del total a cobrar de esta factura.
                </div>
              )}
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Archivo{voucherTipo === "nota_credito" ? " (opcional)" : ""}
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}>
                  <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    <Upload size={13} /> Seleccionar archivo
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setVFile(e.target.files?.[0] || null)}
                      style={{ display: "none" }}
                    />
                  </label>
                  <span
                    title={vFile ? vFile.name : ""}
                    style={{ fontSize: 12, fontWeight: 400, color: vFile ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}
                  >
                    {vFile ? vFile.name : "Ningún archivo seleccionado"}
                  </span>
                </div>
              </div>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                {voucherTipo === "nota_credito" ? "Monto" : "Monto bruto (lo transferido)"}
                <input type="text" inputMode="numeric" className="input" value={vMonto} onChange={(e) => setVMonto(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" style={{ marginTop: 4 }} />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                {voucherTipo === "nota_credito" ? "Fecha de la nota de crédito" : "Fecha del comprobante"}
                <div style={{ marginTop: 4 }}>
                  <DateFilter value={vFecha} onChange={setVFecha} placeholder="Fecha" />
                </div>
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                N° / referencia (opcional)
                <input type="text" className="input" value={vNumero} onChange={(e) => setVNumero(e.target.value)} placeholder={voucherTipo === "nota_credito" ? "N° nota de crédito…" : "N° operación, banco…"} style={{ marginTop: 4 }} />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
              <button type="button" onClick={cerrarVoucher} disabled={subiendoVoucher} className="btn btn-secondary">Cancelar</button>
              <button type="submit" disabled={subiendoVoucher} className="btn btn-primary">
                {subiendoVoucher ? "Guardando…" : voucherTipo === "nota_credito" ? "Agregar nota de crédito" : "Subir comprobante"}
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
