import { useEffect, useState } from "react";
import { Truck, Calculator } from "lucide-react";
import { api } from "../lib/api";

/* ============================================================
   Calculadora de flete Starken / Blue Express / Despacho interno
   ─ Starken: peso facturable = max(peso físico, cm³/4000); tarifa
     NETA por región + localidad + tramo (tabla fletes_tarifas_starken).
   ─ Blue: solo peso físico; tarifa NETA por región y tramo
     (tabla fletes_tarifas_blue, ya convertida al importar).
   ─ Interno: flete NETO = km bodega→cliente (ida) × 2 × valor por km
     (fletes_interno_config). Los km se obtienen por Google Maps desde
     la dirección del cliente (POST /fletes/interno/distancia) y son
     editables a mano; el ×2 (ida y vuelta) lo aplica el backend.
   El cálculo corre en el backend (POST /fletes/tarifas/calcular); al
   obtener el valor se aplica al Flete Estimado vía onAplicar(neto).
   La región/localidad se precargan desde la dirección del cliente
   (regionCliente/comunaCliente); cada tarifario nombra las regiones
   distinto (Starken "RM"/"Arica", Blue "Metropolitana de Santiago"),
   por eso el match es por forma canónica y no por igualdad exacta.
============================================================ */
const normTexto = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function canonRegion(s) {
  const n = normTexto(s);
  if (!n) return "";
  if (n === "rm" || n.includes("metropolitana") || n === "santiago") return "rm";
  if (n.includes("higgins")) return "ohiggins";
  if (n.includes("arica")) return "arica";
  if (n.includes("magallanes")) return "magallanes";
  if (n.includes("aysen")) return "aysen";
  if (n.includes("araucania")) return "araucania";
  if (n.includes("nuble")) return "nuble";
  if (n.includes("biobio") || n.includes("bio bio")) return "biobio";
  if (n.includes("tarapaca")) return "tarapaca";
  return n;
}

export default function CalculadoraFlete({
  pesoTotal,
  volumenTotal,
  onAplicar,
  deshabilitado = false,
  regionCliente = "",
  comunaCliente = "",
  direccionCliente = "",
}) {
  const [empresa, setEmpresa] = useState("");
  const [regiones, setRegiones] = useState([]);
  const [region, setRegion] = useState("");
  const [localidades, setLocalidades] = useState([]);
  const [localidad, setLocalidad] = useState("");
  const [calculando, setCalculando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState("");
  // Despacho interno: km entre bodega y cliente. Se obtienen por Google Maps
  // (backend) desde la dirección del cliente, pero siempre son editables.
  const [km, setKm] = useState("");
  const [kmDestino, setKmDestino] = useState("");
  const [calculandoKm, setCalculandoKm] = useState(false);

  // Regiones según courier (cada tabla tiene su propio catálogo).
  useEffect(() => {
    setRegion("");
    setLocalidad("");
    setLocalidades([]);
    setResultado(null);
    setError("");
    setKm("");
    setKmDestino("");
    if (!empresa || empresa === "Interno") {
      setRegiones([]);
      return;
    }
    let activo = true;
    api
      .get(`/fletes/tarifas/regiones?empresa=${encodeURIComponent(empresa)}`)
      .then((data) => activo && setRegiones(Array.isArray(data) ? data : []))
      .catch(() => activo && setRegiones([]));
    return () => { activo = false; };
  }, [empresa]);

  // Localidades (solo Starken) según región.
  useEffect(() => {
    setLocalidad("");
    setLocalidades([]);
    setResultado(null);
    if (empresa !== "Starken" || !region) return;
    let activo = true;
    api
      .get(`/fletes/tarifas/localidades?region=${encodeURIComponent(region)}`)
      .then((data) => activo && setLocalidades(Array.isArray(data) ? data : []))
      .catch(() => activo && setLocalidades([]));
    return () => { activo = false; };
  }, [empresa, region]);

  // Preselección automática de la región del cliente (solo si aún no hay una elegida).
  useEffect(() => {
    if (!regiones.length || !regionCliente) return;
    const objetivo = canonRegion(regionCliente);
    const match = regiones.find((r) => canonRegion(r) === objetivo);
    if (match) setRegion((prev) => prev || match);
  }, [regiones, regionCliente]);

  // Preselección de la localidad Starken con la comuna del cliente.
  useEffect(() => {
    if (!localidades.length || !comunaCliente) return;
    const objetivo = normTexto(comunaCliente);
    let match = localidades.find((l) => normTexto(l) === objetivo);
    if (!match) {
      // p. ej. comuna "Santiago" vs localidad "SANTIAGO CENTRO": solo si hay un único candidato.
      const candidatos = localidades.filter((l) => normTexto(l).startsWith(objetivo));
      if (candidatos.length === 1) match = candidatos[0];
    }
    if (match) setLocalidad((prev) => prev || match);
  }, [localidades, comunaCliente]);

  const comunaSinMatch =
    empresa === "Starken" &&
    !!region &&
    localidades.length > 0 &&
    !!comunaCliente &&
    !localidad;

  // Despacho interno: pide al backend los km por carretera (Google Maps)
  // entre la bodega configurada y la dirección del cliente.
  async function obtenerDistancia() {
    setError("");
    setResultado(null);
    setCalculandoKm(true);
    try {
      const res = await api.post("/fletes/interno/distancia", {
        direccion: direccionCliente,
        comuna: comunaCliente,
        region: regionCliente,
      });
      setKm(String(res?.km ?? ""));
      setKmDestino(res?.destino || "");
    } catch (e) {
      setError(e?.message || "No se pudo calcular la distancia; digita los km manualmente.");
    } finally {
      setCalculandoKm(false);
    }
  }

  async function calcular() {
    setError("");
    setResultado(null);
    if (empresa === "Interno") {
      if (!(Number(km) > 0)) {
        setError("Indica los kilómetros: usa \"Obtener distancia\" o digítalos.");
        return;
      }
    } else if (!empresa || !region || (empresa === "Starken" && !localidad)) {
      setError("Selecciona courier, región" + (empresa === "Starken" ? " y localidad." : "."));
      return;
    }
    setCalculando(true);
    try {
      const res = await api.post("/fletes/tarifas/calcular", {
        empresa,
        region: empresa === "Interno" ? undefined : region,
        localidad: empresa === "Interno" ? undefined : (localidad || undefined),
        km: empresa === "Interno" ? Number(km) : undefined,
        peso: Number(pesoTotal) || 0,
        volumen_cm3: Number(volumenTotal) || 0,
      });
      setResultado(res);
      onAplicar?.(Number(res?.neto) || 0, res);
    } catch (e) {
      setError(e?.message || "No se pudo calcular el flete.");
    } finally {
      setCalculando(false);
    }
  }

  const selectStyle = { height: 40 };

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        background: "var(--bg, #f8fafc)",
        marginTop: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <Truck size={15} style={{ color: "var(--primary)" }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>Calcular flete por courier</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          · Peso {Number(pesoTotal || 0).toFixed(2)} kg · Volumen {Number(volumenTotal || 0).toFixed(0)} cm³
          {(regionCliente || comunaCliente) && (
            <> · Destino cliente: {[regionCliente, comunaCliente].filter(Boolean).join(" / ")}</>
          )}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select
          className="input"
          style={{ ...selectStyle, width: 150 }}
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          disabled={deshabilitado}
        >
          <option value="">Courier…</option>
          <option value="Starken">Starken</option>
          <option value="Blue">Blue Express</option>
          <option value="Interno">Despacho interno</option>
        </select>

        {empresa !== "Interno" && (
          <select
            className="input"
            style={{ ...selectStyle, minWidth: 190, flex: 1 }}
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={deshabilitado || !empresa}
          >
            <option value="">Región destino…</option>
            {regiones.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}

        {empresa === "Interno" && (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={obtenerDistancia}
              disabled={deshabilitado || calculandoKm}
              title={
                direccionCliente || comunaCliente
                  ? `Calcula los km por carretera hasta: ${[direccionCliente, comunaCliente].filter(Boolean).join(", ")}`
                  : "La cotización no tiene dirección; digita los km manualmente"
              }
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 40 }}
            >
              {calculandoKm ? "Midiendo…" : "Obtener distancia"}
            </button>
            <input
              type="text"
              inputMode="decimal"
              className="input"
              style={{ ...selectStyle, width: 110 }}
              value={km}
              onChange={(e) => setKm(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
              placeholder="Km (ida)"
              title="Kilómetros de ida; el cálculo aplica ida y vuelta (×2)"
              disabled={deshabilitado}
            />
          </>
        )}

        {empresa === "Starken" && (
          <select
            className="input"
            style={{ ...selectStyle, minWidth: 190, flex: 1 }}
            value={localidad}
            onChange={(e) => setLocalidad(e.target.value)}
            disabled={deshabilitado || !region}
          >
            <option value="">Localidad destino…</option>
            {localidades.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        )}

        <button
          type="button"
          className="btn btn-primary"
          onClick={calcular}
          disabled={deshabilitado || calculando || !empresa}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 40 }}
        >
          <Calculator size={14} />
          {calculando ? "Calculando…" : "Calcular"}
        </button>
      </div>

      {comunaSinMatch && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--warning, #b45309)" }}>
          La comuna del cliente ("{comunaCliente}") no aparece en el tarifario Starken de esta
          región; selecciona la localidad manualmente.
        </div>
      )}

      {empresa === "Interno" && kmDestino && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          Distancia medida hasta: {kmDestino} (editable si no corresponde).
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--danger, #dc2626)" }}>{error}</div>
      )}

      {resultado && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text)" }}>
          <b style={{ color: "var(--primary-dark, #1e9295)" }}>
            Flete neto: ${Number(resultado.neto || 0).toLocaleString("es-CL")}
          </b>
          <span style={{ color: "var(--text-muted)" }}> — {resultado.detalle}</span>
          <span style={{ color: "var(--text-muted)" }}> (aplicado al Flete Estimado)</span>
        </div>
      )}
    </div>
  );
}
