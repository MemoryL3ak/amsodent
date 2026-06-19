import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";

/* Paleta — alineada con CotizacionDocument.jsx */
const BLUE_LINE   = "#4b89ac";
const BLUE_DARK   = "#1d4f67";
const BG_HEADER   = "#eef3f6";
const BORDER_TBL  = "#bfcbd2";
const BORDER_SOFT = "#cdd5db";
const TEXT        = "#1f1f1f";

const PAD_X = 36;
const PAD_Y = 32;
const PAGE_W = 612;
const PAGE_H = 792;

const ITEMS_PAGE1 = 18;
const ITEMS_REST  = 30;

const s = StyleSheet.create({
  page: {
    paddingTop: PAD_Y, paddingBottom: PAD_Y,
    paddingLeft: PAD_X, paddingRight: PAD_X,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    fontSize: 9.5,
    color: TEXT,
  },
  watermark: {
    position: "absolute",
    top: PAGE_H * 0.28,
    left: (PAGE_W - 460) / 2,
    width: 460,
    opacity: 0.22,
  },

  /* Header */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: BLUE_LINE,
    paddingBottom: 8,
    marginBottom: 8,
  },
  headerLeft: { flexDirection: "row", gap: 10, flex: 1, alignItems: "flex-start" },
  logo: { width: 130, height: 42, objectFit: "contain" },
  empresaInfo: { fontSize: 8.5, lineHeight: 1.35, color: TEXT },
  empresaNombre: { fontFamily: "Helvetica-Bold", fontSize: 12.5, color: BLUE_DARK, marginBottom: 2 },

  cotBox: {
    borderWidth: 1.5, borderColor: BLUE_LINE,
    paddingVertical: 8, paddingHorizontal: 10,
    width: 165, alignItems: "center",
    color: BLUE_DARK,
  },
  cotTitulo: { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: BLUE_DARK, textAlign: "center" },
  cotNumero: { fontFamily: "Helvetica-Bold", fontSize: 10, color: BLUE_DARK, marginTop: 4 },

  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    color: BLUE_DARK,
    fontSize: 10.5,
    marginTop: 12,
    marginBottom: 5,
  },

  infoRow: { flexDirection: "row", marginBottom: 3 },
  infoCol: { flexDirection: "row", flex: 1 },
  infoLabel: { fontFamily: "Helvetica-Bold", color: BLUE_DARK, fontSize: 9, width: 70 },
  infoValue: { fontSize: 9, color: TEXT, flex: 1, paddingRight: 10 },

  /* Tabla items */
  table: { borderWidth: 1, borderColor: BORDER_TBL, marginTop: 4 },
  tHeader: {
    flexDirection: "row",
    backgroundColor: BG_HEADER,
    borderBottomWidth: 1,
    borderColor: BORDER_TBL,
  },
  tRow: { flexDirection: "row", borderTopWidth: 1, borderColor: BORDER_SOFT },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: BLUE_DARK,
    paddingVertical: 5, paddingHorizontal: 4,
    borderRightWidth: 1, borderColor: BORDER_TBL,
  },
  td: {
    fontSize: 8.5, color: TEXT,
    paddingVertical: 4, paddingHorizontal: 4,
    borderRightWidth: 1, borderColor: BORDER_SOFT,
  },

  obsBox: {
    borderWidth: 1, borderColor: BORDER_TBL,
    paddingVertical: 8, paddingHorizontal: 10,
    marginTop: 14,
    minHeight: 50,
  },
  obsTitle: {
    fontFamily: "Helvetica-Bold", color: BLUE_DARK,
    fontSize: 9.5, marginBottom: 4, letterSpacing: 0.3,
  },
  obsText: { fontSize: 9, color: TEXT, lineHeight: 1.35 },

  footer: {
    position: "absolute",
    bottom: 18, left: PAD_X, right: PAD_X,
    fontSize: 7.5, color: "#8a98a1", textAlign: "center",
    borderTopWidth: 1, borderColor: BORDER_SOFT, paddingTop: 5,
  },
});

const C = { item: 34, cant: 70 };

function TH({ w, flex, last, align, children }) {
  return (
    <Text style={[
      s.th,
      w ? { width: w } : {},
      flex ? { flex: 1 } : {},
      last ? { borderRightWidth: 0 } : {},
      align === "right" ? { textAlign: "right" } : {},
      align === "center" ? { textAlign: "center" } : {},
    ]}>
      {children}
    </Text>
  );
}

function TD({ w, flex, last, align, bold, children }) {
  return (
    <Text style={[
      s.td,
      w ? { width: w } : {},
      flex ? { flex: 1 } : {},
      last ? { borderRightWidth: 0 } : {},
      align === "right" ? { textAlign: "right" } : {},
      align === "center" ? { textAlign: "center" } : {},
      bold ? { fontFamily: "Helvetica-Bold" } : {},
    ]}>
      {children}
    </Text>
  );
}

function InfoLine({ label, value, labelWidth }) {
  return (
    <View style={s.infoCol}>
      <Text style={[s.infoLabel, labelWidth ? { width: labelWidth } : null]}>{label}</Text>
      <Text style={s.infoValue}>{value || "—"}</Text>
    </View>
  );
}

export function SolicitudCotizacionDocument({ datos, items, logoSrc, marcaAguaSrc }) {
  const pages = [];
  if (items.length === 0) {
    pages.push([]);
  } else if (items.length <= ITEMS_PAGE1) {
    pages.push(items);
  } else {
    pages.push(items.slice(0, ITEMS_PAGE1));
    let rest = items.slice(ITEMS_PAGE1);
    while (rest.length > 0) {
      pages.push(rest.slice(0, ITEMS_REST));
      rest = rest.slice(ITEMS_REST);
    }
  }

  return (
    <Document>
      {pages.map((pageItems, pageIdx) => {
        const isFirst = pageIdx === 0;
        const isLast  = pageIdx === pages.length - 1;
        return (
          <Page key={pageIdx} size="LETTER" style={s.page}>
            {marcaAguaSrc && <Image src={marcaAguaSrc} style={s.watermark} />}

            {/* HEADER */}
            <View style={s.header}>
              <View style={s.headerLeft}>
                {logoSrc
                  ? <Image src={logoSrc} style={s.logo} />
                  : <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 14, color: BLUE_DARK }}>Amsodent</Text>}
                <View style={s.empresaInfo}>
                  <Text style={s.empresaNombre}>Amsodent Medical Spa</Text>
                  <Text>R.U.T.: 78.087.954-8</Text>
                  <Text>Giro: Venta de Insumos Médicos y Dentales</Text>
                  <Text>Matriz: 1° Mayo 45, San Bernardo</Text>
                  <Text>Tel: +56940943030</Text>
                  <Text>Email: ventas@amsodentmedical.cl</Text>
                </View>
              </View>
              <View style={s.cotBox}>
                <Text style={s.cotTitulo}>SOLICITUD DE COTIZACIÓN</Text>
                <Text style={s.cotNumero}>Nº {datos.numero}</Text>
              </View>
            </View>

            {isFirst && (
              <>
                <Text style={s.sectionTitle}>Datos del Cliente</Text>
                <View style={s.infoRow}>
                  <InfoLine label="Señor(es):" value={datos.razon_social} />
                  <InfoLine label="RUT:" value={datos.rut} />
                </View>
                <View style={s.infoRow}>
                  <InfoLine label="Correo:" value={datos.contacto_email} />
                  <InfoLine label="Teléfono:" value={datos.contacto_telefono} />
                </View>
                <View style={s.infoRow}>
                  <InfoLine label="Fecha:" value={datos.fecha} />
                  <InfoLine label="" value="" />
                </View>

                <Text style={s.sectionTitle}>Productos Solicitados</Text>
              </>
            )}

            {/* TABLA ITEMS */}
            <View style={s.table}>
              <View style={s.tHeader}>
                <TH w={C.item} align="center">Ítem</TH>
                <TH flex>Producto</TH>
                <TH w={C.cant} align="right" last>Cantidad</TH>
              </View>
              {pageItems.map((item, idx) => (
                <View key={idx} style={s.tRow}>
                  <TD w={C.item} align="center" bold>{item.n}</TD>
                  <TD flex>{item.nombre}</TD>
                  <TD w={C.cant} align="right" last>{item.cantidad}</TD>
                </View>
              ))}
            </View>

            {isLast && datos.nota ? (
              <View style={s.obsBox}>
                <Text style={s.obsTitle}>COMENTARIO DEL CLIENTE</Text>
                <Text style={s.obsText}>{datos.nota}</Text>
              </View>
            ) : null}

            <Text style={s.footer} fixed>
              Solicitud generada desde el monitoreo de stock de clientes · Amsodent Medical Spa
            </Text>
          </Page>
        );
      })}
    </Document>
  );
}

/* ── Helper: fetch image → data URL ── */
async function urlToDataUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.onerror   = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/* ── Función pública ──
   solicitud: { id, created_at, items:[{nombre,cantidad,unidad}], nota, contacto_email, contacto_telefono }
   cliente:   { razon_social, rut, fechaTexto }                                        */
export async function generarPDFSolicitud(solicitud, cliente = {}) {
  const [logoSrc, marcaAguaSrc] = await Promise.all([
    urlToDataUrl(`${window.location.origin}/logo_superior_ficha.png`),
    urlToDataUrl(`${window.location.origin}/logo_marca_agua.png`),
  ]);

  const items = (Array.isArray(solicitud?.items) ? solicitud.items : []).map((it, i) => ({
    n: i + 1,
    nombre: `${it.nombre || ""}${it.unidad ? ` (${it.unidad})` : ""}`,
    cantidad: it.cantidad,
  }));

  const datos = {
    numero: solicitud?.id ?? "—",
    razon_social: cliente.razon_social || "",
    rut: cliente.rut || "",
    contacto_email: solicitud?.contacto_email || "",
    contacto_telefono: solicitud?.contacto_telefono || "",
    fecha: cliente.fechaTexto || "",
    nota: solicitud?.nota || "",
  };

  const blob = await pdf(
    <SolicitudCotizacionDocument
      datos={datos}
      items={items}
      logoSrc={logoSrc}
      marcaAguaSrc={marcaAguaSrc}
    />
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = `Solicitud_${datos.numero}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
