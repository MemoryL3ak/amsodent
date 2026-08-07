// Creación de cotización — réplica móvil del flujo de CrearLicitacion.jsx del
// web: mismo payload de POST /licitaciones, misma derivación de lista de
// precios por tipo de compra, misma regla de estado por margen (<20% →
// Pendiente Aprobación) y mismo reparto del flete estimado entre unidades.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FilePlus2, Search, Trash2, X } from 'lucide-react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtCLP } from '../../lib/format';
import { colors } from '../../lib/theme';
import { Banner } from '../../components/ui';

type Producto = {
  id: number;
  sku?: string | null;
  nombre?: string | null;
  marca?: string | null;
  categoria?: string | null;
  formato?: string | null;
  estado?: string | null;
  costo?: number | null;
  lista1?: number | null;
  lista2?: number | null;
  lista3?: number | null;
};

type ItemForm = {
  key: string;
  sku: string | null;
  producto: string;
  formato: string;
  categoria: string;
  costo: number;
  precio: number; // precio base editable (sin flete)
  cantidad: number;
};

const TIPOS_CLIENTE = ['Entidad Pública', 'Cliente Particular'] as const;
const TIPOS_COMPRA_PUBLICA = ['Compra ágil', 'Compra directa', 'Licitación 0 a 8 meses', 'Licitación 9 a 24 meses'];
const FACTOR_LISTA_3 = 1.08; // mismo factor de src/lib/listas.js del web

function redondear(n: number): number {
  return Math.round(Number(n) || 0);
}

function soloDigitos(s: string): number {
  const d = String(s || '').replace(/\D/g, '');
  return d ? Number(d) : 0;
}

// Lista derivada del tipo de compra (misma regla del web).
function listadoPara(tipoCompra: string): '1' | '2' | '3' {
  if (tipoCompra === 'Cliente particular') return '1';
  if (tipoCompra === 'Licitación 9 a 24 meses') return '3';
  return '2';
}

function precioBase(p: Producto, listado: '1' | '2' | '3', campanias: Record<string, number>): number {
  const sku = (p.sku || '').trim();
  if (sku && campanias[sku] > 0) return campanias[sku];
  if (listado === '3') {
    const l3 = Number(p.lista3) || 0;
    if (l3 > 0) return l3;
    return redondear((Number(p.lista2) || 0) * FACTOR_LISTA_3);
  }
  return Number(p[`lista${listado}` as 'lista1' | 'lista2']) || 0;
}

export default function NuevaCotizacionScreen() {
  const router = useRouter();
  const { profile } = useAuth();

  // ── Formulario ──
  const [tipoCliente, setTipoCliente] = useState<(typeof TIPOS_CLIENTE)[number]>('Entidad Pública');
  const [idLicitacion, setIdLicitacion] = useState('');
  const [nombre, setNombre] = useState('');
  const [tipoCompra, setTipoCompra] = useState('Compra ágil');
  const [condicionVenta, setCondicionVenta] = useState<'30 días' | 'Contado'>('30 días');
  const [rut, setRut] = useState('');
  const [nombreEntidad, setNombreEntidad] = useState('');
  const [region, setRegion] = useState('');
  const [comuna, setComuna] = useState('');
  const [direccion, setDireccion] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [contacto, setContacto] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [monto, setMonto] = useState('');
  const [fleteEstimado, setFleteEstimado] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [items, setItems] = useState<ItemForm[]>([]);
  const [clienteExiste, setClienteExiste] = useState<boolean | null>(null);
  const [buscandoCliente, setBuscandoCliente] = useState(false);

  // ── Catálogo ──
  const [productos, setProductos] = useState<Producto[]>([]);
  const [campanias, setCampanias] = useState<Record<string, number>>({});
  const [pickerAbierto, setPickerAbierto] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const esParticular = tipoCliente === 'Cliente Particular';
  const listado = listadoPara(tipoCompra);

  useEffect(() => {
    // Catálogo activo + campañas vigentes (la más reciente por SKU gana).
    api
      .get('/productos')
      .then((data) => {
        const activos = (Array.isArray(data) ? data : []).filter((p: Producto) =>
          ['Activo', 'Transitorio'].includes(String(p.estado || '')),
        );
        setProductos(activos);
      })
      .catch(() => {});
    api
      .get('/productos/campaign-prices')
      .then((rows) => {
        const mapa: Record<string, number> = {};
        for (const r of Array.isArray(rows) ? rows : []) {
          const sku = String(r?.sku || '').trim();
          if (sku && !(sku in mapa)) mapa[sku] = Number(r?.precio_campania) || 0;
        }
        setCampanias(mapa);
      })
      .catch(() => {});
  }, []);

  // Cambiar el tipo de cliente ajusta tipo de compra y condición (regla web).
  function cambiarTipoCliente(t: (typeof TIPOS_CLIENTE)[number]) {
    setTipoCliente(t);
    setClienteExiste(null);
    if (t === 'Cliente Particular') {
      setTipoCompra('Cliente particular');
      setCondicionVenta('Contado');
      setIdLicitacion('');
    } else {
      setTipoCompra('Compra ágil');
      setCondicionVenta('30 días');
    }
  }

  async function buscarCliente() {
    const r = rut.trim();
    if (!r) return;
    setBuscandoCliente(true);
    try {
      const c = await api.get(`/clientes?rut=${encodeURIComponent(r)}`);
      if (c) {
        setClienteExiste(true);
        setNombreEntidad(c.nombre || '');
        setRegion(c.region || '');
        setComuna(c.comuna || '');
        setDireccion(c.direccion || '');
        setDepartamento(c.departamento || '');
        setContacto(c.contacto || '');
        setEmail(c.email || '');
        setTelefono(c.telefono || '');
      } else {
        setClienteExiste(false);
      }
    } catch {
      setClienteExiste(null);
    } finally {
      setBuscandoCliente(false);
    }
  }

  // ── Cálculos (mismas fórmulas del web) ──
  const totalCantidades = items.reduce((a, it) => a + (Number(it.cantidad) || 0), 0);
  const fletePorUnidad = totalCantidades > 0 ? redondear(soloDigitos(fleteEstimado) / totalCantidades) : 0;

  const filasCalculadas = useMemo(
    () =>
      items.map((it) => {
        const unitario = redondear(it.precio) + fletePorUnidad;
        return { ...it, unitario, total: redondear(it.cantidad * unitario) };
      }),
    [items, fletePorUnidad],
  );

  const totalNeto = filasCalculadas.reduce((a, f) => a + f.total, 0);
  const totalIva = redondear(totalNeto * 0.19);
  const totalConIva = totalNeto + totalIva;

  const margenGeneral = useMemo(() => {
    const venta = items.reduce((a, it) => a + it.precio * it.cantidad, 0);
    const costo = items.reduce((a, it) => a + (Number(it.costo) || 0) * it.cantidad, 0);
    if (venta <= 0) return 100;
    return ((venta - costo) / venta) * 100;
  }, [items]);

  function agregarProducto(p: Producto) {
    setItems((prev) => [
      ...prev,
      {
        key: `${p.id}-${prev.length}-${p.sku || ''}`,
        sku: (p.sku || '').trim() || null,
        producto: p.nombre || '',
        formato: p.formato || '',
        categoria: p.categoria || '',
        costo: Number(p.costo) || 0,
        precio: precioBase(p, listado, campanias),
        cantidad: 1,
      },
    ]);
    setPickerAbierto(false);
  }

  function actualizarItem(key: string, campo: 'cantidad' | 'precio', valor: string) {
    setItems((prev) =>
      prev.map((it) =>
        it.key === key ? { ...it, [campo]: Math.max(campo === 'cantidad' ? 1 : 0, soloDigitos(valor)) } : it,
      ),
    );
  }

  async function guardar() {
    const creadoPor = (profile?.email || '').trim().toLowerCase();
    if (!creadoPor) {
      setError('No se pudo determinar tu usuario. Reintenta iniciar sesión.');
      return;
    }
    if (!nombre.trim()) return setError('Ingresa el nombre de la cotización.');
    if (!esParticular && !idLicitacion.trim()) return setError('Ingresa el ID de la cotización.');
    if (!rut.trim() || !nombreEntidad.trim()) return setError('Completa el RUT y nombre del cliente.');
    if (items.length === 0) return setError('Agrega al menos un producto.');

    setError(null);
    setGuardando(true);
    try {
      // ID duplicado (solo entidad pública, donde el ID lo escribe el usuario).
      if (!esParticular) {
        const dup = await api.get(`/licitaciones?id_licitacion=${encodeURIComponent(idLicitacion.trim())}`);
        if (Array.isArray(dup) && dup.length > 0) {
          setGuardando(false);
          setError(`El ID "${idLicitacion.trim()}" ya existe (cotización #${dup[0].id}).`);
          return;
        }
      }

      const estado = margenGeneral < 20 ? 'Pendiente Aprobación' : 'En espera';
      const idEnviado = esParticular
        ? `__pending_${new Date().getTime()}_${Math.random().toString(36).slice(2, 8)}`
        : idLicitacion.trim();

      const payload: Record<string, unknown> = {
        id_licitacion: idEnviado,
        nombre: nombre.trim(),
        fecha_hora_cierre: null,
        fecha_publicacion_resultados: null,
        monto: soloDigitos(monto),
        lista_precios: Number(listado),
        rut_entidad: rut.trim(),
        nombre_entidad: nombreEntidad.trim(),
        giro: null,
        tipo_cliente: tipoCliente,
        departamento: departamento.trim(),
        municipalidad: '',
        direccion: direccion.trim(),
        sucursal: null,
        tipo_compra: tipoCompra,
        region: region.trim(),
        comuna: comuna.trim(),
        contacto: contacto.trim(),
        email: email.trim(),
        telefono: telefono.trim(),
        condicion_venta: condicionVenta,
        fecha: new Date().toISOString().slice(0, 10),
        creado_por: creadoPor,
        estado,
        madre_id: null,
        jerarquia: 'madre',
        flete_estimado: soloDigitos(fleteEstimado),
        total_con_iva: totalConIva,
        total_sin_iva: totalNeto,
        total_iva: totalIva,
        observaciones: observaciones.trim() || null,
        vendedor_nombre: profile?.nombre || null,
        vendedor_celular: (profile as any)?.celular || null,
        vendedor_correo: profile?.email || null,
      };

      const lic = await api.post('/licitaciones', payload);
      const licId = lic?.id;
      if (!licId) throw new Error('El backend no devolvió el ID de la cotización.');

      // Cliente particular: el ID definitivo es el correlativo interno.
      if (esParticular) {
        await api.put(`/licitaciones/${licId}`, { id_licitacion: String(licId) }).catch(() => {});
      }

      await api.post(`/licitaciones/${licId}/items`, {
        items: filasCalculadas.map((f, idx) => ({
          orden: idx + 1,
          producto: f.producto,
          formato: f.formato,
          cantidad: Math.max(1, Number(f.cantidad) || 1),
          valor_unitario: f.unitario,
          sku: f.sku,
          total: f.total,
          categoria: f.categoria,
          observacion: '',
        })),
      });

      // Cliente nuevo: se registra en la base para futuras cotizaciones
      // (mismo comportamiento del web; si falla no bloquea la cotización).
      if (clienteExiste === false) {
        api
          .post('/clientes', {
            rut: rut.trim(),
            nombre: nombreEntidad.trim(),
            tipo_cliente: tipoCliente,
            region: region.trim(),
            comuna: comuna.trim(),
            direccion: direccion.trim(),
            contacto: contacto.trim(),
            email: email.trim(),
            telefono: telefono.trim(),
          })
          .catch(() => {});
      }

      setGuardando(false);
      if (estado === 'Pendiente Aprobación') {
        Alert.alert(
          'Cotización guardada',
          `Quedó en "Pendiente Aprobación" porque el margen general (${margenGeneral.toFixed(1)}%) es menor a 20%.`,
        );
      }
      router.replace(`/cotizacion/${licId}`);
    } catch (e: any) {
      setGuardando(false);
      setError(e?.message || 'No se pudo guardar la cotización.');
    }
  }

  const tiposCompra = esParticular ? ['Cliente particular'] : TIPOS_COMPRA_PUBLICA;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Banner
        titulo="Nueva Cotización"
        subtitulo="Cliente, productos y totales"
        Icono={FilePlus2}
      >
        <View style={styles.resumenBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.resumenLabel}>TOTAL CON IVA</Text>
            <Text style={styles.resumenValor}>{fmtCLP(totalConIva)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.resumenLabel}>MARGEN</Text>
            <Text style={[styles.resumenValor, items.length > 0 && margenGeneral < 20 && { color: '#ffd7d7' }]}>
              {items.length > 0 ? `${margenGeneral.toFixed(1)}%` : '—'}
            </Text>
          </View>
        </View>
      </Banner>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* ── Tipo y datos generales ── */}
        <View style={styles.card}>
          <Text style={styles.seccion}>Datos generales</Text>

          <Text style={styles.label}>Tipo de Cotización</Text>
          <View style={styles.chipsRow}>
            {TIPOS_CLIENTE.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, tipoCliente === t && styles.chipActivo]}
                onPress={() => cambiarTipoCliente(t)}
              >
                <Text style={[styles.chipText, tipoCliente === t && styles.chipTextActivo]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Campo
            label={esParticular ? 'ID Cotización (automático)' : 'ID Cotización *'}
            valor={esParticular ? 'Se asigna al guardar' : idLicitacion}
            onChange={setIdLicitacion}
            editable={!esParticular}
            placeholder="1234-56-COT25"
          />
          <Campo label="Nombre de la cotización *" valor={nombre} onChange={setNombre} placeholder="Insumos dentales..." />

          <Text style={styles.label}>Tipo de compra</Text>
          <View style={styles.chipsWrap}>
            {tiposCompra.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.chip, tipoCompra === t && styles.chipActivo]}
                onPress={() => setTipoCompra(t)}
              >
                <Text style={[styles.chipText, tipoCompra === t && styles.chipTextActivo]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hint}>Lista de precios: {listado} (según tipo de compra)</Text>

          <Text style={styles.label}>Condición de venta</Text>
          <View style={styles.chipsRow}>
            {(['30 días', 'Contado'] as const).map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, condicionVenta === c && styles.chipActivo]}
                onPress={() => setCondicionVenta(c)}
              >
                <Text style={[styles.chipText, condicionVenta === c && styles.chipTextActivo]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Cliente ── */}
        <View style={styles.card}>
          <Text style={styles.seccion}>Cliente</Text>
          <Text style={styles.label}>RUT *</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={rut}
              onChangeText={(v) => {
                setRut(v);
                setClienteExiste(null);
              }}
              placeholder="76.123.456-7"
              placeholderTextColor="#9aa7b4"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.buscarBtn} onPress={buscarCliente} disabled={buscandoCliente}>
              {buscandoCliente ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Search size={17} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
          {clienteExiste === true ? <Text style={styles.okText}>Cliente encontrado: datos cargados.</Text> : null}
          {clienteExiste === false ? (
            <Text style={styles.warnText}>Cliente no registrado: se creará al guardar.</Text>
          ) : null}

          <Campo label="Nombre / Entidad *" valor={nombreEntidad} onChange={setNombreEntidad} />
          {!esParticular ? <Campo label="Departamento" valor={departamento} onChange={setDepartamento} /> : null}
          <View style={styles.dosCol}>
            <View style={{ flex: 1 }}>
              <Campo label="Región" valor={region} onChange={setRegion} />
            </View>
            <View style={{ flex: 1 }}>
              <Campo label="Comuna" valor={comuna} onChange={setComuna} />
            </View>
          </View>
          <Campo label="Dirección" valor={direccion} onChange={setDireccion} />
          <Campo label="Contacto" valor={contacto} onChange={setContacto} />
          <View style={styles.dosCol}>
            <View style={{ flex: 1 }}>
              <Campo label="Email" valor={email} onChange={setEmail} teclado="email-address" />
            </View>
            <View style={{ flex: 1 }}>
              <Campo label="Teléfono" valor={telefono} onChange={setTelefono} teclado="phone-pad" />
            </View>
          </View>
        </View>

        {/* ── Ítems ── */}
        <View style={styles.card}>
          <View style={styles.seccionRow}>
            <Text style={styles.seccion}>Productos ({items.length})</Text>
            <TouchableOpacity style={styles.agregarBtn} onPress={() => setPickerAbierto(true)}>
              <Text style={styles.agregarBtnText}>+ Agregar</Text>
            </TouchableOpacity>
          </View>

          {filasCalculadas.length === 0 ? (
            <Text style={styles.hint}>Aún no agregas productos.</Text>
          ) : (
            filasCalculadas.map((f) => (
              <View key={f.key} style={styles.item}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemNombre} numberOfLines={2}>
                    {f.producto}
                  </Text>
                  <Text style={styles.itemMeta}>
                    {f.sku ? `SKU ${f.sku} · ` : ''}
                    {f.formato || ''}
                  </Text>
                  <View style={styles.itemInputs}>
                    <View>
                      <Text style={styles.miniLabel}>Cantidad</Text>
                      <TextInput
                        style={styles.inputMini}
                        value={String(f.cantidad)}
                        onChangeText={(v) => actualizarItem(f.key, 'cantidad', v)}
                        keyboardType="number-pad"
                      />
                    </View>
                    <View>
                      <Text style={styles.miniLabel}>Precio unit.</Text>
                      <TextInput
                        style={[styles.inputMini, { minWidth: 90 }]}
                        value={String(f.precio)}
                        onChangeText={(v) => actualizarItem(f.key, 'precio', v)}
                        keyboardType="number-pad"
                      />
                    </View>
                    <View style={{ flex: 1, alignItems: 'flex-end' }}>
                      <Text style={styles.miniLabel}>Total</Text>
                      <Text style={styles.itemTotal}>{fmtCLP(f.total)}</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setItems((prev) => prev.filter((x) => x.key !== f.key))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={{ marginLeft: 6 }}
                >
                  <Trash2 size={17} color={colors.danger} />
                </TouchableOpacity>
              </View>
            ))
          )}

          <View style={styles.dosCol}>
            <View style={{ flex: 1 }}>
              <Campo label="Flete estimado" valor={fleteEstimado} onChange={setFleteEstimado} teclado="number-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Campo label="Monto disponible" valor={monto} onChange={setMonto} teclado="number-pad" placeholder="0" />
            </View>
          </View>
          {fletePorUnidad > 0 ? (
            <Text style={styles.hint}>Flete repartido: +{fmtCLP(fletePorUnidad)} por unidad.</Text>
          ) : null}
          <Campo label="Observaciones" valor={observaciones} onChange={setObservaciones} multiline />

          {/* Totales */}
          <View style={styles.totales}>
            <FilaTotal label="Total neto" valor={fmtCLP(totalNeto)} />
            <FilaTotal label="IVA (19%)" valor={fmtCLP(totalIva)} />
            <FilaTotal label="Total con IVA" valor={fmtCLP(totalConIva)} destacado />
            <FilaTotal
              label="Margen general"
              valor={`${margenGeneral.toFixed(1)}%`}
              alerta={items.length > 0 && margenGeneral < 20}
            />
          </View>
          {items.length > 0 && margenGeneral < 20 ? (
            <Text style={styles.warnText}>Margen bajo 20%: quedará "Pendiente Aprobación".</Text>
          ) : null}
        </View>

        {error ? <Text style={[styles.error, { marginHorizontal: 4 }]}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.guardarBtn, guardando && { opacity: 0.7 }]}
          onPress={guardar}
          disabled={guardando}
          activeOpacity={0.85}
        >
          {guardando ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.guardarBtnText}>Guardar cotización</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Picker de productos ── */}
      <PickerProductos
        visible={pickerAbierto}
        productos={productos}
        listado={listado}
        campanias={campanias}
        onCerrar={() => setPickerAbierto(false)}
        onElegir={agregarProducto}
      />
    </KeyboardAvoidingView>
  );
}

function PickerProductos({
  visible,
  productos,
  listado,
  campanias,
  onCerrar,
  onElegir,
}: {
  visible: boolean;
  productos: Producto[];
  listado: '1' | '2' | '3';
  campanias: Record<string, number>;
  onCerrar: () => void;
  onElegir: (p: Producto) => void;
}) {
  const [q, setQ] = useState('');

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    const base = t
      ? productos.filter((p) =>
          `${p.sku || ''} ${p.nombre || ''} ${p.marca || ''}`.toLowerCase().includes(t),
        )
      : productos;
    return base.slice(0, 80);
  }, [productos, q]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCerrar}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={pickerStyles.header}>
          <Text style={pickerStyles.titulo}>Buscar producto</Text>
          <TouchableOpacity onPress={onCerrar} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', flex: 1 }}>
          <TextInput
            style={pickerStyles.buscador}
            value={q}
            onChangeText={setQ}
            placeholder="SKU, nombre o marca…"
            placeholderTextColor="#9aa7b4"
            autoFocus
            autoCorrect={false}
          />
          <FlatList
            data={filtrados}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 8 }}
            ListEmptyComponent={
              <Text style={{ textAlign: 'center', color: colors.textMuted, marginTop: 30 }}>
                Sin resultados.
              </Text>
            }
            renderItem={({ item: p }) => {
              const precio = precioBase(p, listado, campanias);
              const enCampania = !!(p.sku && campanias[(p.sku || '').trim()] > 0);
              return (
                <TouchableOpacity style={pickerStyles.fila} onPress={() => onElegir(p)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    <Text style={pickerStyles.nombre} numberOfLines={2}>
                      {p.nombre || 'Sin nombre'}
                    </Text>
                    <Text style={pickerStyles.meta}>
                      {p.sku ? `SKU ${p.sku}` : 'Sin SKU'}
                      {p.marca ? ` · ${p.marca}` : ''}
                      {p.formato ? ` · ${p.formato}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[pickerStyles.precio, enCampania && { color: '#b45309' }]}>{fmtCLP(precio)}</Text>
                    {enCampania ? <Text style={pickerStyles.campania}>Campaña</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function Campo({
  label,
  valor,
  onChange,
  placeholder,
  teclado,
  editable = true,
  multiline = false,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  teclado?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  editable?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 13 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !editable && styles.inputDeshabilitado, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        value={valor}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9aa7b4"
        keyboardType={teclado || 'default'}
        editable={editable}
        multiline={multiline}
        autoCapitalize={teclado === 'email-address' ? 'none' : 'sentences'}
        autoCorrect={false}
      />
    </View>
  );
}

function FilaTotal({
  label,
  valor,
  destacado,
  alerta,
}: {
  label: string;
  valor: string;
  destacado?: boolean;
  alerta?: boolean;
}) {
  return (
    <View style={styles.filaTotal}>
      <Text style={[styles.filaTotalLabel, destacado && { fontWeight: '800', color: colors.text }]}>{label}</Text>
      <Text
        style={[
          styles.filaTotalValor,
          destacado && { fontSize: 16, color: colors.primaryDark },
          alerta && { color: colors.danger },
        ]}
      >
        {valor}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(40,174,177,0.13)',
  },
  seccion: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 12 },
  seccionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  label: { fontSize: 12.5, fontWeight: '600', color: colors.text, marginBottom: 6 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 12 },
  okText: { fontSize: 12.5, color: colors.success, marginTop: 6, marginBottom: 10 },
  warnText: { fontSize: 12.5, color: colors.warning, marginTop: 6, marginBottom: 10 },
  error: { color: colors.danger, fontSize: 13.5, marginBottom: 10 },
  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fbfdfd',
  },
  chipActivo: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted },
  chipTextActivo: { color: colors.primaryDark },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14.5,
    color: colors.text,
    backgroundColor: '#fbfdfd',
  },
  inputDeshabilitado: { backgroundColor: '#eef2f4', color: colors.textMuted },
  dosCol: { flexDirection: 'row', gap: 10 },
  buscarBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agregarBtn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  agregarBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  itemNombre: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  itemInputs: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'flex-end' },
  miniLabel: { fontSize: 10.5, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 3 },
  inputMini: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 14,
    color: colors.text,
    backgroundColor: '#fbfdfd',
    minWidth: 64,
  },
  itemTotal: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  totales: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 6,
    paddingTop: 10,
    gap: 6,
  },
  filaTotal: { flexDirection: 'row', justifyContent: 'space-between' },
  filaTotalLabel: { fontSize: 13.5, color: colors.textMuted },
  filaTotalValor: { fontSize: 14, fontWeight: '700', color: colors.text },
  guardarBtn: {
    height: 48,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  guardarBtnText: { color: '#fff', fontWeight: '700', fontSize: 15.5 },
  resumenBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resumenLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.4,
  },
  resumenValor: { fontSize: 17, fontWeight: '800', color: '#ffffff', marginTop: 1 },
});

const pickerStyles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  titulo: { fontSize: 16, fontWeight: '800', color: colors.text },
  buscador: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14.5,
    color: colors.text,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  nombre: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  precio: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  campania: { fontSize: 10.5, fontWeight: '700', color: '#b45309', marginTop: 2 },
});
