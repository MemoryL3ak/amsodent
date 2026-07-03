// OrdenCompraDocument.jsx
// PDF vectorial de la Orden de Compra (react-pdf), con el formato de la marca.
import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";

const BLUE_LINE = "#4b89ac";
const BLUE_DARK = "#1d4f67";
const BG_HEADER = "#eef3f6";
const BORDER_TBL = "#bfcbd2";
const TEXT = "#1f1f1f";

const PAD_X = 40;
const PAD_Y = 36;
const PAGE_W = 612;

const fmtCLP = (v) => `$ ${Number(v || 0).toLocaleString("es-CL")}`;
const padNum = (n) => String(Number(n || 0)).padStart(4, "0");
function fmtFecha(v) {
  if (!v) return "";
  const s = String(v).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

const s = StyleSheet.create({
  page: {
    paddingTop: PAD_Y, paddingBottom: PAD_Y, paddingLeft: PAD_X, paddingRight: PAD_X,
    fontFamily: "Helvetica", backgroundColor: "#fff", fontSize: 9.5, color: TEXT,
  },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: BLUE_DARK, paddingBottom: 12, marginBottom: 14,
  },
  logo: { width: 150, height: 48, objectFit: "contain" },
  ocBox: {
    borderWidth: 1.5, borderColor: BLUE_DARK, borderRadius: 6,
    paddingVertical: 10, paddingHorizontal: 18, minWidth: 190, alignItems: "center",
  },
  ocTitulo: { fontFamily: "Helvetica-Bold", fontSize: 15, color: BLUE_DARK, letterSpacing: 0.5 },
  ocNumero: { fontFamily: "Helvetica-Bold", fontSize: 14, color: BLUE_DARK, marginTop: 3 },

  sectionTitle: { fontFamily: "Helvetica-Bold", color: BLUE_DARK, fontSize: 12.5, marginTop: 14, marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { fontFamily: "Helvetica-Bold", color: BLUE_DARK, width: 110 },
  value: { flex: 1 },
  twoCol: { flexDirection: "row" },
  col: { flex: 1, flexDirection: "row" },

  /* Tabla */
  tHead: { flexDirection: "row", backgroundColor: BG_HEADER, borderWidth: 1, borderColor: BORDER_TBL },
  tRow: { flexDirection: "row", borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: BORDER_TBL },
  th: { fontFamily: "Helvetica-Bold", color: BLUE_DARK, fontSize: 9, padding: 6, textAlign: "center" },
  td: { fontSize: 9, padding: 6, color: TEXT },
  cItem: { width: 38, textAlign: "center" },
  cSku: { width: 78, textAlign: "center" },
  cDesc: { flex: 1 },
  cCant: { width: 60, textAlign: "center" },
  cUnit: { width: 82, textAlign: "right" },
  cTot: { width: 86, textAlign: "right" },

  /* Totales */
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  totalsBox: { width: 250, borderWidth: 1, borderColor: BORDER_TBL, borderRadius: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: BORDER_TBL },
  totalLabel: { fontFamily: "Helvetica-Bold", color: BLUE_DARK },
  totalFinal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, paddingHorizontal: 12, backgroundColor: BG_HEADER },
  totalFinalLabel: { fontFamily: "Helvetica-Bold", color: BLUE_DARK, fontSize: 13 },
  totalFinalValue: { fontFamily: "Helvetica-Bold", color: BLUE_DARK, fontSize: 14 },

  obsBox: { borderWidth: 1, borderColor: BORDER_TBL, borderRadius: 4, padding: 10, marginTop: 16, minHeight: 44 },
  obsTitle: { fontFamily: "Helvetica-Bold", color: BLUE_DARK, fontSize: 10.5, marginBottom: 4 },

  footer: {
    position: "absolute", bottom: 24, left: PAD_X, right: PAD_X,
    borderTopWidth: 1, borderTopColor: BLUE_LINE, paddingTop: 8,
    textAlign: "center", color: BLUE_LINE, fontSize: 9, fontFamily: "Helvetica-Oblique",
  },
});

export function OrdenCompraDocument({ oc, logoSrc }) {
  const items = Array.isArray(oc?.items) ? oc.items : [];
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          {logoSrc ? <Image src={logoSrc} style={s.logo} /> : <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 18, color: BLUE_DARK }}>Amsodent</Text>}
          <View style={s.ocBox}>
            <Text style={s.ocTitulo}>ORDEN DE COMPRA</Text>
            <Text style={s.ocNumero}>#{padNum(oc?.numero)}</Text>
          </View>
        </View>

        {/* Fechas */}
        <Text style={s.sectionTitle}>Fechas</Text>
        <View style={s.row}>
          <Text style={s.label}>Fecha de emisión:</Text>
          <Text style={s.value}>{fmtFecha(oc?.fecha_emision)}</Text>
        </View>

        {/* Proveedor */}
        <Text style={s.sectionTitle}>Datos del Proveedor</Text>
        <View style={s.row}><Text style={s.label}>Razón Social:</Text><Text style={s.value}>{oc?.proveedor_razon_social || ""}</Text></View>
        <View style={s.row}><Text style={s.label}>RUT:</Text><Text style={s.value}>{oc?.proveedor_rut || ""}</Text></View>
        <View style={s.row}><Text style={s.label}>Correo:</Text><Text style={s.value}>{oc?.proveedor_correo || ""}</Text></View>

        {/* Vendedor */}
        <Text style={s.sectionTitle}>Datos Vendedor</Text>
        <View style={s.twoCol}>
          <View style={s.col}><Text style={[s.label, { width: 70 }]}>Nombre:</Text><Text style={s.value}>{oc?.vendedor_nombre || ""}</Text></View>
          <View style={s.col}><Text style={[s.label, { width: 60 }]}>Correo:</Text><Text style={s.value}>{oc?.vendedor_correo || ""}</Text></View>
        </View>

        {/* Detalle de productos */}
        <Text style={s.sectionTitle}>Detalle de Productos</Text>
        <View style={s.tHead}>
          <Text style={[s.th, s.cItem]}>Ítem</Text>
          <Text style={[s.th, s.cSku]}>SKU</Text>
          <Text style={[s.th, s.cDesc]}>Descripción</Text>
          <Text style={[s.th, s.cCant]}>Cantidad</Text>
          <Text style={[s.th, s.cUnit]}>Valor Neto Unitario</Text>
          <Text style={[s.th, s.cTot]}>Total Neto</Text>
        </View>
        {items.map((it, i) => (
          <View style={s.tRow} key={i}>
            <Text style={[s.td, s.cItem]}>{i + 1}</Text>
            <Text style={[s.td, s.cSku]}>{it.sku || ""}</Text>
            <Text style={[s.td, s.cDesc]}>{it.descripcion || ""}</Text>
            <Text style={[s.td, s.cCant]}>{Number(it.cantidad || 0).toLocaleString("es-CL")}</Text>
            <Text style={[s.td, s.cUnit]}>{fmtCLP(it.valor_unitario)}</Text>
            <Text style={[s.td, s.cTot]}>{fmtCLP(it.total)}</Text>
          </View>
        ))}

        {/* Totales */}
        <View style={s.totalsWrap}>
          <View style={s.totalsBox}>
            <View style={s.totalRow}><Text style={s.totalLabel}>Subtotal Neto:</Text><Text>{fmtCLP(oc?.subtotal_neto)}</Text></View>
            <View style={s.totalRow}><Text style={s.totalLabel}>IVA (19%):</Text><Text>{fmtCLP(oc?.iva)}</Text></View>
            <View style={s.totalFinal}><Text style={s.totalFinalLabel}>TOTAL:</Text><Text style={s.totalFinalValue}>{fmtCLP(oc?.total)}</Text></View>
          </View>
        </View>

        {/* Observaciones */}
        <View style={s.obsBox}>
          <Text style={s.obsTitle}>OBSERVACIONES</Text>
          <Text>{oc?.observaciones || ""}</Text>
        </View>

        <Text style={s.footer} fixed>Calidad que te acompaña, soluciones que te impulsan.</Text>
      </Page>
    </Document>
  );
}

async function urlToDataUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function generarPDFOrdenCompra(oc) {
  const logoSrc = await urlToDataUrl(`${window.location.origin}/logo_superior_ficha.png`);
  const blob = await pdf(<OrdenCompraDocument oc={oc} logoSrc={logoSrc} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `OC_${padNum(oc?.numero)}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
