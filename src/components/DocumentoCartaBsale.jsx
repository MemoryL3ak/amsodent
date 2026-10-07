import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

/* ── Representación impresa en CARTA de un documento de Bsale (2026-10-07) ───
   Pedido de Ariel: tener la opción de imprimir guías, facturas, boletas y
   notas de crédito en formato normal además del térmico. La boleta y la nota
   de débito de la cuenta salen de Bsale en rollo de 80 mm; esto las dibuja en
   hoja carta con los mismos datos (los entrega /bsale/facturas/impresion/:id):
   emisor, recuadro del SII con el folio, receptor, referencias, detalle,
   totales y el timbre electrónico con la resolución y dónde verificar. */

const AZUL = "#1d4f67";
const ROJO = "#c0262d";
const BORDE = "#bfcbd2";
const SUAVE = "#5b6770";
const clp = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-CL")}`;
const fecha = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "—";
};

const s = StyleSheet.create({
  page: { paddingTop: 30, paddingBottom: 34, paddingHorizontal: 34, fontFamily: "Helvetica", fontSize: 9, color: "#1f1f1f" },
  cabecera: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  emisor: { width: 330 },
  razon: { fontSize: 13, fontFamily: "Helvetica-Bold", color: AZUL, marginBottom: 3 },
  linea: { marginBottom: 1.5 },
  recuadro: { width: 190, border: `2 solid ${ROJO}`, paddingVertical: 8, paddingHorizontal: 6, alignItems: "center" },
  recuadroTxt: { color: ROJO, fontFamily: "Helvetica-Bold", fontSize: 11, textAlign: "center", marginBottom: 3 },
  recuadroSii: { color: ROJO, fontSize: 9, textAlign: "center", marginTop: 3 },
  caja: { border: `1 solid ${BORDE}`, borderRadius: 3, padding: 7, marginBottom: 9 },
  fila: { flexDirection: "row", marginBottom: 2 },
  etiqueta: { width: 72, color: SUAVE },
  valor: { flex: 1 },
  tabla: { border: `1 solid ${BORDE}`, borderRadius: 3, marginBottom: 9 },
  th: { flexDirection: "row", backgroundColor: "#eef3f6", borderBottom: `1 solid ${BORDE}`, paddingVertical: 4, paddingHorizontal: 5, fontFamily: "Helvetica-Bold", color: AZUL },
  tr: { flexDirection: "row", borderBottom: `0.5 solid #e3e8eb`, paddingVertical: 3.5, paddingHorizontal: 5 },
  cCod: { width: 70 },
  cDesc: { flex: 1, paddingRight: 6 },
  cCant: { width: 42, textAlign: "right" },
  cPrecio: { width: 70, textAlign: "right" },
  cDesct: { width: 40, textAlign: "right" },
  cTotal: { width: 72, textAlign: "right" },
  pie: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  timbreCaja: { width: 270, alignItems: "center" },
  timbre: { width: 250, maxHeight: 110, objectFit: "contain" },
  timbreTxt: { fontSize: 8, color: SUAVE, textAlign: "center", marginTop: 2 },
  totales: { width: 210, border: `1 solid ${BORDE}`, borderRadius: 3, padding: 7, alignSelf: "flex-start" },
  totalFila: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  totalFinal: { flexDirection: "row", justifyContent: "space-between", borderTop: `1 solid ${BORDE}`, paddingTop: 4, marginTop: 2, fontFamily: "Helvetica-Bold", fontSize: 11, color: AZUL },
  nota: { fontSize: 7.5, color: SUAVE, marginTop: 10, textAlign: "center" },
});

function Fila({ etiqueta, valor }) {
  if (!valor) return null;
  return (
    <View style={s.fila}>
      <Text style={s.etiqueta}>{etiqueta}</Text>
      <Text style={s.valor}>{valor}</Text>
    </View>
  );
}

export function DocumentoCartaBsale({ d }) {
  const e = d.emisor || {};
  const c = d.cliente || {};
  const t = d.totales || {};
  return (
    <Document title={`${d.tipo} N° ${d.numero}`} author={e.razon_social}>
      <Page size="LETTER" style={s.page}>
        <View style={s.cabecera} fixed>
          <View style={s.emisor}>
            <Text style={s.razon}>{e.razon_social}</Text>
            <Text style={s.linea}>Giro: {e.giro}</Text>
            <Text style={s.linea}>{e.direccion}, {e.comuna}</Text>
            <Text style={s.linea}>{e.ciudad}</Text>
          </View>
          <View style={s.recuadro}>
            <Text style={s.recuadroTxt}>R.U.T.: {e.rut}</Text>
            <Text style={s.recuadroTxt}>{d.tipo}</Text>
            <Text style={s.recuadroTxt}>N° {d.numero}</Text>
            <Text style={s.recuadroSii}>S.I.I. - {e.ciudad_sii || e.ciudad}</Text>
          </View>
        </View>

        <View style={s.caja}>
          <Fila etiqueta="Señor(es)" valor={c.razon_social} />
          <Fila etiqueta="R.U.T." valor={c.rut} />
          <Fila etiqueta="Giro" valor={c.giro} />
          <Fila etiqueta="Dirección" valor={[c.direccion, c.comuna, c.ciudad].filter(Boolean).join(", ")} />
          <Fila etiqueta="Fecha emisión" valor={fecha(d.fecha)} />
          {d.vencimiento && d.vencimiento !== d.fecha && <Fila etiqueta="Vencimiento" valor={fecha(d.vencimiento)} />}
          <Fila etiqueta="Forma de pago" valor={d.forma_pago} />
          {d.despacho && <Fila etiqueta="Despacho" valor={[d.despacho.direccion, d.despacho.comuna, d.despacho.ciudad].filter(Boolean).join(", ")} />}
          <Fila etiqueta="Vendedor" valor={d.vendedor} />
        </View>

        {(d.referencias || []).length > 0 && (
          <View style={s.caja}>
            <Text style={{ fontFamily: "Helvetica-Bold", color: AZUL, marginBottom: 3 }}>Referencias</Text>
            {d.referencias.map((r, i) => (
              <Text key={i} style={s.linea}>
                {r.tipo} N° {r.folio}{r.fecha ? ` del ${fecha(r.fecha)}` : ""}{r.razon && r.razon !== r.folio ? ` · ${r.razon}` : ""}
              </Text>
            ))}
          </View>
        )}

        <View style={s.tabla}>
          <View style={s.th} fixed>
            <Text style={s.cCod}>Código</Text>
            <Text style={s.cDesc}>Descripción</Text>
            <Text style={s.cCant}>Cant.</Text>
            <Text style={s.cPrecio}>{d.precios_con_iva ? "Precio" : "P. unitario"}</Text>
            <Text style={s.cDesct}>Desc.</Text>
            <Text style={s.cTotal}>{d.precios_con_iva ? "Total" : "Subtotal"}</Text>
          </View>
          {(d.lineas || []).map((l, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={s.cCod}>{l.codigo || "—"}</Text>
              <Text style={s.cDesc}>{l.descripcion}</Text>
              <Text style={s.cCant}>{Number(l.cantidad).toLocaleString("es-CL")}</Text>
              <Text style={s.cPrecio}>{clp(l.precio_unitario)}</Text>
              <Text style={s.cDesct}>{l.descuento_pct ? `${l.descuento_pct}%` : "—"}</Text>
              <Text style={s.cTotal}>{clp(l.total)}</Text>
            </View>
          ))}
        </View>

        <View style={s.pie} wrap={false}>
          <View style={s.timbreCaja}>
            {d.timbre ? <Image src={d.timbre} style={s.timbre} /> : <Text style={s.timbreTxt}>(Timbre no disponible: imprime el PDF de Bsale)</Text>}
            <Text style={s.timbreTxt}>Timbre Electrónico S.I.I.</Text>
            <Text style={s.timbreTxt}>{d.resolucion} · {d.verificacion}</Text>
          </View>
          <View style={s.totales}>
            {t.neto > 0 && <View style={s.totalFila}><Text>Neto</Text><Text>{clp(t.neto)}</Text></View>}
            {t.exento > 0 && <View style={s.totalFila}><Text>Exento</Text><Text>{clp(t.exento)}</Text></View>}
            {t.iva > 0 && <View style={s.totalFila}><Text>IVA 19%</Text><Text>{clp(t.iva)}</Text></View>}
            <View style={s.totalFinal}><Text>Total</Text><Text>{clp(t.total)}</Text></View>
          </View>
        </View>
        <Text style={s.nota} fixed>Representación impresa en formato carta del documento tributario electrónico emitido en Bsale.</Text>
      </Page>
    </Document>
  );
}
