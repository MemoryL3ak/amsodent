import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Bell } from 'lucide-react-native';
import { api } from '../lib/api';
import type { Notificacion } from '../lib/types';
import { fmtFechaHora } from '../lib/format';
import { colors } from '../lib/theme';
import { Banner, BotonBanner } from '../components/ui';

export default function NotificacionesScreen() {
  const router = useRouter();
  const [lista, setLista] = useState<Notificacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar(esRefresh = false) {
    if (esRefresh) setRefrescando(true);
    else setCargando(true);
    setError(null);
    try {
      const data = await api.get('/notificaciones');
      setLista(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar las notificaciones.');
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function abrir(n: Notificacion) {
    if (!n.leida_at) {
      api.post(`/notificaciones/${n.id}/leer`).catch(() => {});
      setLista((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, leida_at: new Date().toISOString() } : x)),
      );
    }
    // El link del web es "/detalle/:id" → en la app corresponde a la pantalla
    // de detalle de cotización.
    const licId = n.metadata?.licitacion_id ?? n.link?.match(/\/detalle\/(\d+)/)?.[1];
    if (licId) router.push(`/cotizacion/${licId}`);
  }

  async function marcarTodas() {
    try {
      await api.post('/notificaciones/leer-todas');
      const ahora = new Date().toISOString();
      setLista((prev) => prev.map((x) => ({ ...x, leida_at: x.leida_at || ahora })));
    } catch {
      // silencioso: se reintenta al refrescar
    }
  }

  const noLeidas = lista.filter((n) => !n.leida_at).length;

  function renderItem({ item }: { item: Notificacion }) {
    const leida = !!item.leida_at;
    return (
      <TouchableOpacity
        style={[styles.card, !leida && styles.cardNoLeida]}
        activeOpacity={0.75}
        onPress={() => abrir(item)}
      >
        <View style={styles.fila}>
          {!leida ? <View style={styles.punto} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={[styles.mensaje, !leida && { fontWeight: '700' }]}>
              {item.mensaje || item.tipo || 'Notificación'}
            </Text>
            <Text style={styles.fecha}>{fmtFechaHora(item.creado_at)}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.screen}>
      <Banner
        titulo="Notificaciones"
        subtitulo={noLeidas > 0 ? `${noLeidas} sin leer` : 'Estás al día'}
        Icono={Bell}
        derecha={noLeidas > 0 ? <BotonBanner texto="Leer todas" onPress={marcarTodas} /> : undefined}
      />
      <View style={styles.inner}>

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
          data={lista}
          keyExtractor={(n) => String(n.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} tintColor={colors.primary} />
          }
          ListEmptyComponent={<Text style={styles.vacio}>No tienes notificaciones.</Text>}
        />
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' },
  marcarTodas: {
    margin: 16,
    marginBottom: 4,
    alignSelf: 'flex-end',
  },
  marcarTodasText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  reintentar: {
    marginTop: 14,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  reintentarText: { color: '#fff', fontWeight: '700' },
  vacio: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 13,
  },
  cardNoLeida: { borderColor: colors.primary, backgroundColor: '#f4fbfb' },
  fila: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  punto: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  mensaje: { fontSize: 13.5, color: colors.text, lineHeight: 19 },
  fecha: { fontSize: 11.5, color: colors.textMuted, marginTop: 4 },
});
