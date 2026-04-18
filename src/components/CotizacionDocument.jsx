import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";

/* Paleta — alineada con plantilla_cotizacion.html */
const BLUE_LINE   = "#4b89ac";
const BLUE_DARK   = "#1d4f67";
const BG_HEADER   = "#eef3f6";
const BORDER_TBL  = "#bfcbd2";
const BORDER_SOFT = "#cdd5db";
const TEXT        = "#1f1f1f";

/* Letter: 612 x 792 pt — margen ~35pt */
const PAD_X = 36;
const PAD_Y = 32;
const PAGE_W = 612;
const PAGE_H = 792;
const CONTENT_W = PAGE_W - PAD_X * 2; // 540

const ITEMS_PAGE1 = 12;
const ITEMS_REST  = 24;

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
    width: 150, alignItems: "center",
    color: BLUE_DARK,
  },
  cotTitulo: { fontFamily: "Helvetica-Bold", fontSize: 11, color: BLUE_DARK },
  cotNumero: { fontFamily: "Helvetica-Bold", fontSize: 10, color: BLUE_DARK, marginTop: 4 },

  /* Section title */
  sectionTitle: {
    fontFamily: "Helvetica-Bold",
    color: BLUE_DARK,
    fontSize: 10.5,
    marginTop: 12,
    marginBottom: 5,
  },

  /* Info table (cliente / vendedor / fecha) */
  infoRow: { flexDirection: "row", marginBottom: 3 },
  infoCol: { flexDirection: "row", flex: 1 },
  infoLabel: {
    fontFamily: "Helvetica-Bold",
    color: BLUE_DARK,
    fontSize: 9,
    width: 70,
  },
  infoValue: { fontSize: 9, color: TEXT, flex: 1, paddingRight: 10 },

  /* Tabla items */
  table: { borderWidth: 1, borderColor: BORDER_TBL, marginTop: 4 },
  tHeader: {
    flexDirection: "row",
    backgroundColor: BG_HEADER,
    borderBottomWidth: 1,
    borderColor: BORDER_TBL,
  },
  tRow: {
    flexDirection: "row",
    borderTopWidth: 1, borderColor: BORDER_SOFT,
  },
  tObsRow: {
    flexDirection: "row",
    borderTopWidth: 1, borderColor: BORDER_SOFT,
    backgroundColor: "#fafafa",
  },
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

  /* Bottom row: bank (izq) | totales+obs (der) */
  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 18,
    gap: 14,
  },

  /* Banco */
  bankWrap: { width: 250, borderWidth: 1, borderColor: BORDER_TBL },
  bankHeader: {
    backgroundColor: BG_HEADER,
    paddingVertical: 5,
    fontFamily: "Helvetica-Bold",
    fontSize: 9, color: BLUE_DARK,
    textAlign: "center",
    borderBottomWidth: 1, borderColor: BORDER_TBL,
  },
  bankRow: { flexDirection: "row", borderTopWidth: 1, borderColor: BORDER_SOFT },
  bankRowFirst: { flexDirection: "row" },
  bankLabel: {
    fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 6,
    width: 100, color: TEXT,
    borderRightWidth: 1, borderColor: BORDER_SOFT,
  },
  bankValue: { fontSize: 8.5, paddingVertical: 4, paddingHorizontal: 6, flex: 1, color: TEXT },

  /* Right col (totales + obs) */
  rightCol: { width: 260 },
  totales: {
    borderWidth: 1, borderColor: BORDER_TBL,
  },
  totRow: {
    flexDirection: "row",
    paddingVertical: 5, paddingHorizontal: 8,
  },
  totLabel: {
    fontFamily: "Helvetica-Bold", color: BLUE_DARK,
    fontSize: 9.5, flex: 1,
  },
  totValue: { fontSize: 9.5, color: TEXT, textAlign: "right", width: 100 },
  totLabelBig: {
    fontFamily: "Helvetica-Bold", color: BLUE_DARK,
    fontSize: 11.5, flex: 1,
  },
  totValueBig: {
    fontFamily: "Helvetica-Bold", fontSize: 11.5,
    color: TEXT, textAlign: "right", width: 100,
  },

  obsBox: {
    borderWidth: 1, borderColor: BORDER_TBL,
    paddingVertical: 8, paddingHorizontal: 10,
    marginTop: 10,
    minHeight: 70,
  },
  obsTitle: {
    fontFamily: "Helvetica-Bold", color: BLUE_DARK,
    fontSize: 9.5, marginBottom: 4, letterSpacing: 0.3,
  },
  obsText: { fontSize: 9, color: TEXT, lineHeight: 1.35 },
});

/* Anchos de columna (suman ~CONTENT_W menos bordes) */
const C = { item: 30, sku: 60, fmt: 60, cant: 36, precio: 70, total: 70 };

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

function TD({ w, flex, last, align, italic, bold, children }) {
  return (
    <Text style={[
      s.td,
      w ? { width: w } : {},
      flex ? { flex: 1 } : {},
      last ? { borderRightWidth: 0 } : {},
      align === "right" ? { textAlign: "right" } : {},
      align === "center" ? { textAlign: "center" } : {},
      italic ? { fontFamily: "Helvetica-Oblique", color: "#444" } : {},
      bold ? { fontFamily: "Helvetica-Bold" } : {},
    ]}>
      {children}
    </Text>
  );
}

function TableHeader() {
  return (
    <View style={s.tHeader}>
      <TH w={C.item} align="center">Ítem</TH>
      <TH w={C.sku}>SKU</TH>
      <TH flex>Descripción</TH>
      <TH w={C.fmt}>Formato</TH>
      <TH w={C.cant} align="center">Cant.</TH>
      <TH w={C.precio} align="right">Precio</TH>
      <TH w={C.total} align="right" last>Total</TH>
    </View>
  );
}

function ItemRow({ item }) {
  return (
    <>
      <View style={s.tRow}>
        <TD w={C.item} align="center" bold>{item.n}</TD>
        <TD w={C.sku}>{item.sku}</TD>
        <TD flex>{item.producto}</TD>
        <TD w={C.fmt}>{item.formato}</TD>
        <TD w={C.cant} align="center">{item.cantidad}</TD>
        <TD w={C.precio} align="right">$ {item.precio_unitario}</TD>
        <TD w={C.total} align="right" last>$ {item.total}</TD>
      </View>
      {item.observacion ? (
        <View style={s.tObsRow}>
          <TD w={C.item}>{""}</TD>
          <TD w={C.sku}>{""}</TD>
          <TD flex italic last>Observación: {item.observacion}</TD>
        </View>
      ) : null}
    </>
  );
}

function InfoLine({ label, value }) {
  return (
    <View style={s.infoCol}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value || ""}</Text>
    </View>
  );
}

function BankRow({ label, value, first }) {
  return (
    <View style={first ? s.bankRowFirst : s.bankRow}>
      <Text style={s.bankLabel}>{label}</Text>
      <Text style={s.bankValue}>{value}</Text>
    </View>
  );
}

export function CotizacionDocument({ datos, items, logoSrc, marcaAguaSrc }) {
  // Paginación
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
                <Text style={s.cotTitulo}>COTIZACIÓN</Text>
                <Text style={s.cotNumero}>Nº {datos.numero_licitacion}</Text>
              </View>
            </View>

            {isFirst && (
              <>
                {/* Fecha + ID licitación */}
                <Text style={s.sectionTitle}>Fecha de Emisión</Text>
                <View style={s.infoRow}>
                  <InfoLine label="Fecha:" value={datos.fecha_emision} />
                  <InfoLine label="ID Licitación:" value={datos.id_licitacion} />
                </View>

                {/* Datos del Cliente */}
                <Text style={s.sectionTitle}>Datos del Cliente</Text>
                <View style={s.infoRow}>
                  <InfoLine label="Señor(es):" value={datos.nombre_entidad} />
                  <InfoLine label="Contacto:" value={datos.contacto} />
                </View>
                <View style={s.infoRow}>
                  <InfoLine label="RUT:" value={datos.rut_entidad} />
                  <InfoLine label="Email:" value={datos.email} />
                </View>
                <View style={s.infoRow}>
                  <InfoLine label="Dirección:" value={datos.direccion} />
                  <InfoLine label="Teléfono:" value={datos.telefono} />
                </View>
                <View style={s.infoRow}>
                  <InfoLine label="Comuna:" value={datos.comuna} />
                  <InfoLine label="Cond. Venta:" value={datos.condicion_venta} />
                </View>

                {/* Datos del Vendedor */}
                <Text style={s.sectionTitle}>Datos de Vendedor</Text>
                <View style={s.infoRow}>
                  <InfoLine label="Nombre:" value={datos.vendedor_nombre} />
                  <InfoLine label="Correo:" value={datos.vendedor_correo} />
                </View>
                <View style={s.infoRow}>
                  <InfoLine label="Celular:" value={datos.vendedor_celular} />
                  <InfoLine label="" value="" />
                </View>

                <Text style={s.sectionTitle}>Detalle de Productos</Text>
              </>
            )}

            {/* TABLA ITEMS */}
            <View style={s.table}>
              <TableHeader />
              {pageItems.map((item, idx) => (
                <ItemRow key={idx} item={item} />
              ))}
            </View>

            {/* ÚLTIMA PÁGINA: bank + totales + obs */}
            {isLast && (
              <View style={s.bottomRow}>
                <View style={s.bankWrap}>
                  <Text style={s.bankHeader}>DATOS PARA TRANSFERENCIA BANCARIA</Text>
                  <BankRow label="Banco:" value="Banco Santander Chile" first />
                  <BankRow label="Cuenta Corriente:" value="96608446" />
                  <BankRow label="R.U.T.:" value="78.087.954-8" />
                  <BankRow label="Empresa:" value="Amsodent Medical Spa" />
                  <BankRow label="Aviso Email:" value="contacto@amsodentmedical.cl" />
                </View>

                <View style={s.rightCol}>
                  <View style={s.totales}>
                    <View style={s.totRow}>
                      <Text style={s.totLabel}>Neto:</Text>
                      <Text style={s.totValue}>$ {datos.afecto}</Text>
                    </View>
                    <View style={[s.totRow, { borderTopWidth: 1, borderColor: BORDER_SOFT }]}>
                      <Text style={s.totLabel}>IVA 19%:</Text>
                      <Text style={s.totValue}>$ {datos.iva}</Text>
                    </View>
                    <View style={[s.totRow, { borderTopWidth: 1, borderColor: BORDER_SOFT }]}>
                      <Text style={s.totLabelBig}>TOTAL:</Text>
                      <Text style={s.totValueBig}>$ {datos.total_con_iva}</Text>
                    </View>
                  </View>

                  <View style={s.obsBox}>
                    <Text style={s.obsTitle}>OBSERVACIONES</Text>
                    <Text style={s.obsText}>{datos.observaciones || ""}</Text>
                  </View>
                </View>
              </View>
            )}
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

/* ── Función pública ── */
export async function generarPDFcotizacion(datos) {
  const [logoSrc, marcaAguaSrc] = await Promise.all([
    urlToDataUrl(`${window.location.origin}/logo_superior_ficha.png`),
    urlToDataUrl(`${window.location.origin}/logo_marca_agua.png`),
  ]);

  const { items = [], ...resto } = datos;

  const blob = await pdf(
    <CotizacionDocument
      datos={resto}
      items={items}
      logoSrc={logoSrc}
      marcaAguaSrc={marcaAguaSrc}
    />
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = `Cotizacion_${datos.numero_licitacion}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
