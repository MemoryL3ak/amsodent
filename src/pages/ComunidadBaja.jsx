import { useEffect, useState } from "react";
import { CheckCircle2, MailX } from "lucide-react";
import { EVT_STYLES } from "./EventoRegistro";

/* ============================================================
   Baja de los correos de la Comunidad Amsodent (/comunidad/baja).

   (2026-11-19) A esta página llega quien pincha «date de baja» en un
   mailing de Comunidad. El enlace trae su correo firmado (?c=…&f=…):
   se muestra enmascarado y la baja se hace al pulsar el botón, no al
   abrir la página (los filtros de correo abren los enlaces por su
   cuenta). Pública, sin sesión; mismo diseño evt-* del formulario.
============================================================ */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const AMSODENT_LOGO = "/logo_superior_ficha.png";

export default function ComunidadBaja() {
  const params = new URLSearchParams(window.location.search);
  const c = params.get("c") || "";
  const f = params.get("f") || "";
  const [correo, setCorreo] = useState("");
  const [estado, setEstado] = useState("cargando"); // cargando | listo | invalido | enviando | hecho
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(`${API_URL}/comunidad/baja?c=${encodeURIComponent(c)}&f=${encodeURIComponent(f)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (r.ok && j?.correo) { setCorreo(j.correo); setEstado("listo"); }
        else setEstado("invalido");
      })
      .catch(() => vivo && setEstado("invalido"));
    return () => { vivo = false; };
  }, [c, f]);

  async function confirmar() {
    setEstado("enviando");
    setError("");
    try {
      const r = await fetch(`${API_URL}/comunidad/baja`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ c, f }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(Array.isArray(j?.message) ? j.message.join(" ") : j?.message || "No pudimos registrar tu baja.");
      setEstado("hecho");
    } catch (e) {
      setError(e?.message || "No pudimos registrar tu baja.");
      setEstado("listo");
    }
  }

  return (
    <div className="evt-page">
      <main className="evt-main">
        <div className="evt-card evt-success pagina-baja-comunidad">
          <img src={AMSODENT_LOGO} alt="AMSODENT" className="evt-logo" />
          {estado === "hecho" ? (
            <>
              <div className="evt-success-icon"><CheckCircle2 size={46} /></div>
              <h1 className="evt-title">Listo: no te escribiremos más</h1>
              <p className="evt-sub">Sacamos {correo} de los correos de la Comunidad Amsodent. Si fue un error, escríbenos y te volvemos a sumar.</p>
            </>
          ) : estado === "invalido" ? (
            <>
              <div className="evt-success-icon" style={{ color: "#b45309" }}><MailX size={46} /></div>
              <h1 className="evt-title">Este enlace no es válido</h1>
              <p className="evt-sub">El enlace de baja está incompleto o fue modificado. Ábrelo de nuevo desde el correo que recibiste o responde ese correo con la palabra BAJA.</p>
            </>
          ) : (
            <>
              <div className="evt-success-icon" style={{ color: "#475467" }}><MailX size={46} /></div>
              <h1 className="evt-title">¿Dejar de recibir nuestros correos?</h1>
              <p className="evt-sub">
                {estado === "cargando" ? "Revisando el enlace…" : <>Dejaremos de enviar los correos de la Comunidad Amsodent a <b>{correo}</b>.</>}
              </p>
              {error && <div className="evt-error" role="alert" style={{ marginTop: 14 }}>{error}</div>}
              <button type="button" className="evt-submit boton-confirmar-baja" onClick={confirmar} disabled={estado !== "listo"} style={{ marginTop: 18 }}>
                {estado === "enviando" ? "Registrando…" : "Darme de baja"}
              </button>
            </>
          )}
          <div className="evt-success-meta">Equipo AMSODENT</div>
        </div>
      </main>
      <footer className="evt-footer">© {new Date().getFullYear()} AMSODENT · Todos los derechos reservados</footer>
      <style>{EVT_STYLES}</style>
    </div>
  );
}
