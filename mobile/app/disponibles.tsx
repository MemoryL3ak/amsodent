import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Disponible } from '../lib/types';
import { cierreVigente, parseCierre } from '../lib/format';
import { colors } from '../lib/theme';
import { Banner, Buscador, ChipFiltro, Stat, StatsRow } from '../components/ui';

const FILTROS = [
  { key: 'pendientes', label: 'Pendientes' },
  { key: 'mias', label: 'Mías' },
  { key: 'no_aplica', label: 'No aplica' },
  { key: 'todas', label: 'Todas' },
] as const;

type FiltroKey = (typeof FILTROS)[number]['key'];

export default function DisponiblesScreen() {
  const { session } = useAuth();
  const currentEmail = (session?.user?.email || '').toLowerCase();

  const [lista, setLista] = useState<Disponible[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<FiltroKey>('pendientes');
  const [procesando, setProcesando] = useState<number | null>(null);

  async function cargar(esRefresh = false) {
    if (esRefresh) setRefrescando(true);
    else setCargando(true);
    setError(null);
    try {
      const data = await api.get('/licitaciones/disponibles');
      setLista(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las postulaciones.');
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return lista.filter((l) => {
      if (l.no_aplica) {
        if (filtro !== 'no_aplica' && filtro !== 'todas') return false;
      } else if (filtro === 'no_aplica') {
        return false;
      }
      if (filtro === 'pendientes' && (l.cargada || l.no_aplica)) return false;
      if (filtro === 'mias' && (l.tomada_por || '').toLowerCase() !== currentEmail) return false;
      if (!q) return true;
      return (
        (l.id_licitacion || '').toLowerCase().includes(q) ||
        (l.datos?.organismo || '').toLowerCase().includes(q) ||
        (l.datos?.region || '').toLowerCase().includes(q)
      );
    });
  }, [lista, busqueda, filtro, currentEmail]);

  async function toggleTomar(row: Disponible) {
    const mia = (row.tomada_por || '').toLowerCase() === currentEmail;
    if (row.tomada_por && !mia) {
      Alert.alert('No disponible', `Ya la tomó ${row.tomada_por}.`);
      return;
    }
    const tomar = !row.tomada_por;
    setProcesando(row.id);
    try {
      await api.put(`/licitaciones/disponibles/${row.id}/tomar`, { tomar });
      setLista((prev) =>
        prev.map((l) =>
          l.id === row.id
            ? { ...l, tomada_por: tomar ? currentEmail : null, tomada_at: tomar ? new Date().toISOString() : null }
            : l,
        ),
      );
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo actualizar la postulación.');
    } finally {
      setProcesando(null);
    }
  }

  async function toggleNoAplica(row: Disponible) {
    const noAplica = !row.no_aplica;
    const ejecutar = async () => {
      setProcesando(row.id);
      try {
        await api.put(`/licitaciones/disponibles/${row.id}/no-aplica`, { noAplica });
        setLista((prev) =>
          prev.map((l) =>
            l.id === row.id
              ? { ...l, no_aplica: noAplica, no_aplica_por: noAplica ? currentEmail : null }
              : l,
          ),
        );
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'No se pudo actualizar la postulación.');
      } finally {
        setProcesando(null);
      }
    };
    if (noAplica) {
      Alert.alert(
        'Marcar «No Aplica»',
        `¿Confirmas que la postulación ${row.id_licitacion || row.id} no aplica?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', style: 'destructive', onPress: ejecutar },
        ],
      );
    } else {
      ejecutar();
    }
  }

  function renderItem({ item }: { item: Disponible }) {
    const mia = (item.tomada_por || '').toLowerCase() === currentEmail;
    const vigente = cierreVigente(item.datos?.cierre);
    const cierre = parseCierre(item.datos?.cierre);
    const ocupada = procesando === item.id;

    return (
      <View style={[styles.card, item.no_aplica && { opacity: 0.6 }]}>
        <View style={styles.cardHeader}>
          <Text style={styles.codigo} numberOfLines={1}>
            {item.id_licitacion || `#${item.id}`}
          </Text>
          {!vigente ? (
            <View style={[styles.pill, { backgroundColor: '#fee2e2' }]}>
              <Text style={[styles.pillText, { color: '#b91c1c' }]}>Vencida</Text>
            </View>
          ) : item.cargada ? (
            <View style={[styles.pill, { backgroundColor: '#dcfce7' }]}>
              <Text style={[styles.pillText, { color: '#15803d' }]}>Cargada</Text>
            </View>
          ) : null}
        </View>

        {item.datos?.organismo ? (
          <Text style={styles.organismo} numberOfLines={2}>
            {item.datos.organismo}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          {item.datos?.region ? <Text style={styles.meta}>{item.datos.region}</Text> : null}
          {item.datos?.monto ? <Text style={styles.metaMonto}>{String(item.datos.monto)}</Text> : null}
        </View>
        {cierre ? (
          <Text style={[styles.meta, !vigente && { color: colors.danger }]}>
            Cierre: {String(item.datos?.cierre || '')}
          </Text>
        ) : null}

        {item.no_aplica ? (
          <Text style={styles.noAplica}>
            No aplica{item.no_aplica_por ? ` · ${item.no_aplica_por}` : ''}
          </Text>
        ) : item.tomada_por ? (
          <Text style={styles.tomada}>
            {mia ? 'Tomada por ti' : `Tomada · ${item.tomada_por}`}
          </Text>
        ) : null}

        <View style={styles.acciones}>
          <TouchableOpacity
            style={[
              styles.accion,
              mia ? styles.accionSecundaria : styles.accionPrimaria,
              (ocupada || item.no_aplica || (!mia && (!!item.tomada_por || !vigente))) && { opacity: 0.5 },
            ]}
            disabled={ocupada || !!item.no_aplica || (!mia && (!!item.tomada_por || !vigente))}
            onPress={() => toggleTomar(item)}
          >
            {ocupada ? (
              <ActivityIndicator size="small" color={mia ? colors.primaryDark : '#fff'} />
            ) : (
              <Text style={[styles.accionText, mia && { color: colors.primaryDark }]}>
                {mia ? 'Liberar' : 'Tomar'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.accion, styles.accionGhost, ocupada && { opacity: 0.5 }]}
            disabled={ocupada}
            onPress={() => toggleNoAplica(item)}
          >
            <Text style={[styles.accionText, { color: colors.warning }]}>
              {item.no_aplica ? 'Restaurar' : 'No aplica'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const stats = {
    pendientes: lista.filter((l) => !l.cargada && !l.no_aplica).length,
    mias: lista.filter((l) => (l.tomada_por || '').toLowerCase() === currentEmail && !l.cargada).length,
    noAplica: lista.filter((l) => l.no_aplica).length,
    total: lista.length,
  };

  return (
    <View style={styles.screen}>
      <Banner
        titulo="Postulaciones Disponibles"
        subtitulo="Licitaciones del portal para tomar"
        Icono={ClipboardList}
      >
        <Buscador valor={busqueda} onChange={setBusqueda} placeholder="Buscar por ID, organismo o región…" />
        <StatsRow>
          <Stat valor={stats.pendientes} label="Pendientes" />
          <Stat valor={stats.mias} label="Mías" />
          <Stat valor={stats.noAplica} label="No aplica" />
          <Stat valor={stats.total} label="Total" />
        </StatsRow>
      </Banner>

      <View style={styles.inner}>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {FILTROS.map((f) => (
            <ChipFiltro key={f.key} texto={f.label} activo={filtro === f.key} onPress={() => setFiltro(f.key)} />
          ))}
        </ScrollView>
      </View>

      {cargando ? (
        <View style={styles.centro}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.centro}>
          <Text style={{ color: colors.danger, textAlign: 'center' }}>{error}</Text>
          <TouchableOpacity style={styles.reintentar} onPress={() => cargar()}>
            <Text style={styles.reintentarText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtradas}
          keyExtractor={(l) => String(l.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} tintColor={colors.primary} />
          }
          ListHeaderComponent={
            <Text style={styles.contador}>
              {filtradas.length} postulación{filtradas.length === 1 ? '' : 'es'}
            </Text>
          }
          ListEmptyComponent={<Text style={styles.vacio}>Sin postulaciones para el filtro.</Text>}
        />
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  buscador: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
  },
  chips: { paddingHorizontal: 16, gap: 8, paddingVertical: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActivo: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12.5, color: colors.textMuted, fontWeight: '600' },
  chipTextActivo: { color: '#fff' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
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
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  codigo: { fontSize: 13.5, fontWeight: '700', color: colors.primaryDark, flexShrink: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
  organismo: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, gap: 8 },
  meta: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  metaMonto: { fontSize: 13, fontWeight: '700', color: colors.text },
  noAplica: { fontSize: 12.5, color: colors.warning, fontWeight: '600', marginTop: 6 },
  tomada: { fontSize: 12.5, color: colors.success, fontWeight: '600', marginTop: 6 },
  acciones: { flexDirection: 'row', gap: 10, marginTop: 12 },
  accion: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 88,
    alignItems: 'center',
  },
  accionPrimaria: { backgroundColor: colors.primary },
  accionSecundaria: { backgroundColor: colors.primaryLight },
  accionGhost: { backgroundColor: '#fef3c7' },
  accionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
