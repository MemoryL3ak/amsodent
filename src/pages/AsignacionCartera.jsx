import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import Toast from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import BotonLimpiarFiltros from "../components/BotonLimpiarFiltros";
import DropdownSelect from "../components/ui/DropdownSelect";
import { ChevronLeft, ChevronRight, UserCheck, UserX, Users } from "lucide-react";

/* ── Asignación de cartera (2026-10-01) ────────────────────────────────────
   El vendedor de un cliente se cambiaba de a uno, entrando a editar su ficha.
   Con la mayoría de los clientes sin vendedor, así la cartera no se ordena
   nunca. Acá se filtra, se marcan varios y se asignan de una vez.

   La columna "Le cotiza" es lo que permite repartir con criterio: muestra qué
   vendedor le ha hecho cotizaciones a cada cliente, y se puede filtrar por
   ella ("todos los que atiende Sandy" → marcar todos → asignar a Sandy). */

const POR_PAGINA = 25;
const SIN_ASIGNAR = "__sin__";
const QUITAR = "__quitar__";
const ROLES_VENTA = ["ventas", "ventas_especial", "jefe_ventas", "jefe_ventas_especial"];
const ETIQUETA_ROL = {
  ventas: "Ventas",
  ventas_especial: "Ventas especial",
  jefe_ventas: "Jefe de ventas",
  jefe_ventas_especial: "Jefe de ventas especial",
  admin: "Administrador",
  administrador: "Administrador",
};

const sinTildes = (v) =>
  String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function AsignacionCartera() {
  const [clientes, setClientes] = useState(null);
  const [perfiles, setPerfiles] = useState([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);

  const [q, setQ] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fRegion, setFRegion] = useState("");
  const [fVendedor, setFVendedor] = useState("");
  const [fCotiza, setFCotiza] = useState("");
  const [pagina, setPagina] = useState(1);

  const [marcados, setMarcados] = useState(() => new Set());
  const [destino, setDestino] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setError("");
    try {
      const [lista, perf] = await Promise.all([
        api.get("/clientes/cartera"),
        api.get("/usuarios/profiles").catch(() => []),
      ]);
      setClientes(Array.isArray(lista) ? lista : []);
      setPerfiles(Array.isArray(perf) ? perf : []);
    } catch (e) {
      console.error(e);
      setError(e?.message || "No se pudo cargar la cartera.");
      setClientes([]);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const perfilPorCorreo = useMemo(() => {
    const m = {};
    for (const p of perfiles) {
      const e = String(p?.email || "").trim().toLowerCase();
      if (e) m[e] = p;
    }
    return m;
  }, [perfiles]);

  const nombreDe = (correo) => {
    const e = String(correo || "").trim().toLowerCase();
    if (!e) return "Sin asignar";
    return String(perfilPorCorreo[e]?.nombre || "").trim() || e;
  };

  // A quién se le puede asignar: usuarios vigentes; los de venta primero.
  const opcionesDestino = useMemo(() => {
    const lista = perfiles
      .filter((p) => p?.email && p?.bloqueado !== true)
      .map((p) => {
        const rol = String(p.rol || "").trim().toLowerCase();
        return {
          value: String(p.email).trim().toLowerCase(),
          label: String(p.nombre || p.email).trim(),
          detalle: ETIQUETA_ROL[rol] || rol || "",
          venta: ROLES_VENTA.includes(rol),
        };
      })
      .sort((a, b) => Number(b.venta) - Number(a.venta) || a.label.localeCompare(b.label, "es"));
    return [
      { value: "", label: "Elegir vendedor…" },
      ...lista,
      { value: QUITAR, label: "Sin asignar", detalle: "Quita el vendedor que tengan" },
    ];
  }, [perfiles]);

  const lista = useMemo(() => clientes || [], [clientes]);

  // Cartera por vendedor (sobre TODOS los clientes, no sobre el filtro).
  const porVendedor = useMemo(() => {
    const m = new Map();
    for (const c of lista) {
      const k = c.vendedor_asignado || "";
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()]
      .filter(([k]) => k)
      .map(([correo, n]) => ({ correo, n }))
      .sort((a, b) => b.n - a.n);
  }, [lista]);

  const sinAsignar = useMemo(() => lista.filter((c) => !c.vendedor_asignado).length, [lista]);

  const tipos = useMemo(
    () => [...new Set(lista.map((c) => c.tipo_cliente).filter(Boolean))].sort(),
    [lista],
  );
  const regiones = useMemo(
    () => [...new Set(lista.map((c) => c.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
    [lista],
  );
  const quienesCotizan = useMemo(() => {
    const m = new Map();
    for (const c of lista) {
      const principal = c.cotiza?.[0]?.email;
      if (principal) m.set(principal, (m.get(principal) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [lista]);

  const filtrados = useMemo(() => {
    const texto = sinTildes(q.trim());
    const rutBuscado = q.replace(/[.\-\s]/g, "").toLowerCase();
    return lista.filter((c) => {
      if (texto) {
        const enNombre = sinTildes(c.nombre).includes(texto);
        const enRut = rutBuscado && String(c.rut || "").replace(/[.\-\s]/g, "").toLowerCase().includes(rutBuscado);
        if (!enNombre && !enRut) return false;
      }
      if (fTipo === SIN_ASIGNAR ? Boolean(c.tipo_cliente) : fTipo && c.tipo_cliente !== fTipo) return false;
      if (fRegion && c.region !== fRegion) return false;
      if (fVendedor === SIN_ASIGNAR ? Boolean(c.vendedor_asignado) : fVendedor && c.vendedor_asignado !== fVendedor) return false;
      if (fCotiza === SIN_ASIGNAR ? (c.cotiza || []).length > 0 : fCotiza && c.cotiza?.[0]?.email !== fCotiza) return false;
      return true;
    });
  }, [lista, q, fTipo, fRegion, fVendedor, fCotiza]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const hayFiltros = Boolean(q || fTipo || fRegion || fVendedor || fCotiza);
  function limpiarFiltros() {
    setQ("");
    setFTipo("");
    setFRegion("");
    setFVendedor("");
    setFCotiza("");
    setPagina(1);
  }
  const filtrar = (setter) => (valor) => {
    setter(valor);
    setPagina(1);
  };

  // ── Selección ──────────────────────────────────────────────────────────
  const idsVisibles = visibles.map((c) => c.id);
  const todosVisiblesMarcados = idsVisibles.length > 0 && idsVisibles.every((id) => marcados.has(id));
  const marcadosEnFiltro = useMemo(
    () => filtrados.reduce((acc, c) => acc + (marcados.has(c.id) ? 1 : 0), 0),
    [filtrados, marcados],
  );

  function alternar(id) {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }
  function alternarPagina() {
    setMarcados((prev) => {
      const s = new Set(prev);
      if (todosVisiblesMarcados) idsVisibles.forEach((id) => s.delete(id));
      else idsVisibles.forEach((id) => s.add(id));
      return s;
    });
  }
  function marcarFiltrados() {
    setMarcados((prev) => {
      const s = new Set(prev);
      filtrados.forEach((c) => s.add(c.id));
      return s;
    });
  }

  const destinoNombre = destino === QUITAR ? "Sin asignar" : nombreDe(destino);

  async function aplicar() {
    if (guardando || marcados.size === 0 || !destino) return;
    setGuardando(true);
    try {
      const ids = [...marcados];
      const vendedor = destino === QUITAR ? null : destino;
      const r = await api.put("/clientes/cartera", { ids, vendedor });
      // Se refleja en pantalla sin recargar todo el listado.
      setClientes((prev) =>
        (prev || []).map((c) => (marcados.has(c.id) ? { ...c, vendedor_asignado: vendedor } : c)),
      );
      setMarcados(new Set());
      setConfirmar(false);
      const n = Number(r?.actualizados ?? ids.length);
      setToast({
        type: "success",
        message: vendedor
          ? `${n} cliente${n === 1 ? "" : "s"} asignado${n === 1 ? "" : "s"} a ${destinoNombre}.`
          : `${n} cliente${n === 1 ? "" : "s"} quedaron sin vendedor asignado.`,
      });
    } catch (e) {
      console.error(e);
      setConfirmar(false);
      setToast({ type: "error", message: e?.message || "No se pudo asignar la cartera." });
    } finally {
      setGuardando(false);
    }
  }

  const opcionesVendedorFiltro = [
    { value: "", label: "Todos" },
    { value: SIN_ASIGNAR, label: `Sin asignar (${sinAsignar})` },
    ...porVendedor.map((v) => ({ value: v.correo, label: `${nombreDe(v.correo)} (${v.n})` })),
  ];
  const opcionesCotizaFiltro = [
    { value: "", label: "Todos" },
    ...quienesCotizan.map(([correo, n]) => ({ value: correo, label: `${nombreDe(correo)} (${n})` })),
    { value: SIN_ASIGNAR, label: "Nadie le ha cotizado" },
  ];

  return (
    <div className="page">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Asignación de cartera</h1>
          <p className="page-subtitle">
            Marca los clientes y asígnalos de una vez a un vendedor. Cada vendedor ve los suyos en «Mis clientes».
          </p>
        </div>
      </div>

      <div className="stats-row stats-3">
        <div className="stat-card">
          <div className="stat-label"><Users size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Clientes</div>
          <div className="stat-value">{clientes === null ? "…" : lista.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><UserCheck size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Con vendedor</div>
          <div className="stat-value">{clientes === null ? "…" : lista.length - sinAsignar}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><UserX size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Sin asignar</div>
          <div className="stat-value">{clientes === null ? "…" : sinAsignar}</div>
        </div>
      </div>

      {/* Cartera por vendedor: de un vistazo quién tiene cuántos; al hacer
          clic se filtra por ese vendedor. */}
      {porVendedor.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {porVendedor.map((v) => {
            const activo = fVendedor === v.correo;
            return (
              <button
                key={v.correo}
                type="button"
                onClick={() => filtrar(setFVendedor)(activo ? "" : v.correo)}
                title={v.correo}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  border: `1px solid ${activo ? "var(--primary)" : "var(--border)"}`,
                  background: activo ? "var(--primary)" : "var(--surface)",
                  color: activo ? "#fff" : "var(--text)",
                  borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", maxWidth: "100%",
                }}
              >
                <span className="truncar">{nombreDe(v.correo)}</span>
                <span style={{ fontWeight: 800, opacity: activo ? 1 : 0.65 }}>{v.n}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="filter-bar">
        <div className="filter-field" style={{ flex: 2, minWidth: 200 }}>
          <label className="filter-label">Buscar</label>
          <input
            className="input"
            placeholder="Nombre o RUT…"
            value={q}
            onChange={(e) => filtrar(setQ)(e.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Tipo de cliente</label>
          <DropdownSelect
            value={fTipo}
            onChange={filtrar(setFTipo)}
            minWidth={170}
            options={[
              { value: "", label: "Todos" },
              ...tipos.map((t) => ({ value: t, label: t })),
              { value: SIN_ASIGNAR, label: "Sin tipo" },
            ]}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Región</label>
          <DropdownSelect
            value={fRegion}
            onChange={filtrar(setFRegion)}
            minWidth={170}
            options={[{ value: "", label: "Todas" }, ...regiones.map((r) => ({ value: r, label: r }))]}
          />
        </div>
        <div className="filter-field">
          <label className="filter-label">Vendedor asignado</label>
          <DropdownSelect value={fVendedor} onChange={filtrar(setFVendedor)} minWidth={190} options={opcionesVendedorFiltro} />
        </div>
        <div className="filter-field">
          <label className="filter-label" title="El vendedor que más cotizaciones le ha hecho a cada cliente">Le cotiza</label>
          <DropdownSelect value={fCotiza} onChange={filtrar(setFCotiza)} minWidth={190} options={opcionesCotizaFiltro} />
        </div>
        <BotonLimpiarFiltros hay={hayFiltros} onLimpiar={limpiarFiltros} />
      </div>

      {/* Barra de asignación: qué hay marcado y a quién va. */}
      <div
        style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10,
          border: `1px solid ${marcados.size ? "var(--primary)" : "var(--border)"}`,
          background: marcados.size ? "#f0f7ff" : "var(--surface)",
          borderRadius: 12, padding: "10px 14px", marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          {marcados.size} marcado{marcados.size === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={marcarFiltrados}
          disabled={filtrados.length === 0 || marcadosEnFiltro === filtrados.length}
          title="Marca todos los clientes que cumplen el filtro, no solo los de esta página"
        >
          Marcar los {filtrados.length} del filtro
        </button>
        {marcados.size > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMarcados(new Set())}>
            Desmarcar todo
          </button>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Asignar a</span>
        <div style={{ flex: "1 1 220px", maxWidth: 300, minWidth: 0 }}>
          <DropdownSelect value={destino} onChange={setDestino} minWidth={220} options={opcionesDestino} style={{ width: "100%" }} />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={marcados.size === 0 || !destino || guardando}
          onClick={() => setConfirmar(true)}
        >
          {destino === QUITAR ? "Quitar vendedor" : "Asignar"}
        </button>
      </div>

      {error && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={todosVisiblesMarcados}
                  onChange={alternarPagina}
                  disabled={idsVisibles.length === 0}
                  title="Marcar / desmarcar los de esta página"
                  aria-label="Marcar los de esta página"
                />
              </th>
              <th>RUT</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Región · Comuna</th>
              <th>Vendedor asignado</th>
              <th style={{ textAlign: "left" }}>Le cotiza</th>
            </tr>
          </thead>
          <tbody>
            {clientes === null && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>Cargando cartera…</td>
              </tr>
            )}
            {visibles.map((c) => {
              const marcado = marcados.has(c.id);
              const principal = c.cotiza?.[0];
              const otros = (c.cotiza || []).slice(1);
              // Pista visual: el asignado no es quien le cotiza habitualmente.
              const noCalza = principal && c.vendedor_asignado && principal.email !== c.vendedor_asignado;
              return (
                <tr
                  key={c.id}
                  onClick={() => alternar(c.id)}
                  style={{ cursor: "pointer", background: marcado ? "#f0f7ff" : undefined }}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={marcado} onChange={() => alternar(c.id)} aria-label={`Marcar ${c.nombre}`} />
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{c.rut || "—"}</td>
                  <td style={{ maxWidth: 280 }}>
                    <Link
                      to={`/clientes/${c.id}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: "var(--text)", fontWeight: 600, textDecoration: "none" }}
                      title="Ver la ficha del cliente"
                    >
                      {c.nombre || "(sin nombre)"}
                    </Link>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{c.tipo_cliente || "—"}</td>
                  <td>
                    {c.region || "—"}
                    {c.comuna ? <span style={{ color: "var(--text-muted)" }}> · {c.comuna}</span> : null}
                  </td>
                  <td>
                    {c.vendedor_asignado ? (
                      <span style={{ fontWeight: 600 }} title={c.vendedor_asignado}>{nombreDe(c.vendedor_asignado)}</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 999, padding: "2px 9px", whiteSpace: "nowrap" }}>
                        Sin asignar
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "left" }}>
                    {principal ? (
                      <span
                        title={[principal, ...otros].map((x) => `${nombreDe(x.email)}: ${x.n} cotización${x.n === 1 ? "" : "es"}`).join("\n")}
                        style={{ color: noCalza ? "#b45309" : "var(--text)" }}
                      >
                        {nombreDe(principal.email)}
                        <span style={{ color: "var(--text-muted)" }}> · {principal.n}</span>
                        {otros.length > 0 && <span style={{ color: "var(--text-muted)" }}> (+{otros.length})</span>}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {clientes !== null && filtrados.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "50px 0", color: "var(--text-muted)" }}>
                  No hay clientes que coincidan con el filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtrados.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Mostrando {(paginaActual - 1) * POR_PAGINA + 1}–{Math.min(paginaActual * POR_PAGINA, filtrados.length)} de {filtrados.length} cliente{filtrados.length === 1 ? "" : "s"}
            {marcadosEnFiltro > 0 ? ` · ${marcadosEnFiltro} marcado${marcadosEnFiltro === 1 ? "" : "s"}` : ""}
          </span>
          {totalPaginas > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual <= 1} onClick={() => setPagina(paginaActual - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", minWidth: 60, textAlign: "center" }}>
                {paginaActual} / {totalPaginas}
              </span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={paginaActual >= totalPaginas} onClick={() => setPagina(paginaActual + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmar}
        title={destino === QUITAR ? "Quitar vendedor" : "Asignar cartera"}
        message={
          destino === QUITAR
            ? `${marcados.size} cliente${marcados.size === 1 ? "" : "s"} quedará${marcados.size === 1 ? "" : "n"} sin vendedor asignado.`
            : `${marcados.size} cliente${marcados.size === 1 ? "" : "s"} pasará${marcados.size === 1 ? "" : "n"} a la cartera de ${destinoNombre}. Si alguno ya tenía vendedor, se reemplaza.`
        }
        confirmText={guardando ? "Guardando…" : destino === QUITAR ? "Quitar" : "Asignar"}
        confirmTone={destino === QUITAR ? "warning" : "primary"}
        icon={destino === QUITAR ? UserX : UserCheck}
        onCancel={() => setConfirmar(false)}
        onConfirm={aplicar}
      />
    </div>
  );
}
