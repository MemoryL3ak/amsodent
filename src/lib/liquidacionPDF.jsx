import { Document, Page, View, Text, Image, StyleSheet, pdf } from "@react-pdf/renderer";

/* ============================================================================
   Liquidación de remuneraciones — documento PDF
   ----------------------------------------------------------------------------
   Formato de liquidación de sueldo chilena: identificación del trabajador y de
   su previsión, haberes separados en imponibles y no imponibles, descuentos
   legales y otros descuentos, líquido a pagar en número y en palabras, y el
   recibo conforme del artículo 54 del Código del Trabajo.

   Los montos se toman del snapshot `detalle` que el backend guarda al emitir:
   así una liquidación reimpresa meses después muestra exactamente los mismos
   valores, aunque la UF o los topes hayan cambiado.
============================================================================ */

const BLUE_LINE = "#4b89ac";
const BLUE_DARK = "#1d4f67";
const BG_HEADER = "#eef3f6";
const BG_SUAVE = "#f6f9fb";
const BORDER = "#bfcbd2";
const BORDER_SOFT = "#dbe3e8";
const TEXT = "#1f1f1f";
const MUTED = "#5b6b75";
const ROJO = "#9b2c2c";

const EMPRESA = {
  nombre: "Amsodent Medical Spa",
  rut: "78.087.954-8",
  giro: "Venta de Insumos Médicos y Dentales",
  direccion: "1° Mayo 45, San Bernardo",
  telefono: "+56 9 4094 3030",
  email: "ventas@amsodentmedical.cl",
};

const PAD_X = 38;
const PAD_Y = 32;

const s = StyleSheet.create({
  page: {
    paddingTop: PAD_Y,
    paddingBottom: PAD_Y,
    paddingLeft: PAD_X,
    paddingRight: PAD_X,
    fontFamily: "Helvetica",
    backgroundColor: "#ffffff",
    fontSize: 8.5,
    color: TEXT,
  },
  watermark: { position: "absolute", top: 230, left: 76, width: 460, opacity: 0.06 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: BLUE_LINE,
    paddingBottom: 8,
    marginBottom: 10,
  },
  headerLeft: { flexDirection: "row", gap: 10, flex: 1, alignItems: "flex-start" },
  logo: { width: 120, height: 40, objectFit: "contain" },
  empresaNombre: { fontFamily: "Helvetica-Bold", fontSize: 12, color: BLUE_DARK, marginBottom: 2 },
  empresaInfo: { fontSize: 7.5, lineHeight: 1.4, color: MUTED },
  tituloBox: {
    borderWidth: 1.5,
    borderColor: BLUE_LINE,
    paddingVertical: 7,
    paddingHorizontal: 10,
    width: 175,
    alignItems: "center",
  },
  tituloTexto: { fontFamily: "Helvetica-Bold", fontSize: 9.5, color: BLUE_DARK, textAlign: "center" },
  tituloPeriodo: { fontFamily: "Helvetica-Bold", fontSize: 11, color: BLUE_DARK, marginTop: 3 },

  seccion: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: "#ffffff",
    backgroundColor: BLUE_DARK,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 0,
    letterSpacing: 0.4,
  },
  caja: { borderWidth: 1, borderColor: BORDER, borderTopWidth: 0 },

  fichaGrid: { flexDirection: "row", flexWrap: "wrap" },
  fichaCelda: {
    width: "25%",
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRightWidth: 0.5,
    borderRightColor: BORDER_SOFT,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER_SOFT,
  },
  fichaLabel: { fontSize: 6.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.3 },
  fichaValor: { fontSize: 8, fontFamily: "Helvetica-Bold", color: TEXT, marginTop: 1 },

  columnas: { flexDirection: "row", gap: 10, marginTop: 8 },
  columna: { flex: 1 },

  fila: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 2.2,
    paddingHorizontal: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: "#eef2f5",
  },
  filaZebra: { backgroundColor: BG_SUAVE },
  // Sin `flex` ni padding propios: los pone el contenedor. Con `flex: 1` aquí
  // la etiqueta tomaba base 0 en una columna y quedaba encima de su nota.
  filaTexto: { flex: 1, paddingRight: 6 },
  filaLabel: { fontSize: 8, color: TEXT },
  filaNota: { fontSize: 6.5, color: MUTED, marginTop: 0.5 },
  filaMonto: { fontSize: 8, textAlign: "right", minWidth: 62 },

  subtotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3.5,
    paddingHorizontal: 6,
    backgroundColor: BG_HEADER,
    borderTopWidth: 0.5,
    borderTopColor: BORDER,
  },
  subtotalLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BLUE_DARK },
  subtotalMonto: { fontSize: 8, fontFamily: "Helvetica-Bold", color: BLUE_DARK, textAlign: "right" },

  grupo: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: MUTED,
    paddingHorizontal: 6,
    paddingTop: 3.5,
    paddingBottom: 1.5,
    letterSpacing: 0.3,
  },

  totalBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    borderWidth: 1.5,
    borderColor: BLUE_DARK,
    backgroundColor: BG_HEADER,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  totalLabel: { fontFamily: "Helvetica-Bold", fontSize: 11, color: BLUE_DARK, letterSpacing: 0.5 },
  totalMonto: { fontFamily: "Helvetica-Bold", fontSize: 15, color: BLUE_DARK },
  totalLetras: { fontSize: 7, color: MUTED, marginTop: 4, fontStyle: "italic" },

  legal: { fontSize: 6.8, color: MUTED, lineHeight: 1.45, marginTop: 8, textAlign: "justify" },
  observaciones: { fontSize: 6.8, color: MUTED, lineHeight: 1.45, marginTop: 4 },

  firmas: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, gap: 40 },
  firmaCol: { flex: 1, alignItems: "center" },
  firmaImg: { width: 110, height: 30, objectFit: "contain", marginBottom: 2 },
  firmaLinea: { borderTopWidth: 0.8, borderTopColor: "#8c9aa4", width: "100%", paddingTop: 4 },
  firmaNombre: { fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "center" },
  firmaCargo: { fontSize: 7, color: MUTED, textAlign: "center", marginTop: 1 },

  pie: {
    position: "absolute",
    bottom: 16,
    left: PAD_X,
    right: PAD_X,
    fontSize: 6.5,
    color: MUTED,
    borderTopWidth: 0.5,
    borderTopColor: BORDER_SOFT,
    paddingTop: 4,
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

/* ── Formatos ─────────────────────────────────────────────────────────────── */
const clp = (v) => `$${Math.round(Number(v) || 0).toLocaleString("es-CL")}`;
const nn = (v) => Number(v) || 0;

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function periodoLargo(periodo) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(periodo || ""));
  if (!m) return String(periodo || "");
  return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

// El tipo de contrato se guarda en minúscula; en el documento se imprime con
// el nombre formal, y aquí no hay CSS que lo capitalice por nosotros.
const CONTRATOS = {
  indefinido: "Indefinido",
  plazo_fijo: "Plazo Fijo",
  part_time: "Part Time",
  honorarios: "Honorarios",
  reemplazo: "Reemplazo",
};
const tipoContrato = (v) => CONTRATOS[v] || String(v || "").replace(/_/g, " ") || "—";

function fecha(v) {
  if (!v) return "—";
  const d = new Date(String(v).length <= 10 ? `${String(v).slice(0, 10)}T12:00:00` : v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-CL");
}

/* Monto en palabras: la liquidación se firma como recibo, y el recibo conforme
   del art. 54 se escribe con el monto en letras. */
const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
const DECENAS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos"];

function menorAMil(n) {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 20) partes.push(UNIDADES[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      if (r < 30) partes.push(u ? `veinti${UNIDADES[u]}` : "veinte");
      else partes.push(u ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d]);
    }
  }
  return partes.join(" ");
}

function numeroALetras(valor) {
  let n = Math.round(Math.abs(Number(valor) || 0));
  if (n === 0) return "cero pesos";
  const partes = [];
  const millones = Math.floor(n / 1000000);
  n %= 1000000;
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  if (millones) partes.push(millones === 1 ? "un millón" : `${menorAMil(millones)} millones`);
  if (miles) partes.push(miles === 1 ? "mil" : `${menorAMil(miles)} mil`);
  if (resto) partes.push(menorAMil(resto));
  // "uno" apocopa delante de "peso": veintiún pesos, no veintiuno pesos.
  const texto = partes.join(" ").replace(/\buno\b$/, "un").replace(/\bveintiuno\b$/, "veintiún");
  return `${texto} pesos`;
}

/* ── Piezas ───────────────────────────────────────────────────────────────── */
function Celda({ label, valor, ancho = "25%" }) {
  return (
    <View style={[s.fichaCelda, { width: ancho }]}>
      <Text style={s.fichaLabel}>{label}</Text>
      <Text style={s.fichaValor}>{valor || "—"}</Text>
    </View>
  );
}

function Fila({ label, nota, monto, i, negativo }) {
  return (
    <View style={[s.fila, i % 2 === 1 ? s.filaZebra : null]} wrap={false}>
      <View style={s.filaTexto}>
        <Text style={s.filaLabel}>{label}</Text>
        {nota ? <Text style={s.filaNota}>{nota}</Text> : null}
      </View>
      <Text style={[s.filaMonto, negativo ? { color: ROJO } : null]}>{clp(monto)}</Text>
    </View>
  );
}

function Subtotal({ label, monto }) {
  return (
    <View style={s.subtotal}>
      <Text style={s.subtotalLabel}>{label}</Text>
      <Text style={s.subtotalMonto}>{clp(monto)}</Text>
    </View>
  );
}

/* Solo se imprimen las líneas con monto: una liquidación con quince ceros no
   se lee. Las que el trabajador siempre espera ver (sueldo base, AFP, salud)
   se fuerzan con `siempre`. */
function lineas(defs) {
  return defs.filter((d) => d && (d.siempre || Math.abs(nn(d.monto)) > 0));
}

/* ── Una liquidación = una página ─────────────────────────────────────────────
   Se expone como componente propio para poder juntar todas las del período en
   un solo PDF sin duplicar el diseño. */
export function LiquidacionPage({
  liquidacion,
  empleado,
  empresa = EMPRESA,
  logoSrc,
  marcaAguaSrc,
  firmaTrabajador,
  mostrarCostoEmpresa = false,
}) {
  // El snapshot manda; si la liquidación es anterior a esta versión se usan las
  // columnas de la tabla, que traen los mismos nombres.
  const d = { ...(liquidacion || {}), ...(liquidacion?.detalle || {}) };
  const par = d.parametros || {};
  const nombre = `${empleado?.nombre || ""} ${empleado?.apellidos || ""}`.trim() || "—";

  const imponibles = lineas([
    { label: "Sueldo base", nota: `${nn(d.dias_trabajados)} días`, monto: d.sueldo_base, siempre: true },
    { label: "Gratificación legal (art. 50)", monto: d.gratificacion },
    {
      label: "Horas extra",
      nota: nn(d.horas_extra_cantidad)
        ? `${nn(d.horas_extra_cantidad)} h × ${clp(d.horas_extra_valor)} (recargo 50%)`
        : null,
      monto: d.horas_extra,
    },
    { label: "Semana corrida", monto: d.semana_corrida },
    { label: "Aguinaldo", monto: d.aguinaldo },
    { label: "Bonos", monto: d.bonos },
    { label: "Comisiones", monto: d.comisiones },
    { label: "Otros haberes imponibles", monto: d.otros_imponibles },
  ]);

  const noImponibles = lineas([
    { label: "Colación", monto: d.colacion },
    { label: "Movilización", monto: d.movilizacion },
    {
      label: "Asignación familiar",
      nota: nn(d.cargas_familiares)
        ? `${nn(d.cargas_familiares)} carga(s) · tramo ${d.tramo_asignacion || "—"}`
        : null,
      monto: d.asignacion_familiar,
    },
    { label: "Otros haberes no imponibles", monto: d.otros_no_imponibles },
  ]);

  const legales = lineas([
    {
      label: `Cotización AFP ${empleado?.afp || ""}`.trim(),
      nota: nn(d.afp_tasa) ? `${nn(d.afp_tasa).toFixed(2)}% sobre el imponible` : null,
      monto: d.afp_monto,
      siempre: true,
    },
    {
      label: `Salud ${empleado?.salud || ""}`.trim(),
      nota: nn(d.salud_adicional) ? `7% legal ${clp(d.salud_legal)} + adicional ${clp(d.salud_adicional)}` : "7% legal",
      monto: d.salud_monto,
      siempre: true,
    },
    { label: "Seguro de cesantía (AFC)", nota: "0,6% de cargo del trabajador", monto: d.seguro_cesantia },
    {
      label: "Impuesto único de 2ª categoría",
      nota: nn(d.base_tributable) ? `base tributable ${clp(d.base_tributable)}` : null,
      monto: d.impuesto_unico,
    },
  ]);

  const otros = lineas([
    { label: "APV", nota: d.apv_regimen ? `régimen ${d.apv_regimen}` : null, monto: d.apv },
    { label: "Anticipos", monto: d.anticipos },
    { label: "Préstamos", monto: d.prestamos },
    { label: "Cuota sindical", monto: d.cuota_sindical },
    { label: "Descuento por atrasos", monto: d.descuento_atrasos },
    { label: "Otros descuentos", monto: d.otros_descuentos },
  ]);

  const totalNoImponible =
    nn(d.total_no_imponible) ||
    nn(d.colacion) + nn(d.movilizacion) + nn(d.asignacion_familiar) + nn(d.otros_no_imponibles);
  const totalLegales =
    nn(d.total_descuentos_legales) ||
    nn(d.afp_monto) + nn(d.salud_monto) + nn(d.seguro_cesantia) + nn(d.impuesto_unico);
  const totalOtros = nn(d.total_descuentos) - totalLegales;

  return (
    <Page size="LETTER" style={s.page}>
      {marcaAguaSrc && <Image src={marcaAguaSrc} style={s.watermark} />}

      {/* Encabezado */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          {logoSrc ? (
            <Image src={logoSrc} style={s.logo} />
          ) : (
            <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 13, color: BLUE_DARK }}>Amsodent</Text>
          )}
          <View>
            <Text style={s.empresaNombre}>{empresa.nombre}</Text>
            <View style={s.empresaInfo}>
              <Text>R.U.T.: {empresa.rut}</Text>
              <Text>Giro: {empresa.giro}</Text>
              <Text>{empresa.direccion}</Text>
              <Text>
                {empresa.telefono} · {empresa.email}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.tituloBox}>
          <Text style={s.tituloTexto}>LIQUIDACIÓN DE{"\n"}REMUNERACIONES</Text>
          <Text style={s.tituloPeriodo}>{periodoLargo(d.periodo).toUpperCase()}</Text>
        </View>
      </View>

      {/* Identificación del trabajador */}
      <Text style={s.seccion}>ANTECEDENTES DEL TRABAJADOR</Text>
      <View style={[s.caja, s.fichaGrid]}>
        <Celda label="Nombre" valor={nombre} ancho="37.5%" />
        <Celda label="R.U.T." valor={empleado?.rut} />
        {/* El cargo suele ser la glosa más larga de la ficha: se le da el ancho
            que le falta al R.U.T. para que no se parta en dos líneas. */}
        <Celda label="Cargo" valor={empleado?.cargo} ancho="37.5%" />
        <Celda label="Área" valor={empleado?.area} />
        <Celda label="Fecha de ingreso" valor={fecha(empleado?.fecha_ingreso)} />
        <Celda
          label="Tipo de contrato"
          valor={tipoContrato(empleado?.tipo_contrato)}
        />
        <Celda label="Jornada" valor={`${nn(empleado?.horas_semanales) || 45} h semanales`} />
        <Celda label="A.F.P." valor={empleado?.afp} />
        <Celda label="Institución de salud" valor={empleado?.salud} />
        <Celda
          label="Días trabajados"
          valor={`${nn(d.dias_trabajados)}${nn(d.dias_licencia) ? ` · ${nn(d.dias_licencia)} lic.` : ""}${
            nn(d.dias_ausencia) ? ` · ${nn(d.dias_ausencia)} aus.` : ""
          }`}
        />
        <Celda label="Cargas familiares" valor={String(nn(d.cargas_familiares) || 0)} />
      </View>

      {/* Haberes y descuentos, lado a lado */}
      <View style={s.columnas}>
        <View style={s.columna}>
          <Text style={s.seccion}>HABERES</Text>
          <View style={s.caja}>
            <Text style={s.grupo}>IMPONIBLES</Text>
            {imponibles.map((f, i) => (
              <Fila key={f.label} {...f} i={i} />
            ))}
            <Subtotal label="Total imponible" monto={d.total_imponible} />

            {noImponibles.length > 0 && (
              <>
                <Text style={s.grupo}>NO IMPONIBLES</Text>
                {noImponibles.map((f, i) => (
                  <Fila key={f.label} {...f} i={i} />
                ))}
                <Subtotal label="Total no imponible" monto={totalNoImponible} />
              </>
            )}
            <Subtotal label="TOTAL HABERES" monto={d.total_haberes} />
          </View>
        </View>

        <View style={s.columna}>
          <Text style={s.seccion}>DESCUENTOS</Text>
          <View style={s.caja}>
            <Text style={s.grupo}>LEGALES Y PREVISIONALES</Text>
            {legales.map((f, i) => (
              <Fila key={f.label} {...f} i={i} negativo />
            ))}
            <Subtotal label="Total descuentos legales" monto={totalLegales} />

            {otros.length > 0 && (
              <>
                <Text style={s.grupo}>OTROS DESCUENTOS</Text>
                {otros.map((f, i) => (
                  <Fila key={f.label} {...f} i={i} negativo />
                ))}
                <Subtotal label="Total otros descuentos" monto={totalOtros} />
              </>
            )}
            <Subtotal label="TOTAL DESCUENTOS" monto={d.total_descuentos} />
          </View>
        </View>
      </View>

      {/* Líquido */}
      <View style={s.totalBar}>
        <Text style={s.totalLabel}>LÍQUIDO A PAGAR</Text>
        <Text style={s.totalMonto}>{clp(d.liquido)}</Text>
      </View>
      <Text style={s.totalLetras}>Son: {numeroALetras(d.liquido)}.</Text>

      {/* Aporte del empleador — solo en la copia interna. Va en una sola fila
          de celdas porque es información accesoria: apilarla en cuatro líneas
          empujaba las firmas a una segunda página. */}
      {mostrarCostoEmpresa && (
        <>
          <Text style={[s.seccion, { marginTop: 8 }]}>
            APORTES DE CARGO DEL EMPLEADOR — NO FORMAN PARTE DEL LÍQUIDO
          </Text>
          <View style={[s.caja, s.fichaGrid]}>
            <Celda label="S.I.S." valor={clp(d.aporte_sis)} ancho="20%" />
            <Celda label="A.F.C. empleador" valor={clp(d.aporte_cesantia_empleador)} ancho="20%" />
            <Celda label="Mutual de seguridad" valor={clp(d.aporte_mutual)} ancho="20%" />
            {/* Liquidaciones emitidas antes de la reforma no traen el aporte. */}
            <Celda label="Seguro social" valor={d.aporte_seguro_social != null ? clp(d.aporte_seguro_social) : "—"} ancho="20%" />
            <Celda label="Costo total empresa" valor={clp(d.costo_empresa)} ancho="20%" />
          </View>
        </>
      )}

      {/* Recibo conforme */}
      <Text style={s.legal}>
        Certifico que he recibido de {empresa.nombre}, R.U.T. {empresa.rut}, la suma de {clp(d.liquido)} (
        {numeroALetras(d.liquido)}) por concepto de remuneración correspondiente al mes de{" "}
        {periodoLargo(d.periodo)}, quedando conforme y sin cargo ni cobro posterior alguno que formular por dicho
        período. Los descuentos previsionales y de salud aquí detallados serán enterados en las instituciones
        correspondientes dentro del plazo legal (artículos 54 y 58 del Código del Trabajo).
      </Text>
      {d.observaciones ? (
        <Text style={s.observaciones}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Observaciones: </Text>
          {d.observaciones}
        </Text>
      ) : null}

      <View style={s.firmas} wrap={false}>
        <View style={s.firmaCol}>
          {firmaTrabajador ? <Image src={firmaTrabajador} style={s.firmaImg} /> : <View style={{ height: 30 }} />}
          <View style={s.firmaLinea}>
            <Text style={s.firmaNombre}>{nombre}</Text>
            <Text style={s.firmaCargo}>R.U.T. {empleado?.rut || "—"} · Trabajador</Text>
          </View>
        </View>
        <View style={s.firmaCol}>
          <View style={{ height: 30 }} />
          <View style={s.firmaLinea}>
            <Text style={s.firmaNombre}>{empresa.nombre}</Text>
            <Text style={s.firmaCargo}>R.U.T. {empresa.rut} · Empleador</Text>
          </View>
        </View>
      </View>

      <View style={s.pie} fixed>
        <Text>
          Valores del período: UF {Number(par.uf || 0).toLocaleString("es-CL")} · UTM{" "}
          {Number(par.utm || 0).toLocaleString("es-CL")} · tope imponible {par.tope_imponible_uf || "—"} UF
        </Text>
        <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
      </View>
    </Page>
  );
}

/* ── Documento de una sola liquidación ────────────────────────────────────── */
export function LiquidacionDocument(props) {
  const nombre = `${props.empleado?.nombre || ""} ${props.empleado?.apellidos || ""}`.trim() || "—";
  return (
    <Document
      title={`Liquidación ${periodoLargo(props.liquidacion?.periodo)} — ${nombre}`}
      author={(props.empresa || EMPRESA).nombre}
      subject="Liquidación de remuneraciones"
    >
      <LiquidacionPage {...props} />
    </Document>
  );
}

/* ── Helper: imagen → data URL (react-pdf no acepta URLs remotas) ─────────── */
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

function nombreArchivo(liquidacion, empleado) {
  const nombre = `${empleado?.nombre || ""}_${empleado?.apellidos || ""}`
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\w-]/g, "");
  return `Liquidacion_${liquidacion?.periodo || ""}_${nombre || liquidacion?.empleado_id || ""}.pdf`;
}

/* Construye el blob del PDF (para adjuntarlo o subirlo sin descargarlo). */
export async function construirLiquidacionPDF({ liquidacion, empleado, mostrarCostoEmpresa = false, firmaTrabajador }) {
  const [logoSrc, marcaAguaSrc] = await Promise.all([
    urlToDataUrl(`${window.location.origin}/logo_superior_ficha.png`),
    urlToDataUrl(`${window.location.origin}/logo_marca_agua.png`),
  ]);
  return pdf(
    <LiquidacionDocument
      liquidacion={liquidacion}
      empleado={empleado}
      logoSrc={logoSrc}
      marcaAguaSrc={marcaAguaSrc}
      firmaTrabajador={firmaTrabajador}
      mostrarCostoEmpresa={mostrarCostoEmpresa}
    />,
  ).toBlob();
}

/* Genera y descarga la liquidación. */
export async function descargarLiquidacionPDF({ liquidacion, empleado, mostrarCostoEmpresa = false, firmaTrabajador }) {
  const blob = await construirLiquidacionPDF({ liquidacion, empleado, mostrarCostoEmpresa, firmaTrabajador });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo(liquidacion, empleado);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* Un solo PDF con las liquidaciones de todo el período (para archivar). */
export async function descargarLibroLiquidacionesPDF({ liquidaciones, empleadosPorId, periodo }) {
  const [logoSrc, marcaAguaSrc] = await Promise.all([
    urlToDataUrl(`${window.location.origin}/logo_superior_ficha.png`),
    urlToDataUrl(`${window.location.origin}/logo_marca_agua.png`),
  ]);
  const blob = await pdf(
    <Document title={`Liquidaciones ${periodo}`} author={EMPRESA.nombre}>
      {liquidaciones.map((l) => (
        <LiquidacionPage
          key={l.id}
          liquidacion={l}
          empleado={empleadosPorId?.get?.(Number(l.empleado_id)) || l}
          logoSrc={logoSrc}
          marcaAguaSrc={marcaAguaSrc}
          mostrarCostoEmpresa
        />
      ))}
    </Document>,
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Liquidaciones_${periodo}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
