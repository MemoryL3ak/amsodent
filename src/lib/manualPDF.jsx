import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";

/* ============================================================================
   Manual de la Plataforma — documento PDF (Centro de Ayuda)
   ----------------------------------------------------------------------------
   Versión imprimible/compartible del manual de src/data/manualAyuda.jsx, con
   el diseño de la marca: portada teal, capítulos por grupo, figuras (flujos,
   estados, árbol documental, fórmula de comisiones), glosario y FAQ.
   Se genera FILTRADO por el rol del usuario: el PDF contiene exactamente los
   módulos que esa persona puede ver en la plataforma.
============================================================================ */

const TEAL = "#28aeb1";
const TEAL_DARK = "#1e9295";
const TEAL_DEEP = "#14666a";
const TEAL_LIGHT = "#e8f7f7";
const TEAL_MID = "#b2e4e5";
const INK = "#1a1d23";
const SOFT = "#59616c";
const MUTED = "#9ca3af";
const BORDER = "#e4e8ed";
const AMBAR = "#b45309";
const AMBAR_BG = "#fffbeb";
const AMBAR_BORDE = "#fde68a";

const TONO = {
  success: { bg: "#dcfce7", fg: "#15803d" },
  warning: { bg: "#fef9c3", fg: "#a16207" },
  danger: { bg: "#fee2e2", fg: "#b91c1c" },
  primary: { bg: TEAL_LIGHT, fg: TEAL_DEEP },
  neutral: { bg: "#f1f5f9", fg: "#475569" },
};

const s = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 52,
    paddingHorizontal: 46,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
    backgroundColor: "#ffffff",
  },

  /* Portada */
  coverPage: { padding: 0, backgroundColor: TEAL_DEEP, fontFamily: "Helvetica" },
  coverDecor1: {
    position: "absolute", top: -120, right: -120, width: 340, height: 340,
    borderRadius: 170, backgroundColor: TEAL_DARK, opacity: 0.55,
  },
  coverDecor2: {
    position: "absolute", bottom: -150, left: -100, width: 380, height: 380,
    borderRadius: 190, backgroundColor: TEAL, opacity: 0.32,
  },
  coverDecor3: {
    position: "absolute", top: 190, left: -60, width: 150, height: 150,
    borderRadius: 75, backgroundColor: TEAL_MID, opacity: 0.14,
  },
  coverInner: { flex: 1, paddingHorizontal: 58, paddingVertical: 64, justifyContent: "space-between" },
  coverLogoCard: {
    alignSelf: "flex-start", backgroundColor: "#ffffff", borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 20,
  },
  coverLogo: { width: 150, objectFit: "contain" },
  coverKicker: {
    color: TEAL_MID, fontSize: 11, letterSpacing: 3, marginBottom: 12,
    textTransform: "uppercase",
  },
  coverTitle: { color: "#ffffff", fontSize: 37, fontFamily: "Helvetica-Bold", lineHeight: 1.12 },
  coverSub: { color: "#d7f2f2", fontSize: 12.5, marginTop: 14, lineHeight: 1.5, maxWidth: 380 },
  coverChips: { flexDirection: "row", gap: 8, marginTop: 26 },
  coverChip: {
    backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 999,
    paddingVertical: 5, paddingHorizontal: 13, color: "#ffffff", fontSize: 9.5,
  },
  coverFoot: { color: "#9fd8d9", fontSize: 9, lineHeight: 1.5 },

  /* Encabezado y pie de las páginas de contenido */
  footer: {
    position: "absolute", bottom: 22, left: 46, right: 46,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderTopWidth: 1.4, borderTopColor: TEAL, paddingTop: 7,
  },
  footerTxt: { fontSize: 7.5, color: MUTED },

  /* Capítulos */
  grupoBanda: {
    backgroundColor: TEAL_DEEP, borderRadius: 10, paddingVertical: 16,
    paddingHorizontal: 20, marginBottom: 16,
  },
  grupoKicker: { color: TEAL_MID, fontSize: 8, letterSpacing: 2.4, marginBottom: 4 },
  grupoTitulo: { color: "#ffffff", fontSize: 19, fontFamily: "Helvetica-Bold" },
  grupoLista: { color: "#c9ecec", fontSize: 9, marginTop: 6, lineHeight: 1.5 },

  seccion: { marginBottom: 16 },
  seccionHead: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderBottomWidth: 1.6, borderBottomColor: TEAL, paddingBottom: 6, marginBottom: 7,
  },
  seccionBarra: { width: 5, height: 17, backgroundColor: TEAL, borderRadius: 2 },
  seccionTitulo: { fontSize: 13.5, fontFamily: "Helvetica-Bold", color: INK },
  rutaChip: {
    backgroundColor: TEAL_LIGHT, color: TEAL_DEEP, borderRadius: 999,
    paddingVertical: 2.5, paddingHorizontal: 8, fontSize: 7.5,
  },
  quien: { fontSize: 8, color: MUTED },
  metaFila: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 },
  resumen: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 4, lineHeight: 1.45 },
  parrafo: { fontSize: 9, color: SOFT, lineHeight: 1.55, marginBottom: 4 },

  li: { flexDirection: "row", gap: 6, marginBottom: 3.5 },
  liDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: TEAL, marginTop: 4.5 },
  liTxt: { flex: 1, fontSize: 9, color: SOFT, lineHeight: 1.5 },

  paso: { flexDirection: "row", gap: 8, marginBottom: 5 },
  pasoN: {
    width: 15, height: 15, borderRadius: 7.5, backgroundColor: TEAL,
    color: "#ffffff", fontSize: 8.5, fontFamily: "Helvetica-Bold",
    textAlign: "center", paddingTop: 2.5,
  },
  pasoTxt: { flex: 1, fontSize: 9, color: SOFT, lineHeight: 1.5 },
  pasoTit: { fontFamily: "Helvetica-Bold", color: INK },

  tip: {
    flexDirection: "row", gap: 6, backgroundColor: AMBAR_BG, borderWidth: 1,
    borderColor: AMBAR_BORDE, borderRadius: 7, paddingVertical: 6,
    paddingHorizontal: 9, marginBottom: 4,
  },
  tipStar: { color: AMBAR, fontSize: 9, fontFamily: "Helvetica-Bold" },
  tipTxt: { flex: 1, fontSize: 8.5, color: "#92400e", lineHeight: 1.45 },

  /* Figuras */
  figura: {
    borderWidth: 1, borderColor: "#c8cfd8", borderStyle: "dashed",
    borderRadius: 9, padding: 11, marginTop: 8, backgroundColor: "#fbfcfd",
  },
  figTitulo: {
    fontSize: 7.5, fontFamily: "Helvetica-Bold", color: MUTED,
    letterSpacing: 1, marginBottom: 7, textTransform: "uppercase",
  },
  figPie: { fontSize: 8, color: MUTED, marginTop: 7 },
  chipsFila: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  chip: { borderRadius: 999, paddingVertical: 3.5, paddingHorizontal: 9, fontSize: 8.5 },
  flecha: { color: MUTED, fontSize: 9, marginHorizontal: 2, paddingTop: 3.5 },
  kpisFila: { flexDirection: "row", gap: 7 },
  kpi: {
    flex: 1, backgroundColor: "#ffffff", borderWidth: 1, borderColor: BORDER,
    borderTopWidth: 3, borderRadius: 7, paddingVertical: 7, paddingHorizontal: 8,
  },
  kpiLabel: { fontSize: 7, fontFamily: "Helvetica-Bold", color: MUTED, letterSpacing: 0.6 },
  kpiValor: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 2 },
  tablaHead: { flexDirection: "row", backgroundColor: TEAL_LIGHT, borderRadius: 5 },
  tablaTh: { flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold", color: TEAL_DEEP, padding: 5 },
  tablaFila: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDER },
  tablaTd: { flex: 1, fontSize: 8.5, color: SOFT, padding: 5 },
  arbolFila: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  arbolCodo: {
    width: 9, height: 9, borderLeftWidth: 1.5, borderBottomWidth: 1.5,
    borderColor: "#c8cfd8", marginRight: 5, marginTop: -7,
  },
  formulaCaja: {
    backgroundColor: "#ffffff", borderWidth: 1, borderColor: BORDER,
    borderRadius: 7, paddingVertical: 10, paddingHorizontal: 12, alignItems: "center",
  },
  formulaTxt: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  formulaTeal: { color: TEAL_DEEP },
  reglaCaja: {
    flexDirection: "row", gap: 7, backgroundColor: TEAL_LIGHT, borderWidth: 1,
    borderColor: TEAL_MID, borderRadius: 9, padding: 11, marginTop: 8,
  },
  reglaTxt: { flex: 1, fontSize: 9, color: INK, lineHeight: 1.5 },

  /* Flujo de la venta (página propia) */
  flujoPaso: {
    flexDirection: "row", gap: 10, borderWidth: 1, borderColor: BORDER,
    borderRadius: 9, padding: 10, marginBottom: 7, backgroundColor: "#ffffff",
  },
  flujoN: {
    width: 21, height: 21, borderRadius: 10.5, backgroundColor: TEAL,
    color: "#ffffff", fontSize: 10.5, fontFamily: "Helvetica-Bold",
    textAlign: "center", paddingTop: 4,
  },
  flujoTit: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: INK },
  flujoDet: { fontSize: 8.8, color: SOFT, lineHeight: 1.45, marginTop: 1.5 },

  /* Glosario / FAQ */
  glosaItem: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 7,
    paddingVertical: 7, paddingHorizontal: 10, marginBottom: 6,
  },
  glosaTerm: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: TEAL_DEEP },
  glosaDef: { fontSize: 8.8, color: SOFT, lineHeight: 1.5, marginTop: 2 },
  faqQ: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 2 },
  faqA: { fontSize: 8.8, color: SOFT, lineHeight: 1.5 },
});

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerTxt}>AMSODENT · Manual de la Plataforma</Text>
      <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
    </View>
  );
}

/* ── Figuras ─────────────────────────────────────────────────────────────── */

function Chip({ tone = "neutral", children }) {
  const t = TONO[tone] || TONO.neutral;
  return <Text style={[s.chip, { backgroundColor: t.bg, color: t.fg }]}>{children}</Text>;
}

function Figura({ figura }) {
  if (!figura) return null;
  if (figura.tipo === "flujo") {
    return (
      <View style={s.figura} wrap={false}>
        <View style={s.chipsFila}>
          {figura.pasos.map((p, i) => (
            <View key={i} style={{ flexDirection: "row" }}>
              <Chip tone="primary">{p}</Chip>
              {i < figura.pasos.length - 1 && <Text style={s.flecha}>›</Text>}
            </View>
          ))}
        </View>
      </View>
    );
  }
  if (figura.tipo === "chips") {
    return (
      <View style={s.figura} wrap={false}>
        {figura.titulo ? <Text style={s.figTitulo}>{figura.titulo}</Text> : null}
        <View style={s.chipsFila}>
          {figura.items.map((c, i) => <Chip key={i} tone={c.tone}>{c.t}</Chip>)}
        </View>
      </View>
    );
  }
  if (figura.tipo === "kpis") {
    return (
      <View style={s.figura} wrap={false}>
        <View style={s.kpisFila}>
          {figura.items.map((k, i) => {
            const t = TONO[k.tone] || TONO.neutral;
            return (
              <View key={i} style={[s.kpi, { borderTopColor: t.fg }]}>
                <Text style={s.kpiLabel}>{k.label.toUpperCase()}</Text>
                <Text style={[s.kpiValor, { color: t.fg }]}>—</Text>
              </View>
            );
          })}
        </View>
        <Text style={s.figPie}>En la plataforma, los KPIs se abren con clic y muestran sus filas.</Text>
      </View>
    );
  }
  if (figura.tipo === "tabla") {
    return (
      <View style={s.figura} wrap={false}>
        {figura.titulo ? <Text style={s.figTitulo}>{figura.titulo}</Text> : null}
        <View style={s.tablaHead}>
          {figura.cols.map((c, i) => <Text key={i} style={s.tablaTh}>{c}</Text>)}
        </View>
        {figura.rows.map((r, i) => (
          <View key={i} style={s.tablaFila}>
            {r.map((c, j) => <Text key={j} style={s.tablaTd}>{c}</Text>)}
          </View>
        ))}
      </View>
    );
  }
  if (figura.tipo === "arbol-docs") {
    const filas = [
      { n: 0, tone: "primary", t: "Orden de Compra del cliente" },
      { n: 1, tone: "neutral", t: "Guía de despacho (empresa + N° seguimiento)" },
      { n: 1, tone: "neutral", t: "Factura / Boleta" },
      { n: 2, tone: "success", t: "Comprobante de pago · Webpay · Efectivo" },
      { n: 2, tone: "danger", t: "Nota de crédito (resta del saldo)" },
    ];
    return (
      <View style={s.figura} wrap={false}>
        <Text style={s.figTitulo}>El árbol de documentos (montos en neto)</Text>
        {filas.map((f, i) => (
          <View key={i} style={[s.arbolFila, { paddingLeft: f.n * 18 }]}>
            {f.n > 0 ? <View style={s.arbolCodo} /> : null}
            <Chip tone={f.tone}>{f.t}</Chip>
          </View>
        ))}
      </View>
    );
  }
  if (figura.tipo === "regla-oro") {
    return (
      <View style={s.reglaCaja} wrap={false}>
        <Text style={[s.tipStar, { color: TEAL_DEEP }]}>•</Text>
        <Text style={s.reglaTxt}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Regla de oro: </Text>
          sin documento no hay adjudicada. Pública = OC · Particular = boleta/efectivo.{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Adjudicado</Text> = suma de OC (neto) ·{" "}
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Ventas</Text> = suma de guías de despacho (neto).
        </Text>
      </View>
    );
  }
  if (figura.tipo === "formula") {
    return (
      <View style={s.figura} wrap={false}>
        <Text style={s.figTitulo}>La fórmula</Text>
        <View style={s.formulaCaja}>
          <Text style={s.formulaTxt}>
            Comisión = ( <Text style={s.formulaTeal}>Full venta</Text> + <Text style={s.formulaTeal}>Full productividad</Text> ) × <Text style={s.formulaTeal}>×Margen</Text> × <Text style={s.formulaTeal}>×Conversión</Text>
          </Text>
        </View>
        <Text style={s.figPie}>Cada métrica cae en un tramo ("Desde") de las 4 tablas del canal del vendedor.</Text>
      </View>
    );
  }
  return null;
}

/* ── Sección de un módulo ────────────────────────────────────────────────── */

function Seccion({ mod }) {
  return (
    <View style={s.seccion}>
      <View style={s.seccionHead} wrap={false}>
        <View style={s.seccionBarra} />
        <Text style={s.seccionTitulo}>{mod.titulo}</Text>
      </View>
      <View style={s.metaFila} wrap={false}>
        <Text style={s.rutaChip}>{mod.ruta}</Text>
        <Text style={s.quien}>{mod.quien}</Text>
      </View>
      {mod.resumen ? <Text style={s.resumen}>{mod.resumen}</Text> : null}
      {(mod.queEs || []).map((p, i) => <Text key={i} style={s.parrafo}>{p}</Text>)}
      {(mod.funciones || []).map((f, i) => (
        <View key={i} style={s.li} wrap={false}>
          <View style={s.liDot} />
          <Text style={s.liTxt}>{f}</Text>
        </View>
      ))}
      {(mod.pasos || []).map((p, i) => (
        <View key={i} style={s.paso} wrap={false}>
          <Text style={s.pasoN}>{i + 1}</Text>
          <Text style={s.pasoTxt}>
            <Text style={s.pasoTit}>{p.t}. </Text>{p.d}
          </Text>
        </View>
      ))}
      <Figura figura={mod.figura} />
      {(mod.tips || []).length > 0 && (
        <View style={{ marginTop: 7 }}>
          {mod.tips.map((t, i) => (
            <View key={i} style={s.tip} wrap={false}>
              <Text style={s.tipStar}>•</Text>
              <Text style={s.tipTxt}>{t}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/* ── Documento ───────────────────────────────────────────────────────────── */

function ManualDocument({ grupos, flujo, glosario, faq, rolLabel, nombre, logoSrc, fecha }) {
  return (
    <Document
      title="Manual de la Plataforma — Amsodent"
      author="Amsodent Medical Spa"
      subject={`Manual del sistema${rolLabel ? ` · perfil ${rolLabel}` : ""}`}
    >
      {/* Portada */}
      <Page size="A4" style={s.coverPage}>
        <View style={s.coverDecor1} />
        <View style={s.coverDecor2} />
        <View style={s.coverDecor3} />
        <View style={s.coverInner}>
          {logoSrc ? (
            <View style={s.coverLogoCard}><Image src={logoSrc} style={s.coverLogo} /></View>
          ) : (
            <Text style={{ color: "#ffffff", fontSize: 20, fontFamily: "Helvetica-Bold" }}>AMSODENT</Text>
          )}
          <View>
            <Text style={s.coverKicker}>CENTRO DE AYUDA</Text>
            <Text style={s.coverTitle}>Manual de la{"\n"}Plataforma</Text>
            <Text style={s.coverSub}>
              El ciclo comercial completo de Amsodent — de la licitación en Mercado
              Público al cobro de la factura y la comisión — explicado módulo a módulo.
            </Text>
            <View style={s.coverChips}>
              {rolLabel ? <Text style={s.coverChip}>Perfil: {rolLabel}</Text> : null}
              <Text style={s.coverChip}>{fecha}</Text>
            </View>
          </View>
          <Text style={s.coverFoot}>
            Generado desde el Centro de Ayuda para {nombre || "el equipo Amsodent"}.{"\n"}
            Este manual contiene solo los módulos visibles para este perfil. Ante dudas, DamarIA responde en /ayuda.
          </Text>
        </View>
      </Page>

      {/* El ciclo de una venta */}
      <Page size="A4" style={s.page}>
        <View style={s.grupoBanda}>
          <Text style={s.grupoKicker}>ANTES DE EMPEZAR</Text>
          <Text style={s.grupoTitulo}>El ciclo de una venta, en 8 pasos</Text>
          <Text style={s.grupoLista}>
            Todo el sistema gira en torno a este flujo. Cada paso tiene su capítulo en este manual.
          </Text>
        </View>
        {flujo.map((p) => (
          <View key={p.n} style={s.flujoPaso} wrap={false}>
            <Text style={s.flujoN}>{p.n}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.flujoTit}>{p.titulo}</Text>
              <Text style={s.flujoDet}>{p.detalle}</Text>
            </View>
          </View>
        ))}
        <Footer />
      </Page>

      {/* Capítulos por grupo */}
      {grupos.map((g) => (
        <Page key={g.id} size="A4" style={s.page}>
          <View style={s.grupoBanda}>
            <Text style={s.grupoKicker}>CAPÍTULO</Text>
            <Text style={s.grupoTitulo}>{g.titulo}</Text>
            <Text style={s.grupoLista}>{g.modulos.map((m) => m.titulo).join("  ·  ")}</Text>
          </View>
          {g.modulos.map((m) => <Seccion key={m.id} mod={m} />)}
          <Footer />
        </Page>
      ))}

      {/* Glosario */}
      <Page size="A4" style={s.page}>
        <View style={s.grupoBanda}>
          <Text style={s.grupoKicker}>REFERENCIA</Text>
          <Text style={s.grupoTitulo}>Glosario</Text>
        </View>
        {glosario.map((g, i) => (
          <View key={i} style={s.glosaItem} wrap={false}>
            <Text style={s.glosaTerm}>{g.t}</Text>
            <Text style={s.glosaDef}>{g.d}</Text>
          </View>
        ))}
        <Footer />
      </Page>

      {/* FAQ */}
      <Page size="A4" style={s.page}>
        <View style={s.grupoBanda}>
          <Text style={s.grupoKicker}>REFERENCIA</Text>
          <Text style={s.grupoTitulo}>Preguntas frecuentes</Text>
        </View>
        {faq.map((f, i) => (
          <View key={i} style={s.glosaItem} wrap={false}>
            <Text style={s.faqQ}>{f.q}</Text>
            <Text style={s.faqA}>{f.a}</Text>
          </View>
        ))}
        <Footer />
      </Page>
    </Document>
  );
}

/* ── Helper: imagen → data URL (react-pdf no acepta URLs remotas) ────────── */
async function urlToDataUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* Las fuentes estándar del PDF (Helvetica, WinAnsi) no cubren flechas, emojis
   ni símbolos como ≤: se sanea todo el contenido en el punto de entrada para
   poder compartir los textos con la versión web sin romper el render. */
function limpiarTexto(str) {
  return String(str)
    .replace(/→/g, "›")
    .replace(/←/g, "‹")
    .replace(/≤/g, "máx.")
    .replace(/≥/g, "mín.")
    .replace(/[←-⇿⌀-➿⬀-⯿\u{1f000}-\u{1ffff}️]/gu, "")
    .replace(/ {2,}/g, " ");
}
function limpiarProfundo(v) {
  if (typeof v === "string") return limpiarTexto(v);
  if (Array.isArray(v)) return v.map(limpiarProfundo);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpiarProfundo(x)]));
  }
  return v;
}

/* Construye el elemento Document ya saneado (reutilizable para pruebas o para
   adjuntar el PDF sin descargarlo). */
export function crearDocumentoManual(entrada, extras = {}) {
  const { grupos, flujo, glosario, faq, rolLabel, nombre } = limpiarProfundo(entrada);
  return (
    <ManualDocument
      grupos={grupos}
      flujo={flujo}
      glosario={glosario}
      faq={faq}
      rolLabel={rolLabel}
      nombre={nombre}
      logoSrc={extras.logoSrc || null}
      fecha={extras.fecha || ""}
    />
  );
}

/* Genera y descarga el manual en PDF, filtrado por el rol del usuario. */
export async function descargarManualPDF(entrada) {
  const { rolLabel } = entrada;
  const logoSrc = await urlToDataUrl(`${window.location.origin}/logo_superior_ficha.png`);
  const fecha = new Date().toLocaleDateString("es-CL", {
    day: "numeric", month: "long", year: "numeric",
  });
  const blob = await pdf(crearDocumentoManual(entrada, { logoSrc, fecha })).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Manual_Plataforma_Amsodent${rolLabel ? `_${rolLabel.replace(/\s+/g, "_")}` : ""}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
