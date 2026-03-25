import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";

const TEAL    = "#25b3b3";
const DARK    = "#1a1a1a";
const GRAY    = "#555555";
const BORDER  = "#dddddd";
const WHITE   = "#ffffff";

// A4 en pt: 595.28 x 841.89 — padding 40 cada lado
const WATERMARK_SIZE = 380;

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 40,
    paddingRight: 40,
    fontFamily: "Helvetica",
    backgroundColor: WHITE,
    fontSize: 10,
  },

  /* ── Marca de agua ── */
  watermark: {
    position: "absolute",
    top:  (841 - WATERMARK_SIZE) / 2,
    left: (595 - WATERMARK_SIZE) / 2,
    width: WATERMARK_SIZE,
    height: WATERMARK_SIZE,
    opacity: 0.12,
  },

  /* ── Header ── */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 14,
    borderBottomWidth: 4,
    borderBottomColor: TEAL,
    marginBottom: 20,
  },
  logo: {
    height: 48,
    objectFit: "contain",
  },
  titulo: {
    fontFamily: "Helvetica-Bold",
    fontSize: 22,
    color: TEAL,
    letterSpacing: 1,
  },

  /* ── Producto (imagen + nombre/descripción) ── */
  producto: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  productoImgWrap: {
    width: 130,
    height: 130,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    padding: 8,
    marginRight: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  productoImg: {
    width: 110,
    height: 110,
    objectFit: "contain",
  },
  productoInfo: {
    flex: 1,
  },
  nombre: {
    fontFamily: "Helvetica-Bold",
    fontSize: 17,
    color: DARK,
    marginBottom: 7,
  },
  descripcion: {
    fontSize: 10,
    color: GRAY,
    lineHeight: 1.6,
  },

  /* ── Tabla ── */
  table: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  rowLast: {
    flexDirection: "row",
  },
  th: {
    width: "28%",
    backgroundColor: TEAL,
    padding: 9,
    justifyContent: "flex-start",
  },
  thText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9.5,
    color: WHITE,
  },
  td: {
    flex: 1,
    padding: 9,
  },
  tdText: {
    fontSize: 9.5,
    color: "#333333",
    lineHeight: 1.5,
  },

  /* ── Listas con viñetas ── */
  bulletRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  bullet: {
    width: 10,
    fontSize: 9.5,
    color: "#333333",
    marginTop: 0,
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
    color: "#333333",
    lineHeight: 1.4,
  },

  /* ── Footer ── */
  footer: {
    marginTop: 28,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 8.5,
    color: GRAY,
  },
});

/* ── Helpers ── */
function parseItems(value) {
  const raw = (value ?? "").toString().trim();
  if (!raw) return [];
  return raw.split(/\r?\n|•|;|·/g).map(t => t.trim()).filter(Boolean);
}

function RenderValue({ value }) {
  const items = parseItems(value);
  if (items.length === 0) return <Text style={s.tdText}>—</Text>;
  if (items.length === 1) return <Text style={s.tdText}>{items[0]}</Text>;
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={s.bulletRow}>
          <Text style={s.bullet}>·  </Text>
          <Text style={s.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function TableRow({ label, value, isLast }) {
  return (
    <View style={isLast ? s.rowLast : s.row}>
      <View style={s.th}>
        <Text style={s.thText}>{label}</Text>
      </View>
      <View style={s.td}>
        <RenderValue value={value} />
      </View>
    </View>
  );
}

const FILAS = [
  ["Presentación",    "presentacion"],
  ["Composición",     "composicion"],
  ["Uso / Indicaciones", "uso_indicaciones"],
  ["Beneficios",      "beneficios"],
  ["Modo de Uso",     "modo_uso"],
  ["Almacenamiento",  "almacenamiento"],
  ["Datos Clave",     "datos_clave"],
];

export function FichaTecnicaDocument({ producto, logoSrc, marcaAguaSrc, productoSrc }) {
  const filas = FILAS.filter(([, key]) => {
    const v = (producto[key] ?? "").toString().trim();
    return v.length > 0;
  });

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Marca de agua */}
        {marcaAguaSrc && <Image src={marcaAguaSrc} style={s.watermark} />}

        {/* Header */}
        <View style={s.header}>
          {logoSrc
            ? <Image src={logoSrc} style={s.logo} />
            : <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: TEAL }}>Amsodent Medical</Text>
          }
          <Text style={s.titulo}>FICHA TÉCNICA</Text>
        </View>

        {/* Producto */}
        <View style={s.producto}>
          {productoSrc && (
            <View style={s.productoImgWrap}>
              <Image src={productoSrc} style={s.productoImg} />
            </View>
          )}
          <View style={s.productoInfo}>
            <Text style={s.nombre}>{producto.nombre || "Producto"}</Text>
            {(producto.descripcion ?? "").trim()
              ? <Text style={s.descripcion}>{producto.descripcion}</Text>
              : null
            }
          </View>
        </View>

        {/* Tabla */}
        {filas.length > 0 && (
          <View style={s.table}>
            {filas.map(([label, key], i) => (
              <TableRow
                key={key}
                label={label}
                value={producto[key]}
                isLast={i === filas.length - 1}
              />
            ))}
          </View>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Calle 1 de mayo N.º 45, San Bernardo</Text>
          <Text style={s.footerText}>+56 9 7476 4539</Text>
          <Text style={s.footerText}>jeremias.alarcon@amsodentmedical.cl</Text>
        </View>
      </Page>
    </Document>
  );
}
