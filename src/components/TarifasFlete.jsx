import { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Pencil, Trash2, Plus, X, FileSpreadsheet } from "lucide-react";
import { api } from "../lib/api";
import useAuth from "../hooks/useAuth";

/* ============================================================
   Administración de tarifas de flete (Starken / Blue Express /
   Despacho interno)
   ─ Ver, filtrar, editar, agregar y eliminar filas del tarifario.
   ─ Despacho interno: sin tarifario por filas; solo configuración
     (dirección de origen con autocompletado Google y valor por km).
     Flete = km bodega→cliente (SOLO IDA) × valor por km.
   ─ Reajuste (%): por courier, ajusta porcentualmente los valores del
     tarifario al calcular el flete (no modifica la tabla).
   ─ Carga masiva: lee el archivo del courier y REEMPLAZA la tabla:
     · Starken: mismo formato del archivo oficial (CSV ";" o Excel):
       Región; Localidad; 14 tramos; $/kg 100-499; $/kg 499-1000; Fijo.
       Valores NETOS.
     · Blue: Región + XS, S, M, L, XL. La tabla guarda valores NETOS;
       el archivo oficial del courier viene bruto (IVA incluido) y se
       convierte (÷1,19) al importar.
============================================================ */

const CAMPOS_STARKEN = [
  ["t_0_05", "0–0,5"], ["t_05_15", "0,5–1,5"], ["t_15_3", "1,5–3"], ["t_3_6", "3–6"],
  ["t_6_10", "6–10"], ["t_10_20", "10–20"], ["t_20_30", "20–30"], ["t_30_40", "30–40"],
  ["t_40_50", "40–50"], ["t_50_60", "50–60"], ["t_60_70", "60–70"], ["t_70_80", "70–80"],
  ["t_80_90", "80–90"], ["t_90_100", "90–100"], ["kg_100_499", "$/kg 100–499"],
  ["kg_499_1000", "$/kg 499–1000"], ["fijo_adicional", "Fijo adic."],
];

const CAMPOS_BLUE = [
  ["xs", "XS (0–0,5)"], ["s", "S (0,5–3)"], ["m", "M (3–6)"], ["l", "L (6–16)"], ["xl", "XL (16–25)"],
];

const MAX_FILAS_VISTA = 150;

const fmtNum = (v) => Number(v || 0).toLocaleString("es-CL");

function limpiarTexto(s) {
  return String(s || "").replace(/^\uFEFF/, "").replace(/[‘’´`]/g, "'").trim();
}

function parseMonto(v) {
  const d = String(v ?? "").replace(/[^\d]/g, "");
  return d ? Number(d) : 0;
}

// Une variantes de la misma región (MAULE vs Maule) en una forma canónica.
function hacerCanonRegion() {
  const canon = new Map();
  return (raw) => {
    const t = limpiarTexto(raw);
    const key = t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!key) return "";
    if (!canon.has(key)) canon.set(key, t);
    return canon.get(key);
  };
}

export default function TarifasFlete({ onToast }) {
  const { rol } = useAuth();
  const esAdmin = ["admin", "administrador"].includes(String(rol || "").trim().toLowerCase());
  const [empresa, setEmpresa] = useState("Starken");
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [regionFiltro, setRegionFiltro] = useState("");
  const [editando, setEditando] = useState(null); // fila existente o {} para nueva
  const [uploadOpen, setUploadOpen] = useState(false);

  const esStarken = empresa === "Starken";
  const esInterno = empresa === "Interno";
  const campos = esStarken ? CAMPOS_STARKEN : CAMPOS_BLUE;

  // Config del despacho interno: dirección de origen (bodega) + valor por km.
  // El flete interno = km de ida × valor_km (sin tabla de tramos).
  const [configInterno, setConfigInterno] = useState(null);
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [sugerencias, setSugerencias] = useState([]);
  const omitirSugerenciasRef = useRef(false);

  // Reajuste porcentual del courier activo (Starken / Blue).
  const [reajuste, setReajuste] = useState("");
  const [guardandoReajuste, setGuardandoReajuste] = useState(false);

  useEffect(() => {
    // El endpoint del reajuste es admin-only: para el resto ni se consulta
    // (devolvería 403 y ensuciaría el log de errores del monitoreo).
    if (esInterno || !esAdmin) return;
    let activo = true;
    setReajuste("");
    api.get(`/fletes/reajuste?empresa=${encodeURIComponent(empresa)}`)
      .then((d) => activo && setReajuste(String(d?.porcentaje ?? 0)))
      .catch(() => activo && setReajuste("0"));
    return () => { activo = false; };
  }, [empresa, esInterno, esAdmin]);

  async function guardarReajuste() {
    const pct = Number(String(reajuste).replace(",", "."));
    if (!Number.isFinite(pct)) {
      onToast?.({ type: "error", message: "El reajuste debe ser un número (ej: 10 o -5)." });
      return;
    }
    setGuardandoReajuste(true);
    try {
      const data = await api.put("/fletes/reajuste", { empresa, porcentaje: pct });
      setReajuste(String(data?.porcentaje ?? pct));
      onToast?.({ type: "success", message: `Reajuste de ${empresa === "Blue" ? "Blue Express" : "Starken"} guardado (${pct}%).` });
    } catch (e) {
      onToast?.({ type: "error", message: e?.message || "No se pudo guardar el reajuste." });
    } finally {
      setGuardandoReajuste(false);
    }
  }

  useEffect(() => {
    if (!esInterno) return;
    let activo = true;
    api.get("/fletes/interno/config")
      .then((data) => activo && setConfigInterno(data || {}))
      .catch((e) => {
        if (!activo) return;
        setConfigInterno({});
        onToast?.({ type: "error", message: e?.message || "No se pudo cargar la configuración de despacho interno." });
      });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esInterno]);

  // Autocompletar dirección de origen (Places vía backend, con debounce).
  useEffect(() => {
    if (!esInterno) return;
    if (omitirSugerenciasRef.current) {
      omitirSugerenciasRef.current = false;
      return;
    }
    const q = String(configInterno?.direccion_origen || "").trim();
    if (q.length < 4) {
      setSugerencias([]);
      return;
    }
    const t = setTimeout(() => {
      api.get(`/fletes/interno/direcciones?q=${encodeURIComponent(q)}`)
        .then((d) => setSugerencias(Array.isArray(d) ? d : []))
        .catch(() => setSugerencias([]));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configInterno?.direccion_origen, esInterno]);

  async function guardarConfigInterno() {
    setGuardandoConfig(true);
    try {
      const data = await api.put("/fletes/interno/config", {
        direccion_origen: configInterno?.direccion_origen || "",
        valor_km: Number(String(configInterno?.valor_km ?? 0).replace(/[^\d]/g, "")) || 0,
      });
      setConfigInterno(data || {});
      setSugerencias([]);
      onToast?.({ type: "success", message: "Configuración de despacho interno guardada." });
    } catch (e) {
      onToast?.({ type: "error", message: e?.message || "No se pudo guardar la configuración." });
    } finally {
      setGuardandoConfig(false);
    }
  }

  async function cargar(emp = empresa) {
    // El despacho interno no tiene tarifario por filas; solo configuración.
    if (emp === "Interno") {
      setFilas([]);
      setCargando(false);
      return;
    }
    setCargando(true);
    try {
      const data = await api.get(`/fletes/tarifas?empresa=${encodeURIComponent(emp)}`);
      setFilas(Array.isArray(data) ? data : []);
    } catch (e) {
      onToast?.({ type: "error", message: e?.message || "No se pudieron cargar las tarifas. ¿Está aplicada la migración 20260804_fletes_tarifas?" });
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    setBusqueda("");
    setRegionFiltro("");
    cargar(empresa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa]);

  const regiones = useMemo(() => [...new Set(filas.map((f) => f.region))], [filas]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (regionFiltro && f.region !== regionFiltro) return false;
      if (!q) return true;
      return (
        String(f.region || "").toLowerCase().includes(q) ||
        String(f.localidad || "").toLowerCase().includes(q)
      );
    });
  }, [filas, busqueda, regionFiltro]);

  async function guardarFila(fila) {
    try {
      if (fila.id) {
        await api.put(`/fletes/tarifas/${fila.id}?empresa=${encodeURIComponent(empresa)}`, fila);
        onToast?.({ type: "success", message: "Tarifa actualizada." });
      } else {
        await api.post("/fletes/tarifas", { empresa, ...fila });
        onToast?.({ type: "success", message: "Tarifa agregada." });
      }
      setEditando(null);
      cargar();
    } catch (e) {
      onToast?.({ type: "error", message: e?.message || "No se pudo guardar la tarifa." });
    }
  }

  async function eliminarFila(fila) {
    const nombre = esStarken ? `${fila.localidad} (${fila.region})` : fila.region;
    if (!window.confirm(`¿Eliminar la tarifa de ${nombre}?`)) return;
    try {
      await api.delete(`/fletes/tarifas/${fila.id}?empresa=${encodeURIComponent(empresa)}`);
      setFilas((prev) => prev.filter((f) => f.id !== fila.id));
      onToast?.({ type: "success", message: "Tarifa eliminada." });
    } catch (e) {
      onToast?.({ type: "error", message: e?.message || "No se pudo eliminar." });
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {/* Barra: segmento de courier + filtros + acciones */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: "1px solid var(--border)" }}>
          {["Starken", "Blue", "Interno"].map((emp) => (
            <button key={emp} type="button" onClick={() => setEmpresa(emp)}
              style={{
                padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", border: "none",
                background: empresa === emp ? "var(--primary)" : "var(--surface)",
                color: empresa === emp ? "#fff" : "var(--text-muted)",
              }}>
              {emp === "Blue" ? "Blue Express" : emp === "Interno" ? "Despacho interno" : "Starken"}
            </button>
          ))}
        </div>

        {esStarken && (
          <select className="input" style={{ height: 38, width: 170 }} value={regionFiltro} onChange={(e) => setRegionFiltro(e.target.value)}>
            <option value="">Todas las regiones</option>
            {regiones.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
        {!esInterno && (
          <input
            className="input" style={{ height: 38, flex: 1, minWidth: 180 }}
            placeholder={esStarken ? "Buscar región o localidad…" : "Buscar región…"}
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          />
        )}

        {!esInterno && (
          <>
            {/* El reajuste altera el precio de TODOS los fletes que se cotizan,
                así que es exclusivo de admin. El backend ya lo exige
                (AdminGuard en PUT /fletes/reajuste); esto evita además mostrar
                un control que no se va a poder usar. */}
            {esAdmin && (
            <div
              title="Ajusta porcentualmente los valores del tarifario al calcular (ej: 10 = +10%, -5 = -5%). No modifica la tabla."
              style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: 9, padding: "4px 8px", background: "var(--surface)" }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Reajuste %</span>
              <input
                className="input"
                style={{ height: 30, width: 70, textAlign: "right" }}
                inputMode="decimal"
                value={reajuste}
                onChange={(e) => setReajuste(e.target.value.replace(/[^\d.,-]/g, ""))}
                placeholder="0"
              />
              <button className="btn btn-sm btn-secondary" onClick={guardarReajuste} disabled={guardandoReajuste} style={{ height: 30 }}>
                {guardandoReajuste ? "…" : "Guardar"}
              </button>
            </div>
            )}
            <button className="btn btn-ghost" onClick={() => setEditando({})} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Plus size={14} /> Agregar
            </button>
            <button className="btn btn-primary" onClick={() => setUploadOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Upload size={14} /> Carga Masiva
            </button>
          </>
        )}
      </div>

      {/* Despacho interno: solo configuración. Flete = km de ida × valor/km. */}
      {esInterno && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: "12px 14px", marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 2, minWidth: 260, position: "relative" }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Dirección de origen (bodega)
            </label>
            <input
              className="input"
              value={configInterno?.direccion_origen || ""}
              onChange={(e) => setConfigInterno((p) => ({ ...(p || {}), direccion_origen: e.target.value }))}
              onBlur={() => setTimeout(() => setSugerencias([]), 200)}
              placeholder="Ej: Av. Portales 123, San Bernardo, Región Metropolitana"
              autoComplete="off"
            />
            {sugerencias.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, marginTop: 2, boxShadow: "0 6px 18px rgba(15,23,42,.12)", overflow: "hidden" }}>
                {sugerencias.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      omitirSugerenciasRef.current = true;
                      setConfigInterno((p) => ({ ...(p || {}), direccion_origen: s }));
                      setSugerencias([]);
                    }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", fontSize: 12.5, background: "transparent", border: "none", cursor: "pointer" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ width: 170 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Valor por km (neto)
            </label>
            <input
              className="input"
              inputMode="numeric"
              value={configInterno?.valor_km != null && configInterno.valor_km !== "" ? Number(String(configInterno.valor_km).replace(/[^\d]/g, "") || 0).toLocaleString("es-CL") : ""}
              onChange={(e) => setConfigInterno((p) => ({ ...(p || {}), valor_km: e.target.value.replace(/[^\d]/g, "") }))}
              placeholder="Ej: 500"
            />
          </div>
          <button className="btn btn-primary" onClick={guardarConfigInterno} disabled={guardandoConfig || configInterno == null} style={{ height: 40 }}>
            {guardandoConfig ? "Guardando…" : "Guardar configuración"}
          </button>
          <div style={{ flexBasis: "100%", fontSize: 12, color: "var(--text-muted)" }}>
            Flete interno = km bodega → cliente (<b>solo ida</b>) × valor por km. La distancia se calcula con la dirección de la cotización (Google Maps) y siempre se puede digitar a mano. Hacia comunas de la provincia de Santiago el despacho interno es <b>gratis</b>.
            {" "}{configInterno?.origen_lat != null
              ? `Origen geocodificado ✓ (${Number(configInterno.origen_lat).toFixed(5)}, ${Number(configInterno.origen_lng).toFixed(5)}).`
              : "La dirección se valida en Google Maps al guardar (o en el primer cálculo si aún no hay API key)."}
          </div>
        </div>
      )}

      {!esInterno && (
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        {esStarken
          ? "Valores NETOS por tramo de kg. Los tramos sobre 100 kg son tarifa POR KILO + fijo adicional."
          : "Valores NETOS por tramo de peso; el archivo oficial de Blue viene bruto y la carga masiva lo convierte a neto."}
        {" "}· {filtradas.length.toLocaleString("es-CL")} fila{filtradas.length === 1 ? "" : "s"}
        {filtradas.length > MAX_FILAS_VISTA ? ` (mostrando ${MAX_FILAS_VISTA})` : ""}
      </div>
      )}

      {/* Tabla (solo couriers; el despacho interno no tiene filas) */}
      {!esInterno && (
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", background: "var(--surface)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, whiteSpace: "nowrap" }}>
          <thead>
            <tr style={{ background: "var(--bg)", color: "var(--text-muted)", textAlign: "right" }}>
              <th style={{ padding: "7px 10px", textAlign: "left" }}>Región</th>
              {esStarken && <th style={{ padding: "7px 10px", textAlign: "left" }}>Localidad</th>}
              {campos.map(([k, label]) => (
                <th key={k} style={{ padding: "7px 8px" }}>{label}</th>
              ))}
              <th style={{ padding: "7px 10px" }} />
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={campos.length + 3} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>Cargando tarifas…</td></tr>
            ) : filtradas.length === 0 ? (
              <tr><td colSpan={campos.length + 3} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                Sin tarifas. Usa "Carga Masiva" para importar el tarifario del courier.
              </td></tr>
            ) : (
              filtradas.slice(0, MAX_FILAS_VISTA).map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "5px 10px", fontWeight: 600 }}>{f.region}</td>
                  {esStarken && <td style={{ padding: "5px 10px" }}>{f.localidad}</td>}
                  {campos.map(([k]) => (
                    <td key={k} style={{ padding: "5px 8px", textAlign: "right" }}>{fmtNum(f[k])}</td>
                  ))}
                  <td style={{ padding: "5px 10px", textAlign: "right" }}>
                    <button className="btn btn-sm btn-ghost" title="Editar" style={{ padding: 4 }} onClick={() => setEditando(f)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn btn-sm btn-ghost" title="Eliminar" style={{ padding: 4, color: "var(--danger)" }} onClick={() => eliminarFila(f)}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {editando != null && (
        <ModalEditarTarifa
          empresa={empresa}
          fila={editando}
          campos={campos}
          onClose={() => setEditando(null)}
          onGuardar={guardarFila}
        />
      )}

      {uploadOpen && (
        <ModalCargaTarifas
          empresa={empresa}
          onClose={() => setUploadOpen(false)}
          onToast={onToast}
          onDone={() => { setUploadOpen(false); cargar(); }}
        />
      )}
    </div>
  );
}

/* ── Modal: editar / agregar una fila ─────────────────────────── */
function ModalEditarTarifa({ empresa, fila, campos, onClose, onGuardar }) {
  const esStarken = empresa === "Starken";
  const [form, setForm] = useState(() => {
    const base = { region: fila.region || "", ...(esStarken ? { localidad: fila.localidad || "" } : {}) };
    campos.forEach(([k]) => { base[k] = fila[k] ?? 0; });
    if (fila.id) base.id = fila.id;
    return base;
  });
  const [guardando, setGuardando] = useState(false);

  function set(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function guardar() {
    if (!String(form.region).trim() || (esStarken && !String(form.localidad).trim())) return;
    setGuardando(true);
    await onGuardar({
      ...form,
      ...Object.fromEntries(campos.map(([k]) => [k, parseMonto(form[k])])),
    });
    setGuardando(false);
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: 640, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            {fila.id ? "Editar tarifa" : "Agregar tarifa"} · {empresa === "Blue" ? "Blue Express" : "Starken"}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 6 }}><X size={17} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: esStarken ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Región *</label>
            <input className="input" value={form.region} onChange={(e) => set("region", e.target.value)} />
          </div>
          {esStarken && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>Localidad *</label>
              <input className="input" value={form.localidad} onChange={(e) => set("localidad", e.target.value.toUpperCase())} />
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
          {campos.map(([k, label]) => (
            <div key={k}>
              <label style={{ fontSize: 11.5, fontWeight: 600, display: "block", marginBottom: 4, color: "var(--text-muted)" }}>{label}</label>
              <input className="input" style={{ height: 36 }} inputMode="numeric" value={form[k]}
                onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar}
            disabled={guardando || !String(form.region).trim() || (esStarken && !String(form.localidad).trim())}>
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Modal: carga masiva (reemplaza el tarifario completo) ────── */
function ModalCargaTarifas({ empresa, onClose, onToast, onDone }) {
  const esStarken = empresa === "Starken";
  const [archivo, setArchivo] = useState(null);
  const [filas, setFilas] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Blue: el archivo se sube tal cual (bruto, IVA incluido); el backend
  // convierte a neto (÷1,19) antes de guardar en la tabla.
  const aNeto = (v) => Math.round((Number(v) || 0) / 1.19);

  async function manejarArchivo(file) {
    if (!file) return;
    setArchivo(file);
    setParsing(true);
    setFilas([]);
    try {
      const nombre = file.name.toLowerCase();
      let matriz;
      if (nombre.endsWith(".csv")) {
        const texto = await file.text();
        const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
        matriz = lineas.map((l) => l.split(";"));
        // Si el CSV no usa ";", probar con coma.
        if (matriz[0] && matriz[0].length < 3) matriz = lineas.map((l) => l.split(","));
      } else {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      }

      // El encabezado es la primera fila cuyo primer texto contiene "region".
      const idxHeader = matriz.findIndex((f) =>
        String(f?.[0] || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("region"),
      );
      const datos = matriz.slice(idxHeader + 1);
      const canonRegion = hacerCanonRegion();

      let parseadas;
      if (esStarken) {
        parseadas = datos.map((f) => {
          const region = canonRegion(f?.[0]);
          const localidad = limpiarTexto(f?.[1]).toUpperCase();
          if (!region || !localidad) return null;
          const fila = { region, localidad };
          CAMPOS_STARKEN.forEach(([k], i) => { fila[k] = parseMonto(f?.[i + 2]); });
          return fila;
        }).filter(Boolean);
      } else {
        parseadas = datos.map((f) => {
          const region = canonRegion(f?.[0]);
          if (!region) return null;
          const fila = { region };
          CAMPOS_BLUE.forEach(([k], i) => { fila[k] = parseMonto(f?.[i + 1]); });
          return fila;
        }).filter(Boolean);
      }
      setFilas(parseadas);
      if (parseadas.length === 0) {
        onToast?.({ type: "error", message: "No se encontraron filas válidas en el archivo. Revisa el formato." });
      }
    } catch (e) {
      console.error(e);
      onToast?.({ type: "error", message: "No se pudo leer el archivo. ¿Es un .csv, .xlsx o .xlsm válido?" });
    } finally {
      setParsing(false);
    }
  }

  async function importar() {
    if (filas.length === 0) return;
    setEnviando(true);
    try {
      const res = await api.post("/fletes/tarifas/bulk", { empresa, rows: filas });
      onToast?.({ type: "success", message: `Tarifario ${empresa === "Blue" ? "Blue Express" : "Starken"} reemplazado: ${res.insertadas} filas cargadas.` });
      onDone?.();
    } catch (e) {
      onToast?.({ type: "error", message: e?.message || "Error al importar el tarifario." });
    } finally {
      setEnviando(false);
    }
  }

  const regionesArchivo = new Set(filas.map((f) => f.region)).size;

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !enviando) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: 560, maxWidth: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 22 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <FileSpreadsheet size={17} /> Carga Masiva · {empresa === "Blue" ? "Blue Express" : "Starken"}
          </h3>
          <button className="btn btn-ghost" onClick={onClose} disabled={enviando} style={{ padding: 6 }}><X size={17} /></button>
        </div>

        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 14px", lineHeight: 1.5 }}>
          {esStarken
            ? "Sube el tarifario oficial de Starken (.csv, .xlsx o .xlsm): Región; Localidad; tramos de peso; $/kg 100–499; $/kg 499–1000; Fijo Adicional. Valores netos."
            : "Sube la tabla de Blue Express (.csv o .xlsx) con sus valores brutos (IVA incluido): Región + XS, S, M, L, XL. Al importar se convierten automáticamente y la tabla queda en neto (÷1,19)."}
          {" "}<b>La carga reemplaza por completo el tarifario actual.</b>
        </p>

        <input
          type="file"
          accept=".csv,.xlsx,.xlsm,.xls"
          onChange={(e) => manejarArchivo(e.target.files?.[0])}
          disabled={enviando}
          style={{ marginBottom: 12, fontSize: 13 }}
        />

        {parsing && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Leyendo archivo…</div>}

        {!parsing && archivo && filas.length > 0 && (
          <div style={{ fontSize: 13, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", marginBottom: 4 }}>
            <b>{filas.length.toLocaleString("es-CL")}</b> fila{filas.length === 1 ? "" : "s"} detectada{filas.length === 1 ? "" : "s"} en{" "}
            <b>{regionesArchivo}</b> región{regionesArchivo === 1 ? "" : "es"}.
            <div style={{ color: "var(--text-muted)", marginTop: 3, fontSize: 12 }}>
              {esStarken
                ? <>Ejemplo: {filas[0].region} · {filas[0].localidad} → {fmtNum(filas[0].t_0_05)} (primer tramo)</>
                : <>Ejemplo: {filas[0].region} → bruto {fmtNum(filas[0].xs)} → se guardará neto {fmtNum(aNeto(filas[0].xs))} (primer tramo)</>}
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={enviando}>Cancelar</button>
          <button className="btn btn-primary" onClick={importar} disabled={enviando || filas.length === 0}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={14} /> {enviando ? "Importando…" : `Reemplazar tarifario (${filas.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
