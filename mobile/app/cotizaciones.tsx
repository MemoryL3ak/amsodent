import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FileText } from 'lucide-react-native';
import { api } from '../lib/api';
import type { Licitacion } from '../lib/types';
import { fmtCLP, fmtFecha } from '../lib/format';
import { colors, colorEstado } from '../lib/theme';
import { Banner, BotonBanner, Buscador, ChipFiltro, Stat, StatsRow } from '../components/ui';

const FIELDS =
  'id,id_licitacion,nombre_entidad,rut_entidad,comuna,estado,fecha,tipo_cliente,total_con_iva,creado_por';

const ESTADOS = ['Todas', 'Adjudicada', 'En espera', 'Perdida', 'Descartada', 'Pendiente Aprobación'];

export default function CotizacionesScreen() {
  const router = useRouter();
  const [lista, setLista] = useState<Licitacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('Todas');

  async function cargar(esRefresh = false) {
    if (esRefresh) setRefrescando(true);
    else setCargando(true);
    setError(null);
    try {
      const data = await api.get(`/licitaciones/with-fields?fields=${FIELDS}`);
      setLista(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las cotizaciones.');
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const stats = useMemo(
    () => ({
      total: lista.filter((l) => l.estado !== 'Descartada' && l.estado !== 'Pendiente Aprobación').length,
      adjudicadas: lista.filter((l) => l.estado === 'Adjudicada').length,
      enEspera: lista.filter((l) => l.estado === 'En espera').length,
      perdidas: lista.filter((l) => l.estado === 'Perdida').length,
    }),
    [lista],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lista.filter((l) => {
      if (estado !== 'Todas' && (l.estado || '') !== estado) return false;
      if (!q) return true;
      return (
        String(l.id).includes(q) ||
        (l.id_licitacion || '').toLowerCase().includes(q) ||
        (l.nombre_entidad || '').toLowerCase().includes(q) ||
        (l.rut_entidad || '').toLowerCase().includes(q)
      );
    });
  }, [lista, busqueda, estado]);

  function renderItem({ item }: { item: Licitacion }) {
    const c = colorEstado(item.estado);
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.75}
        onPress={() => router.push(`/cotizacion/${item.id}`)}
      >
        <View style={[styles.borde, { backgroundColor: c.fg }]} />
        <View style={{ flex: 1, padding: 14 }}>
          <View style={styles.cardHeader}>
            <Text style={styles.codigo}>
              #{item.id}
              {item.id_licitacion ? ` · ${item.id_licitacion}` : ''}
            </Text>
            <View style={[styles.estado, { backgroundColor: c.bg }]}>
              <Text style={[styles.estadoText, { color: c.fg }]}>{item.estado || '—'}</Text>
            </View>
          </View>
          <Text style={styles.cliente} numberOfLines={1}>
            {item.nombre_entidad || item.rut_entidad || 'Sin cliente'}
          </Text>
          <View style={styles.cardFooter}>
            <Text style={styles.meta}>
              {fmtFecha(item.fecha)}
              {item.tipo_cliente ? `  ·  ${item.tipo_cliente}` : ''}
            </Text>
            <Text style={styles.monto}>{fmtCLP(item.total_con_iva)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.screen}>
      <Banner
        titulo="Cotizaciones"
        subtitulo="Listado, estado y montos"
        Icono={FileText}
        derecha={<BotonBanner texto="+ Nueva" onPress={() => router.push('/cotizacion/nueva')} />}
      >
        <Buscador valor={busqueda} onChange={setBusqueda} placeholder="Buscar por N°, ID, cliente o RUT…" />
        <StatsRow>
          <Stat valor={stats.total} label="Total" />
          <Stat valor={stats.adjudicadas} label="Adjudicadas" />
          <Stat valor={stats.enEspera} label="En espera" />
          <Stat valor={stats.perdidas} label="Perdidas" />
        </StatsRow>
      </Banner>

      <View style={styles.inner}>
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {ESTADOS.map((e) => (
              <ChipFiltro key={e} texto={e} activo={estado === e} onPress={() => setEstado(e)} />
            ))}
          </ScrollView>
        </View>

        {cargando ? (
          <View style={styles.centro}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.centro}>
            <Text style={styles.error}>{error}</Text>
            <TouchableOpacity style={styles.reintentar} onPress={() => cargar()}>
              <Text style={styles.reintentarText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filtradas}
            keyExtractor={(l) => String(l.id)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, paddingTop: 6, gap: 10 }}
            refreshControl={
              <RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} tintColor={colors.primary} />
            }
            ListEmptyComponent={
              <Text style={styles.vacio}>No hay cotizaciones para el filtro aplicado.</Text>
            }
            ListHeaderComponent={
              <Text style={styles.contador}>
                {filtradas.length} resultado{filtradas.length === 1 ? '' : 's'}
              </Text>
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  chips: { paddingHorizontal: 16, gap: 8, paddingVertical: 12 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: colors.danger, textAlign: 'center', fontSize: 14 },
  reintentar: {
    marginTop: 14,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  reintentarText: { color: '#fff', fontWeight: '700' },
  contador: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  vacio: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontSize: 13 },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  borde: { width: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codigo: { fontSize: 13, fontWeight: '800', color: colors.primaryDark, flexShrink: 1 },
  estado: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, marginLeft: 8 },
  estadoText: { fontSize: 11, fontWeight: '700' },
  cliente: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 6 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  meta: { fontSize: 12, color: colors.textMuted },
  monto: { fontSize: 14.5, fontWeight: '800', color: colors.text },
});
