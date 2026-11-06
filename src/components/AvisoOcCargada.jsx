import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, X, ExternalLink, Check, ShoppingCart, PackageX } from "lucide-react";
import { api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { useUnsavedChanges } from "../context/UnsavedChangesContext";

/* (2026-11-04) Ventana flotante para el dueño de la cotización cuando OTRA
   persona carga una orden de compra en ella. El backend deja el aviso
   `oc_cargada` en la campana (y manda el correo); acá se muestra apenas llega
   (realtime sobre `notificaciones`, con sondeo de respaldo) y se queda hasta
   que la persona la atiende: «Ver cotización» abre el detalle y «Entendido»
   solo la marca leída. No tapa la pantalla: va abajo a la derecha, como el
   aviso del chat, y si hay varias se muestran de a una. */

const POLL_MS = 45_000;

/* (2026-11-05) La misma ventana avisa también los pedidos que llegan del
   portal del cliente, al administrador y al dueño de la cartera (pedido de
   Ariel). Es una sola cola, de a un aviso, para que no se monten dos ventanas
   en la misma esquina. Los avisos del portal solo saltan si son recientes:
   los antiguos sin leer se quedan en la campana y no inundan la pantalla. */
const RECIENTE_MS = 72 * 3600 * 1000;
const esReciente = (n) => Date.now() - new Date(n?.creado_at || 0).getTime() < RECIENTE_MS;
const pedidoPortal = (titulo) => ({
  titulo,
  aria: titulo,
  Icono: ShoppingCart,
  valido: (n) => !!n?.metadata?.solicitud_id && esReciente(n),
  quien: (m) => m.razon_social || m.rut_formateado || "Cliente del portal",
  datos: (m) => [
    ["Pedido", `N° ${m.solicitud_id}`],
    Number(m.total_items) > 0 ? ["Productos", m.total_items] : null,
    m.rut_formateado ? ["RUT", m.rut_formateado] : null,
  ],
  destino: (n) => `/pedidos-portal?pedido=${n.metadata.solicitud_id}`,
  boton: "Ver pedido",
});
const TIPOS = {
  oc_cargada: {
    titulo: "Orden de compra cargada",
    aria: "Orden de compra cargada en tu cotización",
    Icono: ClipboardCheck,
    valido: (n) => !!n?.metadata?.licitacion_id,
    quien: (m) => m.cargado_por_nombre || m.cargado_por || "Otro usuario",
    datos: (m) => [
      m.numero ? ["N° OC", m.numero] : null,
      Number(m.monto) > 0 ? ["Monto neto", clp(m.monto)] : null,
      m.fecha_oc ? ["Fecha OC", fechaCorta(m.fecha_oc)] : null,
    ],
    destino: (n) => n.link || `/detalle/${n.metadata.licitacion_id}`,
    boton: "Ver cotización",
  },
  /* (2026-11-06) Quiebre de stock declarado en Gestión de compras: salta al
     vendedor de cada cotización que tiene ese producto por despachar. */
  quiebre_stock: {
    titulo: "Quiebre de stock",
    aria: "Quiebre de stock en un producto de tu cotización",
    Icono: PackageX,
    valido: (n) => !!n?.metadata?.licitacion_id && esReciente(n),
    quien: (m) => m.cliente || `Cotización #${m.licitacion_id}`,
    datos: (m) => [
      ["Cotización", `#${m.licitacion_id}`],
      m.sku ? ["SKU", m.sku] : null,
      Number(m.pendiente) > 0 ? ["Por despachar", Number(m.pendiente).toLocaleString("es-CL")] : null,
      m.fecha_estimada ? ["Reposición", fechaCorta(m.fecha_estimada)] : null,
    ],
    destino: (n) => n.link || `/detalle/${n.metadata.licitacion_id}`,
    boton: "Ver cotización",
  },
  stock_solicitud_cotizacion: pedidoPortal("Nuevo pedido del portal"),
  pedido_portal_aprobado: pedidoPortal("Pedido del portal aprobado"),
};

const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;

function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function haceCuanto(iso) {
  const d = new Date(iso || "");
  if (Number.isNaN(d.getTime())) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return d.toLocaleDateString("es-CL");
}

export default function AvisoOcCargada() {
  const [pendientes, setPendientes] = useState([]);
  const atendidasRef = useRef(new Set());
  const { requestNavigation } = useUnsavedChanges();

  const cargar = useCallback(async () => {
    try {
      const r = await api.get("/notificaciones?soloNoLeidas=true");
      const lista = (Array.isArray(r) ? r : []).filter(
        (n) => TIPOS[n?.tipo]?.valido(n) && !atendidasRef.current.has(n.id),
      );
      setPendientes(lista);
    } catch {
      // silencioso: una ventana de aviso no puede romper la app
    }
  }, []);

  useEffect(() => {
    cargar();
    const id = setInterval(cargar, POLL_MS);
    return () => clearInterval(id);
  }, [cargar]);

  // Realtime: la ventana aparece al instante cuando el backend inserta el aviso.
  useEffect(() => {
    let canal = null;
    let cancelado = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email?.toLowerCase();
      if (!email || cancelado) return;
      canal = supabase
        .channel(`oc-cargada-${email}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notificaciones", filter: `user_email=eq.${email}` },
          (payload) => {
            if (TIPOS[payload?.new?.tipo]) cargar();
          },
        )
        .subscribe();
    })();
    return () => {
      cancelado = true;
      if (canal) supabase.removeChannel(canal);
    };
  }, [cargar]);

  async function marcarLeida(id) {
    atendidasRef.current.add(id);
    setPendientes((prev) => prev.filter((n) => n.id !== id));
    try {
      await api.post(`/notificaciones/${id}/leer`, {});
    } catch {
      // si falla, al menos queda atendida en esta sesión
    }
  }

  const actual = pendientes[0] || null;
  if (!actual) return null;

  const m = actual.metadata || {};
  const cfg = TIPOS[actual.tipo];
  const Icono = cfg.Icono;
  const quien = cfg.quien(m);
  const restantes = pendientes.length - 1;
  const datos = cfg.datos(m).filter(Boolean);

  function verCotizacion() {
    const destino = cfg.destino(actual);
    marcarLeida(actual.id);
    requestNavigation(destino);
  }

  const ventana = (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={cfg.aria}
      data-tipo={actual.tipo}
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 10600,
        width: 400,
        maxWidth: "calc(100vw - 32px)",
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: 14,
        boxShadow: "0 24px 50px rgba(15,23,42,.22), 0 4px 10px rgba(15,23,42,.06)",
        overflow: "hidden",
        animation: "aviso-oc-in .22s ease-out",
      }}
    >
      <style>{`
        @keyframes aviso-oc-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .aviso-oc-btn:hover { filter: brightness(.96); }
      `}</style>

      {/* Encabezado con el gradiente de marca */}
      <div
        style={{
          background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
          color: "#fff",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "rgba(255,255,255,.18)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icono size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: "block", fontSize: 14, lineHeight: 1.2 }}>{cfg.titulo}</strong>
          <span
            style={{
              fontSize: 11.5,
              opacity: 0.85,
              display: "block",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {quien} · {haceCuanto(actual.creado_at)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => marcarLeida(actual.id)}
          title="Cerrar (queda como leída en la campana)"
          aria-label="Cerrar"
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            border: "none",
            background: "rgba(255,255,255,.14)",
            color: "#fff",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Cuerpo */}
      <div style={{ padding: "12px 14px 10px" }}>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--text)", lineHeight: 1.5, wordBreak: "break-word" }}>
          {actual.mensaje}
        </p>
        {datos.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {datos.map(([k, v]) => (
              <span
                key={k}
                style={{
                  fontSize: 11.5,
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: "var(--primary-light, #e7f8f8)",
                  color: "var(--primary-dark, #178a8f)",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {k}: {v}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Acciones */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: 8,
          padding: "10px 14px 12px",
          borderTop: "1px solid var(--border, #e2e8f0)",
          background: "var(--bg, #f8fafc)",
        }}
      >
        {restantes > 0 && (
          <span style={{ marginRight: "auto", fontSize: 11.5, color: "var(--text-muted, #64748b)" }}>
            +{restantes} {restantes === 1 ? "aviso más" : "avisos más"}
          </span>
        )}
        <button
          type="button"
          className="aviso-oc-btn"
          onClick={() => marcarLeida(actual.id)}
          style={{
            padding: "8px 12px",
            borderRadius: "var(--radius, 8px)",
            border: "1px solid var(--border-strong, #cbd5e1)",
            background: "var(--surface, #fff)",
            color: "var(--text)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Check size={14} /> Entendido
        </button>
        <button
          type="button"
          className="aviso-oc-btn"
          onClick={verCotizacion}
          style={{
            padding: "8px 14px",
            borderRadius: "var(--radius, 8px)",
            border: "none",
            background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {cfg.boton} <ExternalLink size={13} />
        </button>
      </div>
    </div>
  );

  return createPortal(ventana, document.body);
}
