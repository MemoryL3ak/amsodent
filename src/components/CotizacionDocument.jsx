import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";

const BLUE    = "#4b89ac";
const D_BLUE  = "#003366";
const GRAY_BG = "#d9d9d9";
const BORDER  = "#888888";
const WHITE   = "#ffffff";

// Letter: 612 x 792 pt — padding 40
const PAD   = 40;
const W     = 612;
const H     = 792;
const WM    = 340; // watermark

const ITEMS_PAGE1 = 15; // primera página tiene header + info cliente
const ITEMS_REST  = 26; // páginas siguientes

const s = StyleSheet.create({
  page: {
    paddingTop: PAD, paddingBottom: PAD,
    paddingLeft: PAD, paddingRight: PAD,
    fontFamily: "Helvetica",
    backgroundColor: WHITE,
    fontSize: 9,
  },
  watermark: {
    position: "absolute",
    top:  (H - WM) / 2,
    left: (W - WM) / 2,
    width: WM, height: WM,
    opacity: 0.12,
  },

  /* Header */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  logo: { width: 160, height: 52, objectFit: "contain" },
  box: {
    borderWidth: 3, borderColor: BLUE,
    padding: 8, width: 170, alignItems: "center",
  },
  boxTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14, color: "#000", marginTop: 3, marginBottom: 3,
  },
  boxText: { fontSize: 9, color: "#000" },

  /* Fecha */
  fecha: { fontSize: 9, marginBottom: 8 },

  /* Info cliente */
  infoRow: { flexDirection: "row", gap: 16, marginBottom: 8 },
  infoCol: { flex: 1 },
  infoLine: { flexDirection: "row", marginBottom: 3, fontSize: 9 },
  label: { fontFamily: "Helvetica-Bold", color: D_BLUE, marginRight: 2 },

  /* Observaciones */
  obsSection: { marginBottom: 6 },

  /* Tabla */
  tableHeader: {
    flexDirection: "row",
    backgroundColor: GRAY_BG,
    borderWidth: 1, borderColor: BORDER,
  },
  tableRow: {
    flexDirection: "row",
    borderLeftWidth: 1, borderRightWidth: 1,
    borderBottomWidth: 1, borderColor: BORDER,
  },
  tableRowAlt: { backgroundColor: "#f5f5f5" },
  obsRow: {
    flexDirection: "row",
    borderLeftWidth: 1, borderRightWidth: 1,
    borderBottomWidth: 1, borderColor: BORDER,
    backgroundColor: "#fafafa",
  },
  th: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5, padding: 5,
    borderRightWidth: 1, borderColor: BORDER,
  },
  td: {
    fontSize: 8.5, padding: 5,
    borderRightWidth: 1, borderColor: BORDER,
  },

  /* Totales */
  totalesWrap: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
  },
  totalesTable: { width: 210 },
  totalesRow: { flexDirection: "row", marginBottom: 3 },
  totalesLabel: { fontFamily: "Helvetica-Bold", fontSize: 9, width: 110 },
  totalesValue: { fontSize: 9, flex: 1, textAlign: "right" },
  totalesValueBold: { fontFamily: "Helvetica-Bold", fontSize: 9, flex: 1, textAlign: "right" },

  /* Datos bancarios */
  bankWrap: { marginTop: 14, width: "46%" },
  bankTitle: {
    fontFamily: "Helvetica-Bold", fontSize: 8.5,
    textAlign: "center",
    borderWidth: 1, borderColor: BORDER,
    padding: 4, backgroundColor: GRAY_BG,
  },
  bankRow: {
    flexDirection: "row",
    borderLeftWidth: 1, borderRightWidth: 1,
    borderBottomWidth: 1, borderColor: BORDER,
  },
  bankLabel: { fontSize: 8.5, padding: 4, width: 115, fontFamily: "Helvetica-Bold" },
  bankValue: { fontSize: 8.5, padding: 4, flex: 1 },
});

/* Anchos de columna */
const C = { n: 22, sku: 65, fmt: 55, cant: 28, precio: 68, total: 68 };

function TH({ w, flex, last, children }) {
  return (
    <Text style={[s.th, w ? { width: w } : {}, flex ? { flex: 1 } : {}, last ? { borderRightWidth: 0 } : {}]}>
      {children}
    </Text>
  );
}

function TD({ w, flex, last, align, bold, italic, children }) {
  return (
    <Text style={[
      s.td,
      w ? { width: w } : {},
      flex ? { flex: 1 } : {},
      last ? { borderRightWidth: 0 } : {},
      align === "right" ? { textAlign: "right" } : {},
      align === "center" ? { textAlign: "center" } : {},
      bold ? { fontFamily: "Helvetica-Bold" } : {},
      italic ? { fontFamily: "Helvetica-Oblique", color: "#444" } : {},
    ]}>
      {children}
    </Text>
  );
}

function TableHeader() {
  return (
    <View style={s.tableHeader}>
      <TH w={C.n}>N°</TH>
      <TH w={C.sku}>Código</TH>
      <TH flex>Descripción</TH>
      <TH w={C.fmt}>Formato</TH>
      <TH w={C.cant}>Cant.</TH>
      <TH w={C.precio}>Precio Unit.</TH>
      <TH w={C.total} last>Total</TH>
    </View>
  );
}

function ItemRow({ item, idx }) {
  const alt = idx % 2 !== 0;
  return (
    <>
      <View style={[s.tableRow, alt ? s.tableRowAlt : {}]}>
        <TD w={C.n} align="center">{item.n}</TD>
        <TD w={C.sku}>{item.sku}</TD>
        <TD flex>{item.producto}</TD>
        <TD w={C.fmt}>{item.formato}</TD>
        <TD w={C.cant} align="center">{item.cantidad}</TD>
        <TD w={C.precio} align="right">$ {item.precio_unitario}</TD>
        <TD w={C.total} align="right" last>$ {item.total}</TD>
      </View>
      {item.observacion ? (
        <View style={s.obsRow}>
          <TD w={C.n}>{""}</TD>
          <TD w={C.sku}>{""}</TD>
          <TD flex italic last>Observación: {item.observacion}</TD>
        </View>
      ) : null}
    </>
  );
}

function InfoLine({ label, value }) {
  if (!value) return null;
  return (
    <View style={s.infoLine}>
      <Text style={s.label}>{label} </Text>
      <Text>{value}</Text>
    </View>
  );
}

function TotalesRow({ label, value, bold }) {
  return (
    <View style={s.totalesRow}>
      <Text style={s.totalesLabel}>{label}</Text>
      <Text style={bold ? s.totalesValueBold : s.totalesValue}>{value}</Text>
    </View>
  );
}

function BankRow({ label, value }) {
  return (
    <View style={s.bankRow}>
      <Text style={s.bankLabel}>{label}</Text>
      <Text style={s.bankValue}>{value}</Text>
    </View>
  );
}

export function CotizacionDocument({ datos, items, logoSrc, marcaAguaSrc }) {
  // Paginación manual
  const pages = [];
  if (items.length <= ITEMS_PAGE1) {
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
            {/* Marca de agua */}
            {marcaAguaSrc && <Image src={marcaAguaSrc} style={s.watermark} />}

            {/* Header */}
            <View style={s.header}>
              {logoSrc
                ? <Image src={logoSrc} style={s.logo} />
                : <Text style={{ fontSize: 12, fontFamily: "Helvetica-Bold" }}>Amsodent Medical Spa</Text>
              }
              <View style={s.box}>
                <Text style={s.boxText}>R.U.T.: 78.087.954-8</Text>
                <Text style={s.boxTitle}>COTIZACIÓN</Text>
                <Text style={s.boxText}>N° {datos.numero_licitacion}</Text>
              </View>
            </View>

            {/* Página 1: fecha + info cliente + observaciones */}
            {isFirst && (
              <>
                <Text style={s.fecha}>
                  <Text style={s.label}>Fecha Emisión: </Text>
                  {datos.fecha_emision}
                </Text>

                <View style={s.infoRow}>
                  <View style={s.infoCol}>
                    <InfoLine label="SEÑOR(ES):"    value={datos.nombre_entidad} />
                    <InfoLine label="R.U.T.:"       value={datos.rut_entidad} />
                    <InfoLine label="DIRECCIÓN:"    value={datos.direccion} />
                    <InfoLine label="COMUNA:"       value={datos.comuna} />
                    <InfoLine label="COND. VENTA:"  value={datos.condicion_venta} />
                  </View>
                  <View style={s.infoCol}>
                    <InfoLine label="CONTACTO:"   value={datos.contacto} />
                    <InfoLine label="EMAIL:"      value={datos.email} />
                    <InfoLine label="TELÉFONO:"   value={datos.telefono} />
                    <InfoLine label="VENDEDOR:"   value={datos.vendedor_nombre} />
                    <InfoLine label="CORREO:"     value={datos.vendedor_correo} />
                    <InfoLine label="CELULAR:"    value={datos.vendedor_celular} />
                  </View>
                </View>

                {datos.observaciones ? (
                  <View style={s.obsSection}>
                    <Text style={[s.label, { marginBottom: 2 }]}>OBSERVACIONES:</Text>
                    <Text style={{ fontSize: 9 }}>{datos.observaciones}</Text>
                  </View>
                ) : null}
              </>
            )}

            {/* Tabla de ítems */}
            <View>
              <TableHeader />
              {pageItems.map((item, idx) => (
                <ItemRow key={idx} item={item} idx={idx} />
              ))}
            </View>

            {/* Última página: totales + datos bancarios */}
            {isLast && (
              <>
                <View style={s.totalesWrap}>
                  <View style={s.totalesTable}>
                    <TotalesRow label="AFECTO:"     value={`$ ${datos.afecto}`} />
                    <TotalesRow label="I.V.A. 19%:" value={`$ ${datos.iva}`} />
                    <TotalesRow label="TOTAL:"      value={`$ ${datos.total_con_iva}`} bold />
                  </View>
                </View>

                <View style={s.bankWrap}>
                  <Text style={s.bankTitle}>DATOS PARA TRANSFERENCIA BANCARIA</Text>
                  <BankRow label="Banco:"            value="Banco Santander Chile" />
                  <BankRow label="Cuenta Corriente:" value="96608446" />
                  <BankRow label="R.U.T.:"           value="78.087.954-8" />
                  <BankRow label="Empresa:"          value="Amsodent Medical Spa" />
                  <BankRow label="Aviso Email:"      value="contacto@amsodentmedical.cl" />
                </View>
              </>
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
