import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

const UnsavedChangesContext = createContext(null);

export function UnsavedChangesProvider({ children }) {
  const navigate = useNavigate();

  const [isDirty, setIsDirty] = useState(false);

  const [pendingNav, setPendingNav] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [discardHandler, setDiscardHandler] = useState(null);
  const [saveHandler, setSaveHandler] = useState(null);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const doNavigate = useCallback(
    (to, options) => {
      if (typeof to === "number") navigate(to);
      else navigate(to, options);
    },
    [navigate]
  );

  const requestNavigation = useCallback(
    (to, options) => {
      if (!isDirty) {
        doNavigate(to, options);
        return;
      }
      setPendingNav({ to, options });
      setShowModal(true);
    },
    [isDirty, doNavigate]
  );

  const registerDiscardHandler = useCallback((fn) => setDiscardHandler(() => fn), []);
  const clearDiscardHandler = useCallback(() => setDiscardHandler(null), []);

  const registerSaveHandler = useCallback((fn) => setSaveHandler(() => fn), []);
  const clearSaveHandler = useCallback(() => setSaveHandler(null), []);

  const seguirEditando = useCallback(() => {
    if (busy) return;
    setShowModal(false);
    setPendingNav(null);
  }, [busy]);

  const navegarPendiente = useCallback(() => {
    if (!pendingNav) return;
    const { to, options } = pendingNav;
    setShowModal(false);
    setPendingNav(null);
    doNavigate(to, options);
  }, [pendingNav, doNavigate]);

  const descartarCambios = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof discardHandler === "function") {
        await discardHandler();
      }
      setIsDirty(false);
      navegarPendiente();
    } catch (e) {
      console.error("Error al descartar cambios:", e);
      // si falla, NO navegamos
    } finally {
      setBusy(false);
    }
  }, [busy, discardHandler, navegarPendiente]);

  const guardarCambios = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof saveHandler !== "function") return;

      // ✅ importante: el handler debe retornar true/false
      const ok = await saveHandler();

      if (!ok) {
        // NO se guardó: el page ya mostró toast/errores.
        // No cerramos modal ni navegamos.
        return;
      }

      setIsDirty(false);
      navegarPendiente();
    } catch (e) {
      console.error("Error al guardar cambios:", e);
      // si falla, NO navegamos
    } finally {
      setBusy(false);
    }
  }, [busy, saveHandler, navegarPendiente]);

  const value = useMemo(
    () => ({
      isDirty,
      setIsDirty,
      requestNavigation,

      registerDiscardHandler,
      clearDiscardHandler,

      registerSaveHandler,
      clearSaveHandler,
    }),
    [
      isDirty,
      requestNavigation,
      registerDiscardHandler,
      clearDiscardHandler,
      registerSaveHandler,
      clearSaveHandler,
    ]
  );

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}

      {showModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,.35)", padding: "0 16px",
        }}>
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "0 8px 32px rgba(0,0,0,.14)",
            padding: "28px 28px 24px",
            width: "100%",
            maxWidth: 480,
          }}>
            {/* Ícono + título */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="12" fill="#f59e0b" opacity=".15" />
                <path d="M12 8v5M12 15.5v.5" stroke="#d97706" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                Cambios sin guardar
              </h3>
            </div>

            <p style={{ margin: "0 0 24px", fontSize: 13.5, color: "var(--text-soft)", lineHeight: 1.55 }}>
              Si navegas ahora perderás los cambios que hiciste en esta sección. ¿Qué querés hacer?
            </p>

            <div className="btn-row" style={{ justifyContent: "flex-end" }}>
              <button onClick={seguirEditando} disabled={busy} className="btn btn-ghost">
                Seguir editando
              </button>
              <button onClick={guardarCambios} disabled={busy} className="btn btn-primary">
                {busy ? "Guardando…" : "Guardar y salir"}
              </button>
              <button onClick={descartarCambios} disabled={busy} className="btn btn-danger">
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error("useUnsavedChanges debe usarse dentro de UnsavedChangesProvider");
  }
  return ctx;
}
