// Reportería (2026-09-17; abierta por perfil el 2026-09-24). Tres modos
// sobre el mismo motor de solo lectura del backend (/reporteria):
//   · Reportes guardados: la biblioteca del equipo, listos para re-ejecutar.
//   · Constructor: reportes SIN SQL sobre VISTAS DE NEGOCIO (columnas con
//     nombre en español, filtros, agrupación) — para cualquier usuario con
//     el módulo. Trae plantillas listas para usar. Admin además ve las
//     tablas crudas.
//   · Consulta SQL: SELECT libre con el catálogo de tablas (solo admin).
// Todo resultado se ve como tabla o como gráfico (SVG propio) y se exporta
// a Excel/CSV con los nombres legibles. El navegador nunca toca la base.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import DropdownSelect from "../components/ui/DropdownSelect";
import * as XLSX from "xlsx";
import {
  BarChart3, Database, FileDown, FilePieChart, Play, Plus, RefreshCw,
  Save, Search, Table2, Trash2, X, ChevronDown, ChevronRight, BookMarked,
} from "lucide-react";

/* ── Utilitarios ──────────────────────────────────────────────────────── */
const fmtNum = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  if (Number.isInteger(n)) return n.toLocaleString("es-CL");
  return n.toLocaleString("es-CL", { maximumFractionDigits: 2 });
};
// Ejes del gráfico: los montos grandes van compactos (1,2 M · 340 k) para
// que no se corten contra el borde del lienzo.
const fmtEje = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + " MM";
  if (abs >= 1e6) return (n / 1e6).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + " M";
  if (abs >= 1e4) return (n / 1e3).toLocaleString("es-CL", { maximumFractionDigits: 0 }) + " k";
  return fmtNum(n);
};
const esNumerico = (v) => v !== null && v !== "" && Number.isFinite(Number(v));

// Detecta columnas numéricas mirando las primeras filas.
function columnasNumericas(columnas, filas) {
  const muestra = filas.slice(0, 40);
  return columnas.filter((c) => {
    const valores = muestra.map((f) => f[c]).filter((v) => v !== null && v !== undefined && v !== "");
    return valores.length > 0 && valores.every(esNumerico);
  });
}

const OPERADORES = [
  { value: "igual", label: "es igual a" },
  { value: "distinto", label: "es distinto de" },
  { value: "contiene", label: "contiene" },
  { value: "no_contiene", label: "no contiene" },
  { value: "mayor", label: "mayor que" },
  { value: "mayor_igual", label: "mayor o igual" },
  { value: "menor", label: "menor que" },
  { value: "menor_igual", label: "menor o igual" },
  { value: "vacio", label: "está vacío" },
  { value: "no_vacio", label: "no está vacío" },
];
const SIN_VALOR = new Set(["vacio", "no_vacio"]);

const AGREGACIONES = [
  { value: "conteo", label: "Conteo de filas" },
  { value: "suma", label: "Suma" },
  { value: "promedio", label: "Promedio" },
  { value: "minimo", label: "Mínimo" },
  { value: "maximo", label: "Máximo" },
];

const TIPOS_GRAFICO = [
  { value: "barras", label: "Barras verticales" },
  { value: "barras_h", label: "Barras horizontales" },
  { value: "lineas", label: "Líneas" },
  { value: "area", label: "Área" },
  { value: "torta", label: "Torta" },
  { value: "dona", label: "Dona" },
  { value: "kpi", label: "Cifra grande (KPI)" },
];

const CONSULTAS_EJEMPLO = [
  {
    nombre: "Ventas adjudicadas por mes",
    sql: `select to_char(fecha_adjudicada, 'YYYY-MM') as mes,\n       count(*) as cotizaciones,\n       sum(total_con_iva) as monto_total\nfrom licitaciones\nwhere estado = 'Adjudicada' and fecha_adjudicada is not null\ngroup by 1\norder by 1 desc\nlimit 24`,
  },
  {
    nombre: "Top 15 clientes por monto adjudicado",
    sql: `select nombre_entidad, count(*) as cotizaciones, sum(total_con_iva) as monto\nfrom licitaciones\nwhere estado = 'Adjudicada'\ngroup by nombre_entidad\norder by monto desc\nlimit 15`,
  },
  {
    nombre: "Facturas con saldo pendiente",
    sql: `select l.id_licitacion, l.nombre_entidad, d.numero as factura,\n       d.monto as neto, round(d.monto * 1.19) as bruto, d.fecha\nfrom licitacion_documentos d\njoin licitaciones l on l.id = d.licitacion_id\nwhere d.tipo in ('factura', 'factura_boleta') and coalesce(d.pagada, false) = false\norder by d.fecha asc\nlimit 200`,
  },
];

/* Plantillas listas para usar (constructor sobre vistas de negocio). Cada
   una es una config del constructor; las columnas que el perfil no puede
   ver (costo/margen) se descartan al aplicarla. */
const PLANTILLAS = [
  {
    id: "cotizaciones_con_oc_productos",
    nombre: "Cotizaciones con orden de compra · detalle por producto",
    descripcion: "Una fila por producto de cada cotización que tiene OC: cliente, producto, cantidad, precios, costo y margen, N° de OC, vendedor, despacho, flete, estado, si es licitación y términos.",
    config: {
      tabla: "vista_cotizaciones_lineas",
      columnas: [
        "n_cotizacion", "fecha_creacion", "cliente", "producto", "sku", "cantidad",
        "precio_unitario_neto", "precio_total_neto", "costo_unitario", "costo_total", "margen_neto", "margen_pct",
        "n_orden_compra", "fecha_orden_compra", "vendedor", "tipo_despacho", "flete",
        "estado_cotizacion", "estado_entrega", "es_licitacion", "codigo_licitacion", "terminos",
      ],
      filtros: [{ campo: "tiene_orden_compra", operador: "igual", valor: "Sí" }],
      agrupar: [], agregaciones: [], ordenarPor: "fecha_creacion", ordenDesc: true, limite: 2000,
    },
  },
  {
    id: "cotizaciones_con_oc_resumen",
    nombre: "Cotizaciones con orden de compra · resumen",
    descripcion: "Una fila por cotización con OC: totales, N° de OC, guías, saldo por consumir, facturas y pagos pendientes.",
    config: {
      tabla: "vista_cotizaciones_resumen",
      columnas: [
        "n_cotizacion", "fecha_creacion", "cliente", "vendedor", "es_licitacion", "n_orden_compra", "fecha_orden_compra",
        "orden_compra_neto", "n_guia_despacho", "guias_neto", "saldo_por_consumir", "n_factura", "facturado_neto",
        "facturas_pago_pendiente", "estado_cotizacion", "estado_entrega", "tipo_despacho", "flete", "terminos",
      ],
      filtros: [{ campo: "tiene_orden_compra", operador: "igual", valor: "Sí" }],
      agrupar: [], agregaciones: [], ordenarPor: "fecha_orden_compra", ordenDesc: true, limite: 2000,
    },
  },
  {
    id: "venta_y_margen_por_vendedor",
    nombre: "Venta y margen por vendedor (con OC)",
    descripcion: "Suma de lo vendido y del margen por vendedor, solo cotizaciones con orden de compra.",
    config: {
      tabla: "vista_cotizaciones_lineas",
      columnas: [],
      filtros: [{ campo: "tiene_orden_compra", operador: "igual", valor: "Sí" }],
      agrupar: ["vendedor"],
      agregaciones: [
        { funcion: "conteo", campo: "*" },
        { funcion: "suma", campo: "precio_total_neto" },
        { funcion: "suma", campo: "margen_neto" },
      ],
      ordenarPor: "suma_precio_total_neto", ordenDesc: true, limite: 500,
    },
  },
  {
    id: "productos_mas_vendidos",
    nombre: "Productos más vendidos (con OC)",
    descripcion: "Cantidad y monto por producto, solo cotizaciones con orden de compra.",
    config: {
      tabla: "vista_cotizaciones_lineas",
      columnas: [],
      filtros: [{ campo: "tiene_orden_compra", operador: "igual", valor: "Sí" }],
      agrupar: ["sku", "producto"],
      agregaciones: [
        { funcion: "suma", campo: "cantidad" },
        { funcion: "suma", campo: "precio_total_neto" },
      ],
      ordenarPor: "suma_precio_total_neto", ordenDesc: true, limite: 500,
    },
  },
  {
    id: "saldo_por_consumir_por_cliente",
    nombre: "Saldo por consumir por cliente",
    descripcion: "Cuánto queda por despachar de las órdenes de compra, sumado por cliente.",
    config: {
      tabla: "vista_cotizaciones_resumen",
      columnas: [],
      filtros: [
        { campo: "tiene_orden_compra", operador: "igual", valor: "Sí" },
        { campo: "saldo_por_consumir", operador: "mayor", valor: "0" },
      ],
      agrupar: ["cliente"],
      agregaciones: [
        { funcion: "conteo", campo: "*" },
        { funcion: "suma", campo: "saldo_por_consumir" },
      ],
      ordenarPor: "suma_saldo_por_consumir", ordenDesc: true, limite: 500,
    },
  },
];

/* Pestañas con subrayado (patrón de Acceso al Portal / Despachos). */
const est = {
  tabs: { display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)", flexWrap: "wrap" },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 16px",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "var(--text-muted)",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  tabActiva: { color: "var(--primary)", borderBottomColor: "var(--primary)" },
  tabBadge: {
    background: "var(--primary-light)",
    color: "var(--primary-dark)",
    fontSize: 11,
    fontWeight: 800,
    borderRadius: 999,
    padding: "1px 8px",
  },
};

/* ── Paleta de los gráficos (misma familia del panel) ─────────────────── */
const PALETA = ["#1e9295", "#0369a1", "#6d28d9", "#b45309", "#be185d", "#15803d", "#c2410c", "#4338ca", "#a21caf", "#0f766e", "#92400e", "#1d4ed8"];

/* ── Gráfico SVG (sin dependencias) ───────────────────────────────────── */
function GraficoReporte({ tipo, datos, etiquetaDim, etiquetaMed }) {
  const W = 860;
  const H = 340;
  const M = { arriba: 18, abajo: 64, izq: 74, der: 16 };

  if (!datos.length) {
    return <div style={{ padding: 30, color: "var(--text-muted)", fontSize: 13 }}>Sin datos para graficar con esa configuración.</div>;
  }

  if (tipo === "kpi") {
    const total = datos.reduce((s, d) => s + d.valor, 0);
    return (
      <div style={{ padding: "34px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 44, fontWeight: 800, color: "var(--primary-dark)", fontVariantNumeric: "tabular-nums" }}>{fmtNum(total)}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          {etiquetaMed} · {datos.length === 1 ? etiquetaDim : `${fmtNum(datos.length)} categorías sumadas`}
        </div>
      </div>
    );
  }

  if (tipo === "torta" || tipo === "dona") {
    const MAXIMO = 12;
    let series = [...datos].sort((a, b) => b.valor - a.valor);
    if (series.length > MAXIMO) {
      const resto = series.slice(MAXIMO - 1).reduce((s, d) => s + d.valor, 0);
      series = [...series.slice(0, MAXIMO - 1), { etiqueta: "Otros", valor: resto }];
    }
    const total = series.reduce((s, d) => s + Math.max(d.valor, 0), 0) || 1;
    const cx = 175, cy = 165, r = 130;
    const rInterno = tipo === "dona" ? 72 : 0;
    // Ángulo inicial de cada sector = acumulado de las fracciones previas.
    const fracciones = series.map((d) => Math.max(d.valor, 0) / total);
    const acumuladas = fracciones.map((_, i) => fracciones.slice(0, i).reduce((s, f) => s + f, 0));
    const sectores = series.map((d, i) => {
      const frac = fracciones[i];
      const a0 = -Math.PI / 2 + acumuladas[i] * Math.PI * 2;
      const a1 = a0 + frac * Math.PI * 2;
      const grande = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, radio) => `${cx + radio * Math.cos(a)},${cy + radio * Math.sin(a)}`;
      const ruta = rInterno
        ? `M ${p(a0, r)} A ${r} ${r} 0 ${grande} 1 ${p(a1, r)} L ${p(a1, rInterno)} A ${rInterno} ${rInterno} 0 ${grande} 0 ${p(a0, rInterno)} Z`
        : `M ${cx},${cy} L ${p(a0, r)} A ${r} ${r} 0 ${grande} 1 ${p(a1, r)} Z`;
      return { d, ruta, color: PALETA[i % PALETA.length], frac };
    });
    return (
      <svg viewBox={`0 0 ${W} 340`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
        {sectores.map((s, i) => (
          <path key={i} d={s.ruta} fill={s.color} stroke="var(--surface)" strokeWidth="1.5">
            <title>{`${s.d.etiqueta}: ${fmtNum(s.d.valor)} (${(s.frac * 100).toFixed(1)}%)`}</title>
          </path>
        ))}
        {sectores.map((s, i) => (
          <g key={`l${i}`}>
            <rect x={370} y={26 + i * 25} width={12} height={12} rx={3} fill={s.color} />
            <text x={388} y={37 + i * 25} fontSize="12.5" fill="var(--text)">
              {String(s.d.etiqueta).slice(0, 40)} — {fmtNum(s.d.valor)} ({(s.frac * 100).toFixed(1)}%)
            </text>
          </g>
        ))}
      </svg>
    );
  }

  if (tipo === "barras_h") {
    const series = [...datos].sort((a, b) => b.valor - a.valor).slice(0, 20);
    const alto = M.arriba + series.length * 27 + 30;
    const max = Math.max(...series.map((d) => d.valor), 1);
    const anchoBarra = W - 250 - M.der;
    return (
      <svg viewBox={`0 0 ${W} ${alto}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
        {series.map((d, i) => {
          const y = M.arriba + i * 27;
          const w = Math.max((Math.max(d.valor, 0) / max) * anchoBarra, 1);
          return (
            <g key={i}>
              <text x={244} y={y + 13} fontSize="12" fill="var(--text)" textAnchor="end">{String(d.etiqueta).slice(0, 34)}</text>
              <rect x={250} y={y} width={w} height={18} rx={4} fill={PALETA[0]}>
                <title>{`${d.etiqueta}: ${fmtNum(d.valor)}`}</title>
              </rect>
              <text x={250 + w + 6} y={y + 13} fontSize="11.5" fill="var(--text-muted)" fontVariantNumeric="tabular-nums">{fmtNum(d.valor)}</text>
            </g>
          );
        })}
      </svg>
    );
  }

  // barras / líneas / área — eje X en orden de llegada.
  const series = datos.slice(0, 60);
  const max = Math.max(...series.map((d) => d.valor), 1);
  const min = Math.min(...series.map((d) => d.valor), 0);
  const rango = max - min || 1;
  const anchoUtil = W - M.izq - M.der;
  const altoUtil = H - M.arriba - M.abajo;
  const xDe = (i) => M.izq + (series.length === 1 ? anchoUtil / 2 : (i * anchoUtil) / (series.length - (tipo === "barras" ? 0 : 1)));
  const yDe = (v) => M.arriba + altoUtil - ((v - min) / rango) * altoUtil;
  const lineasGuia = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * rango);
  const pasoEtiqueta = Math.ceil(series.length / 14);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img">
      {lineasGuia.map((v, i) => (
        <g key={i}>
          <line x1={M.izq} x2={W - M.der} y1={yDe(v)} y2={yDe(v)} stroke="var(--border)" strokeDasharray="3 4" strokeWidth="1" />
          <text x={M.izq - 8} y={yDe(v) + 4} fontSize="10.5" fill="var(--text-muted)" textAnchor="end" fontVariantNumeric="tabular-nums">{fmtEje(v)}</text>
        </g>
      ))}
      {tipo === "barras" && series.map((d, i) => {
        const bw = Math.max((anchoUtil / series.length) * 0.66, 3);
        const x = xDe(i) + ((anchoUtil / series.length) - bw) / 2;
        const y = yDe(Math.max(d.valor, 0));
        const h = Math.abs(yDe(0) - yDe(d.valor));
        return (
          <rect key={i} x={x} y={Math.min(y, yDe(0))} width={bw} height={Math.max(h, 1)} rx={3} fill={PALETA[0]}>
            <title>{`${d.etiqueta}: ${fmtNum(d.valor)}`}</title>
          </rect>
        );
      })}
      {(tipo === "lineas" || tipo === "area") && (
        <>
          {tipo === "area" && (
            <path
              d={`M ${xDe(0)},${yDe(series[0].valor)} ` + series.map((d, i) => `L ${xDe(i)},${yDe(d.valor)}`).join(" ") + ` L ${xDe(series.length - 1)},${yDe(min)} L ${xDe(0)},${yDe(min)} Z`}
              fill={PALETA[0]} opacity="0.16"
            />
          )}
          <path
            d={`M ${xDe(0)},${yDe(series[0].valor)} ` + series.map((d, i) => `L ${xDe(i)},${yDe(d.valor)}`).join(" ")}
            fill="none" stroke={PALETA[0]} strokeWidth="2.5" strokeLinejoin="round"
          />
          {series.map((d, i) => (
            <circle key={i} cx={xDe(i)} cy={yDe(d.valor)} r={3.2} fill={PALETA[0]}>
              <title>{`${d.etiqueta}: ${fmtNum(d.valor)}`}</title>
            </circle>
          ))}
        </>
      )}
      {series.map((d, i) => (
        i % pasoEtiqueta === 0 && (
          <text
            key={`x${i}`}
            x={tipo === "barras" ? xDe(i) + (anchoUtil / series.length) / 2 : xDe(i)}
            y={H - M.abajo + 14}
            fontSize="10.5" fill="var(--text-muted)" textAnchor="end"
            transform={`rotate(-38 ${tipo === "barras" ? xDe(i) + (anchoUtil / series.length) / 2 : xDe(i)} ${H - M.abajo + 14})`}
          >
            {String(d.etiqueta).slice(0, 18)}
          </text>
        )
      ))}
    </svg>
  );
}

/* ── Resultado: tabla + gráfico + exportar + guardar ──────────────────── */
function ResultadoReporte({ resultado, grafico, setGrafico, onGuardar, nombreArchivo, etiquetas = {} }) {
  const et = (c) => etiquetas[c] || c;
  // El padre remonta este componente (key) con cada resultado nuevo, así la
  // página y la vista parten limpias sin efectos.
  const [vista, setVista] = useState("tabla");
  const [pagina, setPagina] = useState(0);
  const POR_PAGINA = 50;

  const numericas = useMemo(
    () => columnasNumericas(resultado.columnas, resultado.filas),
    [resultado],
  );
  const dimensiones = useMemo(
    () => resultado.columnas.filter((c) => !numericas.includes(c) || resultado.columnas.length === numericas.length),
    [resultado, numericas],
  );

  // Config del gráfico con defaults razonables.
  const dim = grafico.dimension && resultado.columnas.includes(grafico.dimension) ? grafico.dimension : dimensiones[0] || resultado.columnas[0];
  const med = grafico.medida && numericas.includes(grafico.medida) ? grafico.medida : numericas[0];

  const datosGrafico = useMemo(() => {
    if (!dim || !med) return [];
    return resultado.filas
      .map((f) => ({ etiqueta: String(f[dim] ?? "—"), valor: Number(f[med]) || 0 }))
      .filter((d) => d.etiqueta !== "");
  }, [resultado, dim, med]);

  function exportar(formato) {
    // Las columnas salen con su nombre legible (el de la vista), no el técnico.
    const filasExport = resultado.filas.map((f) => {
      const o = {};
      resultado.columnas.forEach((c) => { o[et(c)] = f[c]; });
      return o;
    });
    const hoja = XLSX.utils.json_to_sheet(filasExport);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Reporte");
    const base = (nombreArchivo || "reporte").replace(/[^\w-]+/g, "_").slice(0, 60);
    if (formato === "csv") XLSX.writeFile(libro, `${base}.csv`, { bookType: "csv" });
    else XLSX.writeFile(libro, `${base}.xlsx`);
  }

  const totalPaginas = Math.max(1, Math.ceil(resultado.filas.length / POR_PAGINA));
  const filasPagina = resultado.filas.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  return (
    <div className="surface" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
        <div className="segmentado">
          <button type="button" className={vista === "tabla" ? "activo" : ""} onClick={() => setVista("tabla")}>
            <Table2 size={14} />Tabla
          </button>
          <button type="button" className={vista === "grafico" ? "activo" : ""} onClick={() => setVista("grafico")}>
            <BarChart3 size={14} />Gráfico
          </button>
        </div>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          {fmtNum(resultado.total)} filas · {resultado.ms} ms
          {resultado.truncado && <strong style={{ color: "var(--warning)" }}> · truncado a 10.000</strong>}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => exportar("xlsx")}>
            <FileDown size={13} style={{ marginRight: 4 }} />Excel
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => exportar("csv")}>
            <FileDown size={13} style={{ marginRight: 4 }} />CSV
          </button>
          {onGuardar && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onGuardar}>
              <Save size={13} style={{ marginRight: 4 }} />Guardar reporte
            </button>
          )}
        </div>
      </div>

      {vista === "grafico" && (
        <div style={{ padding: "12px 16px" }}>
          <div className="reporteria-fila-control" style={{ marginBottom: 10 }}>
            <DropdownSelect value={grafico.tipo} onChange={(v) => setGrafico((g) => ({ ...g, tipo: v }))} options={TIPOS_GRAFICO} minWidth={200} style={{ width: 195, height: 34 }} />
            <DropdownSelect
              value={dim || ""}
              onChange={(v) => setGrafico((g) => ({ ...g, dimension: v }))}
              options={resultado.columnas.map((c) => ({ value: c, label: et(c) }))}
              placeholder="Categoría (eje X)"
              minWidth={190}
              style={{ width: 190, height: 34 }}
            />
            <DropdownSelect
              value={med || ""}
              onChange={(v) => setGrafico((g) => ({ ...g, medida: v }))}
              options={numericas.map((c) => ({ value: c, label: et(c) }))}
              placeholder="Valor (numérico)"
              minWidth={190}
              style={{ width: 190, height: 34 }}
            />
          </div>
          {!numericas.length ? (
            <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 13 }}>
              El resultado no tiene columnas numéricas para graficar. Agrega una agregación (suma, conteo…) o consulta un campo numérico.
            </div>
          ) : (
            <GraficoReporte tipo={grafico.tipo} datos={datosGrafico} etiquetaDim={et(dim)} etiquetaMed={et(med)} />
          )}
        </div>
      )}

      {vista === "tabla" && (
        <>
          <div className="reporteria-resultado-tabla" style={{ maxHeight: 480, overflowY: "auto" }}>
            <table>
              <thead>
                <tr>{resultado.columnas.map((c) => <th key={c} title={c}>{et(c)}</th>)}</tr>
              </thead>
              <tbody>
                {filasPagina.map((f, i) => (
                  <tr key={i}>
                    {resultado.columnas.map((c) => (
                      <td key={c} title={String(f[c] ?? "")}>
                        {esNumerico(f[c]) ? fmtNum(f[c]) : String(f[c] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
                {!resultado.filas.length && (
                  <tr><td colSpan={resultado.columnas.length || 1} style={{ color: "var(--text-muted)", padding: 20 }}>La consulta no devolvió filas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "9px 16px", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
              <span style={{ color: "var(--text-muted)" }}>Página {pagina + 1} de {totalPaginas}</span>
              <button type="button" className="btn btn-sm btn-secondary" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
              <button type="button" className="btn btn-sm btn-secondary" disabled={pagina >= totalPaginas - 1} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Página ───────────────────────────────────────────────────────────── */
const CONFIG_VACIA = { tabla: "", columnas: [], filtros: [], agrupar: [], agregaciones: [], ordenarPor: "", ordenDesc: true, limite: 500 };
const NOMBRE_AGG = { conteo: "Conteo", suma: "Suma", promedio: "Promedio", minimo: "Mínimo", maximo: "Máximo" };
const GRAFICO_DEFECTO = { tipo: "barras", dimension: "", medida: "" };

export default function Reporteria() {
  const { cargando: cargandoAuth } = useAuth();
  // Lo que puede hacer este usuario lo dice el catálogo del backend (según
  // rol): SQL libre y tablas crudas solo admin; costo/margen según perfil.

  const [tab, setTab] = useState("guardados");
  const [toast, setToast] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [guardados, setGuardados] = useState([]);
  const [cargandoGuardados, setCargandoGuardados] = useState(true);

  // Constructor
  const [config, setConfig] = useState(CONFIG_VACIA);
  const [modo, setModo] = useState("detalle"); // detalle | resumen
  // SQL
  const [sql, setSql] = useState("");
  const editorRef = useRef(null);
  const [busquedaCat, setBusquedaCat] = useState("");
  const [tablaAbierta, setTablaAbierta] = useState("");
  // Resultado compartido
  const [resultado, setResultado] = useState(null);
  const [grafico, setGrafico] = useState(GRAFICO_DEFECTO);
  const [ejecutando, setEjecutando] = useState(false);
  // Guardar / eliminar
  const [modalGuardar, setModalGuardar] = useState(null); // { tipo, config?, sql?, id?, nombre, descripcion }
  const [confirmarBorrar, setConfirmarBorrar] = useState(null);
  // Identifica el reporte abierto para "actualizar" en vez de duplicar.
  const [reporteAbierto, setReporteAbierto] = useState(null);

  useEffect(() => {
    if (cargandoAuth) return;
    api.get("/reporteria/catalogo")
      .then(setCatalogo)
      .catch((e) => setToast({ type: "error", message: e?.message || "No se pudo cargar el catálogo de datos." }));
    cargarGuardados();
  }, [cargandoAuth]);

  async function cargarGuardados() {
    setCargandoGuardados(true);
    try {
      const data = await api.get("/reporteria/reportes");
      setGuardados(Array.isArray(data) ? data : []);
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudieron cargar los reportes guardados." });
    } finally {
      setCargandoGuardados(false);
    }
  }

  const tablas = useMemo(() => catalogo?.tablas || [], [catalogo]);
  const vistas = useMemo(() => catalogo?.vistas || [], [catalogo]);
  const puedeSQL = !!catalogo?.puedeSQL;
  // Origen del constructor: una vista de negocio (nombres en español) o,
  // para admin, una tabla cruda. Ambas se normalizan a { nombre, etiqueta, tipo }.
  const vistaActual = vistas.find((v) => v.id === config.tabla);
  const tablaActual = tablas.find((t) => t.tabla === config.tabla);
  const origenNombre = vistaActual?.nombre || tablaActual?.tabla || config.tabla;
  const columnasTabla = useMemo(() => {
    if (vistaActual) return vistaActual.columnas;
    return (tablaActual?.columnas || []).map((c) => ({ nombre: c.nombre, etiqueta: c.nombre, tipo: c.tipo }));
  }, [vistaActual, tablaActual]);
  const opcionesTabla = useMemo(() => [
    ...vistas.map((v) => ({ value: v.id, label: v.nombre, detalle: v.descripcion })),
    ...tablas.map((t) => ({
      value: t.tabla,
      label: `Tabla: ${t.tabla}`,
      ...(t.descripcion ? { detalle: t.descripcion } : {}),
    })),
  ], [vistas, tablas]);
  const opcionesColumna = columnasTabla.map((c) => ({ value: c.nombre, label: c.etiqueta || c.nombre, detalle: c.descripcion || c.tipo }));
  // Nombre legible de cada columna del resultado (incluye los alias de las
  // agregaciones: suma_precio_total_neto → "Suma de Precio total (neto)").
  const etiquetas = useMemo(() => {
    const m = {};
    columnasTabla.forEach((c) => { m[c.nombre] = c.etiqueta || c.nombre; });
    (config.agregaciones || []).forEach((a) => {
      const alias = `${a.funcion}_${a.campo === "*" ? "filas" : a.campo}`;
      m[alias] = a.campo === "*" ? "Conteo de filas" : `${NOMBRE_AGG[a.funcion] || a.funcion} de ${m[a.campo] || a.campo}`;
    });
    return m;
  }, [columnasTabla, config.agregaciones]);
  const nombreVista = (id) => vistas.find((v) => v.id === id)?.nombre || id;

  // Aplica una plantilla: descarta columnas que este perfil no puede ver
  // (costo/margen) y ejecuta de inmediato.
  function usarPlantilla(p) {
    const vista = vistas.find((v) => v.id === p.config.tabla);
    if (!vista) { setToast({ type: "error", message: "Esta plantilla no está disponible para tu perfil." }); return; }
    const disponibles = new Set(vista.columnas.map((c) => c.nombre));
    const cfg = {
      ...CONFIG_VACIA,
      ...p.config,
      columnas: (p.config.columnas || []).filter((c) => disponibles.has(c)),
      agregaciones: (p.config.agregaciones || []).filter((a) => a.campo === "*" || disponibles.has(a.campo)),
    };
    if (cfg.ordenarPor && !disponibles.has(cfg.ordenarPor) && !cfg.agregaciones.some((a) => `${a.funcion}_${a.campo === "*" ? "filas" : a.campo}` === cfg.ordenarPor)) cfg.ordenarPor = "";
    setReporteAbierto({ nombre: p.nombre, descripcion: p.descripcion, tipo: "constructor" });
    setConfig(cfg);
    const m = (cfg.agrupar.length || cfg.agregaciones.length) ? "resumen" : "detalle";
    setModo(m);
    setResultado(null);
    setTimeout(() => ejecutarConstructor(cfg, null, m), 0);
  }

  /* ── Ejecutar ───────────────────────────────────────────────────────── */
  async function ejecutarConstructor(cfg = config, graficoGuardado = null, modoForzado = null) {
    if (!cfg.tabla) { setToast({ type: "error", message: "Elige un origen de datos para el reporte." }); return; }
    setEjecutando(true);
    try {
      const cuerpo = { ...cfg };
      if ((modoForzado || modo) === "detalle") { cuerpo.agrupar = []; cuerpo.agregaciones = []; }
      const r = await api.post("/reporteria/consulta", cuerpo);
      setResultado(r);
      if (graficoGuardado) setGrafico({ ...GRAFICO_DEFECTO, ...graficoGuardado });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo ejecutar el reporte." });
    } finally {
      setEjecutando(false);
    }
  }

  async function ejecutarSQL(consulta = sql, graficoGuardado = null) {
    if (!String(consulta || "").trim()) { setToast({ type: "error", message: "Escribe una consulta." }); return; }
    setEjecutando(true);
    try {
      const r = await api.post("/reporteria/sql", { consulta });
      setResultado(r);
      if (graficoGuardado) setGrafico({ ...GRAFICO_DEFECTO, ...graficoGuardado });
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo ejecutar la consulta." });
    } finally {
      setEjecutando(false);
    }
  }

  /* ── Guardar / abrir / borrar ───────────────────────────────────────── */
  async function guardarReporte() {
    const m = modalGuardar;
    if (!m?.nombre?.trim()) { setToast({ type: "error", message: "Ponle un nombre al reporte." }); return; }
    try {
      await api.post("/reporteria/reportes", {
        id: m.id || undefined,
        nombre: m.nombre.trim(),
        descripcion: m.descripcion || "",
        tipo: m.tipo,
        config: m.tipo === "constructor" ? { ...config, modo, grafico } : { grafico },
        sql: m.tipo === "sql" ? sql : undefined,
      });
      setModalGuardar(null);
      setToast({ type: "success", message: m.id ? "Reporte actualizado." : "Reporte guardado." });
      cargarGuardados();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo guardar." });
    }
  }

  function abrirGuardado(r) {
    setReporteAbierto(r);
    setResultado(null);
    if (r.tipo === "sql") {
      setSql(r.sql || "");
      setTab("sql");
      ejecutarSQL(r.sql || "", r.config?.grafico);
    } else {
      const c = { ...CONFIG_VACIA, ...(r.config || {}) };
      delete c.grafico; delete c.modo;
      setConfig(c);
      const m = r.config?.modo || ((r.config?.agrupar?.length || r.config?.agregaciones?.length) ? "resumen" : "detalle");
      setModo(m);
      setTab("constructor");
      // Ejecuta con la config recién cargada (no la del estado anterior).
      setTimeout(() => ejecutarConstructor({ ...CONFIG_VACIA, ...(r.config || {}) }, r.config?.grafico, m), 0);
    }
  }

  async function borrarGuardado(r) {
    try {
      await api.delete(`/reporteria/reportes/${r.id}`);
      setToast({ type: "success", message: "Reporte eliminado." });
      setConfirmarBorrar(null);
      cargarGuardados();
    } catch (e) {
      setToast({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  /* ── Insertar en el editor SQL desde el catálogo ────────────────────── */
  function insertarEnEditor(texto) {
    const el = editorRef.current;
    if (!el) { setSql((s) => s + texto); return; }
    const ini = el.selectionStart ?? sql.length;
    const fin = el.selectionEnd ?? sql.length;
    const nuevo = sql.slice(0, ini) + texto + sql.slice(fin);
    setSql(nuevo);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = ini + texto.length;
    });
  }

  const tablasFiltradas = tablas.filter((t) => !busquedaCat || t.tabla.includes(busquedaCat.toLowerCase()));

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmModal
        open={confirmarBorrar !== null}
        title="¿Eliminar este reporte?"
        message={`Se eliminará "${confirmarBorrar?.nombre || ""}" para todo el equipo.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        confirmTone="danger"
        onConfirm={() => borrarGuardado(confirmarBorrar)}
        onCancel={() => setConfirmarBorrar(null)}
      />

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FilePieChart size={20} /> Reportería
          </h1>
          <p className="page-subtitle">Arma tus propios reportes sin SQL: elige un origen de datos, las columnas, filtros y agrupaciones; guárdalos para el equipo y expórtalos a Excel.</p>
        </div>
      </div>

      {/* Pestañas con subrayado: el mismo patrón de Acceso al Portal y
          Despachos, que es la estructura general de la plataforma. */}
      <div style={est.tabs}>
        <button type="button" style={{ ...est.tab, ...(tab === "guardados" ? est.tabActiva : {}) }} onClick={() => setTab("guardados")}>
          <BookMarked size={15} /> Reportes guardados
          {guardados.length > 0 && <span style={est.tabBadge}>{guardados.length}</span>}
        </button>
        <button type="button" style={{ ...est.tab, ...(tab === "constructor" ? est.tabActiva : {}) }} onClick={() => setTab("constructor")}>
          <Table2 size={15} /> Constructor
        </button>
        {puedeSQL && (
          <button type="button" style={{ ...est.tab, ...(tab === "sql" ? est.tabActiva : {}) }} onClick={() => setTab("sql")}>
            <Database size={15} /> Consulta SQL
          </button>
        )}
      </div>

      {/* ── Guardados ─────────────────────────────────────────────────── */}
      {tab === "guardados" && (
        <div className="surface" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ fontSize: 14 }}>Biblioteca de reportes</strong>
            <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: "auto" }} onClick={cargarGuardados}>
              <RefreshCw size={13} style={{ marginRight: 4 }} />Actualizar
            </button>
          </div>
          {cargandoGuardados ? (
            <div style={{ padding: 30, color: "var(--text-muted)" }}>Cargando…</div>
          ) : !guardados.length ? (
            <div style={{ padding: "34px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 13.5 }}>
              Aún no hay reportes guardados. Arma uno en el <b>Constructor</b> (o parte de una plantilla) y guárdalo aquí para todo el equipo.
              <div style={{ marginTop: 6, fontSize: 12.5 }}>(Si acabas de instalar el módulo, recuerda aplicar la migración <code>20260917_reporteria.sql</code> para poder guardar.)</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12, padding: 16 }}>
              {guardados.map((r) => (
                <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {r.tipo === "sql" ? <Database size={15} style={{ color: "var(--primary)", flexShrink: 0 }} /> : <Table2 size={15} style={{ color: "var(--primary)", flexShrink: 0 }} />}
                    <strong style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.nombre}</strong>
                  </div>
                  {r.descripcion && <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.4 }}>{r.descripcion}</div>}
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {r.tipo === "sql" ? "Consulta SQL" : `Constructor · ${nombreVista(r.config?.tabla) || "—"}`}
                    {r.creado_por ? ` · ${r.creado_por}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => abrirGuardado(r)}>
                      <Play size={13} style={{ marginRight: 4 }} />Ejecutar
                    </button>
                    <button type="button" className="btn btn-sm btn-secondary" style={{ marginLeft: "auto", color: "var(--danger)" }} title="Eliminar reporte" onClick={() => setConfirmarBorrar(r)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Constructor ───────────────────────────────────────────────── */}
      {tab === "constructor" && (
        <div className="surface" style={{ padding: 16 }}>
          {/* Plantillas: reportes listos que también sirven de punto de partida. */}
          <div style={{ marginBottom: 16 }}>
            <label className="filter-label">Reportes listos para usar</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {PLANTILLAS.filter((p) => vistas.some((v) => v.id === p.config.tabla)).map((p) => (
                <button
                  key={p.id} type="button"
                  className={`reporteria-chip${reporteAbierto?.nombre === p.nombre ? " activa" : ""}`}
                  title={p.descripcion}
                  onClick={() => usarPlantilla(p)}
                >
                  <Play size={11} style={{ marginRight: 4 }} />{p.nombre}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 }}>
              Al elegir una, se ejecuta y queda cargada abajo para que la ajustes (columnas, filtros) y la guardes con tu nombre.
            </div>
          </div>

          <div className="reporteria-fila-control" style={{ marginBottom: 14 }}>
            <div className="reporteria-campo">
              <label className="filter-label">Origen de datos</label>
              <DropdownSelect
                value={config.tabla}
                onChange={(v) => { setConfig({ ...CONFIG_VACIA, tabla: v, limite: config.limite }); setResultado(null); setReporteAbierto(null); }}
                options={opcionesTabla}
                placeholder="Elige un origen…"
                minWidth={360}
                style={{ width: 320, height: 36 }}
              />
            </div>
            <div className="reporteria-campo">
              <label className="filter-label">Modo</label>
              <div className="segmentado">
                <button type="button" className={modo === "detalle" ? "activo" : ""} onClick={() => setModo("detalle")}>Detalle (filas)</button>
                <button type="button" className={modo === "resumen" ? "activo" : ""} onClick={() => setModo("resumen")}>Resumen (agrupado)</button>
              </div>
            </div>
            <div className="reporteria-campo">
              <label className="filter-label">Límite de filas</label>
              <input
                className="input" type="number" min={1} max={10000}
                style={{ width: 110, height: 36 }}
                value={config.limite}
                onChange={(e) => setConfig((c) => ({ ...c, limite: e.target.value }))}
              />
            </div>
          </div>

          {(vistaActual?.descripcion || tablaActual?.descripcion) && (
            <div style={{ fontSize: 12.5, color: "var(--primary-dark)", background: "var(--primary-light)", borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
              {vistaActual?.descripcion || tablaActual?.descripcion}
              {vistaActual?.grano && <span style={{ opacity: .8 }}> · Cada fila es un(a) {vistaActual.grano}.</span>}
            </div>
          )}

          {config.tabla && modo === "detalle" && (
            <div style={{ marginBottom: 14 }}>
              <label className="filter-label">Columnas (vacío = todas)</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                {columnasTabla.map((c) => {
                  const activa = config.columnas.includes(c.nombre);
                  return (
                    <button
                      key={c.nombre} type="button"
                      className={`reporteria-chip${activa ? " activa" : ""}`}
                      title={c.descripcion || c.tipo}
                      onClick={() => setConfig((cfg) => ({
                        ...cfg,
                        columnas: activa ? cfg.columnas.filter((x) => x !== c.nombre) : [...cfg.columnas, c.nombre],
                      }))}
                    >
                      {c.etiqueta || c.nombre}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {config.tabla && modo === "resumen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
              <div>
                <label className="filter-label">Agrupar por</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                  {columnasTabla.map((c) => {
                    const activa = config.agrupar.includes(c.nombre);
                    return (
                      <button
                        key={c.nombre} type="button"
                        className={`reporteria-chip${activa ? " activa" : ""}`}
                        title={c.descripcion || c.tipo}
                        onClick={() => setConfig((cfg) => ({
                          ...cfg,
                          agrupar: activa ? cfg.agrupar.filter((x) => x !== c.nombre) : [...cfg.agrupar, c.nombre],
                        }))}
                      >
                        {c.etiqueta || c.nombre}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="filter-label">Cálculos</label>
                {config.agregaciones.map((a, i) => (
                  <div key={i} className="reporteria-fila-control" style={{ marginTop: 6 }}>
                    <DropdownSelect
                      value={a.funcion}
                      onChange={(v) => setConfig((cfg) => ({ ...cfg, agregaciones: cfg.agregaciones.map((x, j) => (j === i ? { ...x, funcion: v, campo: v === "conteo" ? "*" : (x.campo === "*" ? "" : x.campo) } : x)) }))}
                      options={AGREGACIONES}
                      minWidth={180}
                      style={{ width: 175, height: 34 }}
                    />
                    {a.funcion !== "conteo" && (
                      <DropdownSelect
                        value={a.campo}
                        onChange={(v) => setConfig((cfg) => ({ ...cfg, agregaciones: cfg.agregaciones.map((x, j) => (j === i ? { ...x, campo: v } : x)) }))}
                        options={opcionesColumna}
                        placeholder="Campo…"
                        minWidth={200}
                        style={{ width: 210, height: 34 }}
                      />
                    )}
                    <button type="button" className="btn btn-sm btn-secondary" title="Quitar cálculo" onClick={() => setConfig((cfg) => ({ ...cfg, agregaciones: cfg.agregaciones.filter((_, j) => j !== i) }))}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 8 }}
                  onClick={() => setConfig((cfg) => ({ ...cfg, agregaciones: [...cfg.agregaciones, { funcion: "conteo", campo: "*" }] }))}
                >
                  <Plus size={13} style={{ marginRight: 4 }} />Agregar cálculo
                </button>
              </div>
            </div>
          )}

          {config.tabla && (
            <div style={{ marginBottom: 14 }}>
              <label className="filter-label">Filtros</label>
              {config.filtros.map((f, i) => (
                <div key={i} className="reporteria-fila-control" style={{ marginTop: 6 }}>
                  <DropdownSelect
                    value={f.campo}
                    onChange={(v) => setConfig((cfg) => ({ ...cfg, filtros: cfg.filtros.map((x, j) => (j === i ? { ...x, campo: v } : x)) }))}
                    options={opcionesColumna}
                    placeholder="Campo…"
                    minWidth={210}
                    style={{ width: 210, height: 34 }}
                  />
                  <DropdownSelect
                    value={f.operador}
                    onChange={(v) => setConfig((cfg) => ({ ...cfg, filtros: cfg.filtros.map((x, j) => (j === i ? { ...x, operador: v } : x)) }))}
                    options={OPERADORES}
                    minWidth={170}
                    style={{ width: 165, height: 34 }}
                  />
                  {!SIN_VALOR.has(f.operador) && (
                    <input
                      className="input" placeholder="Valor…" style={{ width: 190, height: 34 }}
                      value={f.valor || ""}
                      onChange={(e) => setConfig((cfg) => ({ ...cfg, filtros: cfg.filtros.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)) }))}
                    />
                  )}
                  <button type="button" className="btn btn-sm btn-secondary" title="Quitar filtro" onClick={() => setConfig((cfg) => ({ ...cfg, filtros: cfg.filtros.filter((_, j) => j !== i) }))}>
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button
                type="button" className="btn btn-sm btn-secondary" style={{ marginTop: 8 }}
                onClick={() => setConfig((cfg) => ({ ...cfg, filtros: [...cfg.filtros, { campo: "", operador: "igual", valor: "" }] }))}
              >
                <Plus size={13} style={{ marginRight: 4 }} />Agregar filtro
              </button>
            </div>
          )}

          {config.tabla && (
            <div className="reporteria-fila-control" style={{ marginBottom: 16 }}>
              <div className="reporteria-campo">
                <label className="filter-label">Ordenar por</label>
                <DropdownSelect
                  value={config.ordenarPor}
                  onChange={(v) => setConfig((c) => ({ ...c, ordenarPor: v }))}
                  options={[
                    { value: "", label: "Sin orden" },
                    ...(modo === "resumen"
                      ? [
                          ...config.agrupar.map((c) => ({ value: c, label: etiquetas[c] || c })),
                          ...config.agregaciones.map((a) => { const alias = `${a.funcion}_${a.campo === "*" ? "filas" : a.campo}`; return { value: alias, label: etiquetas[alias] || alias }; }),
                        ]
                      : opcionesColumna),
                  ]}
                  minWidth={220}
                  style={{ width: 230, height: 34 }}
                />
              </div>
              <div className="reporteria-campo">
                <label className="filter-label">Dirección</label>
                <div className="segmentado">
                  <button type="button" className={config.ordenDesc ? "activo" : ""} onClick={() => setConfig((c) => ({ ...c, ordenDesc: true }))}>Mayor a menor</button>
                  <button type="button" className={!config.ordenDesc ? "activo" : ""} onClick={() => setConfig((c) => ({ ...c, ordenDesc: false }))}>Menor a mayor</button>
                </div>
              </div>
            </div>
          )}

          <button type="button" className="btn btn-primary" disabled={ejecutando || !config.tabla} onClick={() => { setReporteAbierto((r) => (r && !r.id ? null : r)); ejecutarConstructor(); }}>
            <Play size={14} style={{ marginRight: 5 }} />{ejecutando ? "Ejecutando…" : "Ejecutar reporte"}
          </button>
          {resultado?.sql && (
            <span style={{ marginLeft: 12, fontSize: 11.5, color: "var(--text-muted)", fontFamily: "Consolas, monospace" }}>
              {resultado.sql.length > 110 ? resultado.sql.slice(0, 110) + "…" : resultado.sql}
            </span>
          )}
        </div>
      )}

      {/* ── SQL ───────────────────────────────────────────────────────── */}
      {tab === "sql" && (
        <div className="reporteria-sql-grid">
          <div className="surface" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13.5 }}>Consulta de solo lectura</strong>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Solo SELECT · tope 10.000 filas · 15 s máx. · Ctrl+Enter ejecuta</span>
            </div>
            <textarea
              ref={editorRef}
              className="reporteria-editor"
              placeholder={"select estado, count(*) as cotizaciones\nfrom licitaciones\ngroup by estado\norder by cotizaciones desc"}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); ejecutarSQL(); } }}
              spellCheck={false}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
              <button type="button" className="btn btn-primary" disabled={ejecutando} onClick={() => ejecutarSQL()}>
                <Play size={14} style={{ marginRight: 5 }} />{ejecutando ? "Ejecutando…" : "Ejecutar"}
              </button>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Ejemplos:</span>
              {CONSULTAS_EJEMPLO.map((c) => (
                <button key={c.nombre} type="button" className="btn btn-sm btn-secondary" onClick={() => { setSql(c.sql); setResultado(null); }}>
                  {c.nombre}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Search size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input className="input" style={{ height: 32, fontSize: 12.5 }} placeholder="Buscar tabla…" value={busquedaCat} onChange={(e) => setBusquedaCat(e.target.value)} />
            </div>
            <div className="reporteria-catalogo">
              {!catalogo ? (
                <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-muted)" }}>Cargando catálogo…</div>
              ) : tablasFiltradas.map((t) => {
                const abierta = tablaAbierta === t.tabla;
                const recomendada = !!t.descripcion;
                return (
                  <div key={t.tabla} className="reporteria-catalogo-tabla">
                    <button type="button" className="reporteria-catalogo-cab" onClick={() => setTablaAbierta(abierta ? "" : t.tabla)}>
                      {abierta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span style={{ fontFamily: "Consolas, monospace", fontSize: 12 }}>{t.tabla}</span>
                      {recomendada && <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, color: "var(--primary-dark)", background: "var(--primary-light)", borderRadius: 999, padding: "1px 7px", letterSpacing: ".04em" }}>NEGOCIO</span>}
                    </button>
                    {abierta && (
                      <>
                        {t.descripcion && <div style={{ fontSize: 11.5, color: "var(--text-muted)", padding: "0 12px 6px 32px", lineHeight: 1.4 }}>{t.descripcion}</div>}
                        <div className="reporteria-catalogo-cols">
                          {t.columnas.map((c) => (
                            <button key={c.nombre} type="button" className="reporteria-chip" title={`${c.tipo} · clic para insertar`} onClick={() => insertarEnEditor(c.nombre)}>
                              {c.nombre}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Resultado compartido ──────────────────────────────────────── */}
      {(tab === "constructor" || tab === "sql") && resultado && (
        <ResultadoReporte
          key={`${resultado.ms}-${resultado.total}-${resultado.columnas.join(",")}`}
          resultado={resultado}
          grafico={grafico}
          setGrafico={setGrafico}
          nombreArchivo={reporteAbierto?.nombre || (tab === "sql" ? "consulta_sql" : origenNombre)}
          etiquetas={tab === "sql" ? {} : etiquetas}
          onGuardar={() => setModalGuardar({
            tipo: tab === "sql" ? "sql" : "constructor",
            id: reporteAbierto?.tipo === (tab === "sql" ? "sql" : "constructor") ? reporteAbierto?.id : undefined,
            nombre: reporteAbierto?.nombre || "",
            descripcion: reporteAbierto?.descripcion || "",
          })}
        />
      )}

      {/* ── Modal guardar ─────────────────────────────────────────────── */}
      {modalGuardar && (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) setModalGuardar(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: 440, maxWidth: "100%", background: "var(--surface)", borderRadius: 14, padding: 22, border: "1px solid var(--border)" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: 16 }}>
              {modalGuardar.id ? "Actualizar reporte" : "Guardar reporte"}
            </h3>
            <label className="filter-label">Nombre</label>
            <input
              className="input" style={{ marginBottom: 12 }} autoFocus
              placeholder="Ej: Ventas adjudicadas por mes"
              value={modalGuardar.nombre}
              onChange={(e) => setModalGuardar((m) => ({ ...m, nombre: e.target.value }))}
            />
            <label className="filter-label">Descripción (opcional)</label>
            <textarea
              className="input" rows={2} style={{ resize: "vertical", marginBottom: 14 }}
              placeholder="Para qué sirve este reporte…"
              value={modalGuardar.descripcion}
              onChange={(e) => setModalGuardar((m) => ({ ...m, descripcion: e.target.value }))}
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
              Se guarda {modalGuardar.tipo === "sql" ? "la consulta SQL" : "la configuración del constructor"} junto con la vista de gráfico elegida.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalGuardar(null)}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={guardarReporte}>
                <Save size={14} style={{ marginRight: 5 }} />{modalGuardar.id ? "Actualizar" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
