import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, RefreshCw, Navigation, AlertTriangle, Truck, Clock } from "lucide-react";
import { api } from "../lib/api";
import { cargarGoogleMaps } from "../lib/googleMaps";

const POLL_MS = 8000;
const SANTIAGO = { lat: -33.45, lng: -70.66 };

// Color del pin según el estado del viaje activo (o gris si está libre/offline).
function colorChofer(c) {
  if (!c.online) return "#94a3b8";
  const estado = c.viaje_activo?.estado;
  if (estado === "En ruta") return "#0d9488";
  if (estado === "Asignado") return "#1d4ed8";
  return "#28aeb1";
}

function pinSvg(initials, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="58" viewBox="0 0 48 58">
    <path d="M24 56 L16 40 L32 40 Z" fill="${color}"/>
    <circle cx="24" cy="22" r="19" fill="${color}" stroke="#fff" stroke-width="3"/>
    <text x="24" y="28" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#fff">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function iniciales(nombre) {
  return String(nombre || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

// Color/badge del estado del viaje activo (Asignado / En ruta).
const ESTADO_COL = {
  "En ruta": { c: "#0d9488", b: "#ccfbf1" },
  Asignado: { c: "#1d4ed8", b: "#dbeafe" },
  Entregado: { c: "#15803d", b: "#dcfce7" },
  "No entregado": { c: "#b91c1c", b: "#fee2e2" },
};

// Tiempo relativo desde un ISO ("hace 5 s", "hace 3 min", "hace 2 h").
function hace(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export default function TrackingChoferes() {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map()); // chofer_id -> google.maps.Marker
  const polylineRef = useRef(null);
  const fitDoneRef = useRef(false);

  const [snapshot, setSnapshot] = useState([]);
  const [seleccion, setSeleccion] = useState(null); // chofer_id
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  // Cargar el mapa una vez.
  useEffect(() => {
    let activo = true;
    cargarGoogleMaps()
      .then((google) => {
        if (!activo || !mapDivRef.current) return;
        mapRef.current = new google.maps.Map(mapDivRef.current, {
          center: SANTIAGO,
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        setListo(true);
      })
      .catch((e) => activo && setError(e?.message || "No se pudo cargar el mapa."));
    return () => { activo = false; };
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      const r = await api.get("/choferes/tracking/snapshot");
      setSnapshot(Array.isArray(r) ? r : []);
    } catch {
      // silencioso (polling)
    }
  }, []);

  useEffect(() => {
    fetchSnapshot();
    const id = setInterval(fetchSnapshot, POLL_MS);
    return () => clearInterval(id);
  }, [fetchSnapshot]);

  // Pintar/actualizar marcadores cuando llega el snapshot.
  useEffect(() => {
    const google = window.google;
    if (!listo || !google || !mapRef.current) return;
    const vistos = new Set();
    const bounds = new google.maps.LatLngBounds();
    let conPos = 0;

    snapshot.forEach((c) => {
      if (c.lat == null || c.lng == null) return;
      vistos.add(c.chofer_id);
      conPos++;
      const pos = { lat: Number(c.lat), lng: Number(c.lng) };
      bounds.extend(pos);
      const color = colorChofer(c);
      let marker = markersRef.current.get(c.chofer_id);
      if (!marker) {
        marker = new google.maps.Marker({ map: mapRef.current, title: c.nombre });
        marker.addListener("click", () => setSeleccion(c.chofer_id));
        markersRef.current.set(c.chofer_id, marker);
      }
      marker.setPosition(pos);
      const enRuta = c.online && c.viaje_activo?.estado === "En ruta";
      const W = enRuta ? 54 : 44;
      const H = enRuta ? 64 : 53;
      marker.setIcon({
        url: pinSvg(iniciales(c.nombre), color),
        scaledSize: new google.maps.Size(W, H),
        anchor: new google.maps.Point(W / 2, H),
        labelOrigin: new google.maps.Point(W / 2, H + 11),
      });
      // Etiqueta debajo del pin con el estado del viaje (o "Desconectado").
      const estadoLabel = c.viaje_activo?.estado || (c.online ? "" : "Desconectado");
      marker.setLabel(
        estadoLabel
          ? { text: estadoLabel, color: c.online ? color : "#64748b", fontSize: "11px", fontWeight: "800" }
          : null,
      );
      marker.setZIndex(enRuta ? 30 : c.online ? 20 : 10);
      marker.setOpacity(c.online ? 1 : 0.6);
    });

    // Quitar marcadores de choferes que ya no vienen con posición.
    markersRef.current.forEach((marker, id) => {
      if (!vistos.has(id)) {
        marker.setMap(null);
        markersRef.current.delete(id);
      }
    });

    // Encierra todos los marcadores la primera vez que hay posiciones.
    if (!fitDoneRef.current && conPos > 0) {
      mapRef.current.fitBounds(bounds, 64);
      fitDoneRef.current = true;
    }
  }, [snapshot, listo]);

  // Dibujar recorrido del viaje activo del chofer seleccionado.
  useEffect(() => {
    const google = window.google;
    if (!listo || !google || !mapRef.current) return;
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }
    const chofer = snapshot.find((c) => c.chofer_id === seleccion);
    const viajeId = chofer?.viaje_activo?.id;
    if (!viajeId) return;
    let activo = true;
    api.get(`/choferes/viajes/${viajeId}/recorrido`).then((puntos) => {
      if (!activo || !Array.isArray(puntos) || puntos.length < 2) return;
      const path = puntos.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
      polylineRef.current = new google.maps.Polyline({
        path,
        map: mapRef.current,
        strokeColor: "#28aeb1",
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
    }).catch(() => {});
    return () => { activo = false; };
  }, [seleccion, snapshot, listo]);

  function centrarEn(c) {
    setSeleccion(c.chofer_id);
    if (c.lat != null && c.lng != null && mapRef.current) {
      mapRef.current.panTo({ lat: Number(c.lat), lng: Number(c.lng) });
      mapRef.current.setZoom(15);
    }
  }

  const stats = useMemo(() => {
    let enLinea = 0, enRuta = 0, asignados = 0, sinViaje = 0;
    snapshot.forEach((c) => {
      if (c.online) enLinea++;
      const est = c.viaje_activo?.estado;
      if (est === "En ruta") enRuta++;
      else if (est === "Asignado") asignados++;
      if (c.online && !c.viaje_activo) sinViaje++;
    });
    return { enLinea, enRuta, asignados, sinViaje, total: snapshot.length };
  }, [snapshot]);

  return (
    <div className="page">
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
          <span style={{ position: "relative", width: 44, height: 44, borderRadius: 13, background: "linear-gradient(135deg, var(--primary), var(--primary-dark))", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 8px 18px rgba(40,174,177,.28)" }}>
            <MapPin size={22} />
          </span>
          <div>
            <h1 className="page-title">Tracking en Vivo</h1>
            <p className="page-subtitle" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#15803d", fontWeight: 700 }}>
                <span style={{ position: "relative", width: 8, height: 8 }}>
                  <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#22c55e" }} />
                  <span style={{ position: "absolute", inset: -3, borderRadius: "50%", border: "2px solid #22c55e", animation: "trk-pulse 1.8s ease-out infinite" }} />
                </span>
                En vivo
              </span>
              · se actualiza cada {POLL_MS / 1000}s
            </p>
          </div>
        </div>
        <button className="btn btn-secondary" onClick={fetchSnapshot}><RefreshCw size={15} /> Actualizar</button>
      </div>

      <style>{`@keyframes trk-pulse{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.4);opacity:0}}`}</style>

      {/* KPIs */}
      <div className="stats-row" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">En línea</div>
          <div className="stat-value" style={{ color: "#15803d" }}>{stats.enLinea}<span style={{ fontSize: 15, color: "var(--text-muted)", fontWeight: 600 }}> / {stats.total}</span></div>
          <div className="stat-sub">choferes conectados</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">En ruta</div>
          <div className="stat-value" style={{ color: "#0d9488" }}>{stats.enRuta}</div>
          <div className="stat-sub">con despacho en curso</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Asignados</div>
          <div className="stat-value" style={{ color: "#1d4ed8" }}>{stats.asignados}</div>
          <div className="stat-sub">por iniciar</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">En línea sin viaje</div>
          <div className="stat-value" style={{ color: "var(--primary-dark)" }}>{stats.sinViaje}</div>
          <div className="stat-sub">disponibles</div>
        </div>
      </div>

      {error ? (
        <div className="surface"><div className="surface-body" style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--danger)" }}>
          <AlertTriangle size={18} /> {error}
        </div></div>
      ) : (
        // El listado de choferes pasa a ocupar el ancho completo sobre el mapa
        // cuando la pantalla ya no admite las dos columnas.
        <div className="layout-con-lateral lateral-izq" style={{ gap: 16, alignItems: "stretch" }}>
          {/* Panel lateral */}
          <div className="surface" style={{ maxHeight: "calc(100vh - 300px)", overflowY: "auto" }}>
            <div className="surface-body" style={{ padding: 10 }}>
              {snapshot.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                  <Truck size={26} style={{ color: "#cbd5e1", marginBottom: 8 }} />
                  <div>Sin choferes activos.</div>
                </div>
              ) : snapshot.map((c) => {
                const sel = c.chofer_id === seleccion;
                const col = colorChofer(c);
                const est = c.viaje_activo?.estado;
                const ecol = ESTADO_COL[est] || { c: "var(--primary-dark)", b: "var(--primary-light)" };
                return (
                  <button key={c.chofer_id} type="button" onClick={() => centrarEn(c)} style={{
                    display: "block", width: "100%", textAlign: "left", padding: "11px 12px", marginBottom: 8,
                    border: `1px solid ${sel ? "var(--primary)" : "var(--border)"}`, borderRadius: 12, cursor: "pointer",
                    background: sel ? "var(--primary-light)" : "#fff",
                    borderLeft: `4px solid ${col}`,
                    boxShadow: sel ? "0 4px 14px rgba(40,174,177,.18)" : "0 1px 3px rgba(15,23,42,.05)",
                    transition: "box-shadow .15s, border-color .15s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ position: "relative", flexShrink: 0 }}>
                        <span style={{ width: 38, height: 38, borderRadius: "50%", background: col, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, opacity: c.online ? 1 : 0.55 }}>
                          {iniciales(c.nombre)}
                        </span>
                        <span style={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: "50%", background: c.online ? "#22c55e" : "#94a3b8", border: "2px solid #fff" }} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</span>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: c.online ? "#15803d" : "#94a3b8", whiteSpace: "nowrap" }}>
                            {c.online ? "En línea" : "Offline"}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.patente || c.rut_formateado}</div>
                      </div>
                    </div>

                    {c.viaje_activo ? (
                      <div style={{ marginTop: 9, paddingTop: 9, borderTop: "1px dashed var(--border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, padding: "2px 9px", borderRadius: 999, color: ecol.c, background: ecol.b }}>
                            <Navigation size={10} /> {est}
                          </span>
                          {c.viaje_activo.numero_amso && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--primary-dark)" }}>{c.viaje_activo.numero_amso}</span>
                          )}
                        </div>
                        {c.viaje_activo.id_cotizacion && (
                          <div style={{ fontSize: 11.5, color: "#475569", marginTop: 4 }}>
                            Cotización <strong style={{ color: "#0f172a" }}>{c.viaje_activo.id_cotizacion}</strong>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--border)" }}>Sin viaje activo</div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: c.lat == null ? "#b45309" : "#94a3b8", marginTop: 6 }}>
                      {c.lat == null ? (
                        <><AlertTriangle size={11} /> Sin ubicación reportada</>
                      ) : (
                        <><Clock size={11} /> {c.online ? `Actualizado ${hace(c.last_seen_at)}` : `Última señal ${hace(c.last_seen_at)}`}</>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mapa — el div del mapa NO debe tener hijos de React (Google Maps
              maneja su DOM); el "Cargando…" va como overlay hermano. */}
          <div className="surface" style={{ overflow: "hidden", minHeight: 480, position: "relative" }}>
            <div ref={mapDivRef} style={{ width: "100%", height: "calc(100vh - 300px)", minHeight: 480, background: "#e2e8f0" }} />
            {!listo && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", gap: 8 }}>
                <MapPin size={18} /> Cargando mapa…
              </div>
            )}
            {listo && (
              <div style={{ position: "absolute", left: 12, bottom: 12, background: "rgba(255,255,255,.95)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", boxShadow: "0 4px 14px rgba(15,23,42,.12)", fontSize: 11.5 }}>
                <div style={{ fontWeight: 800, color: "#0f172a", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".04em", fontSize: 10.5 }}>Estado del chofer</div>
                {[
                  { c: "#0d9488", l: "En ruta" },
                  { c: "#1d4ed8", l: "Asignado" },
                  { c: "#28aeb1", l: "En línea, sin viaje" },
                  { c: "#94a3b8", l: "Desconectado" },
                ].map((it) => (
                  <div key={it.l} style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: it.c, flexShrink: 0 }} />
                    <span style={{ color: "#475569", fontWeight: 600 }}>{it.l}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
