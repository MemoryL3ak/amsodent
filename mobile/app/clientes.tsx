import { useEffect, useMemo, useState } from 'react';
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
import { ChevronRight, Users } from 'lucide-react-native';
import { api } from '../lib/api';
import type { Cliente } from '../lib/types';
import { colors } from '../lib/theme';
import { Banner, BotonBanner, Buscador, Stat, StatsRow } from '../components/ui';

const AVATAR_COLORES = ['#28aeb1', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#10b981', '#6366f1', '#ec4899'];

function colorDe(texto: string): string {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return AVATAR_COLORES[h % AVATAR_COLORES.length];
}

export default function ClientesScreen() {
  const router = useRouter();
  const [lista, setLista] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');

  async function cargar(esRefresh = false) {
    if (esRefresh) setRefrescando(true);
    else setCargando(true);
    setError(null);
    try {
      const data = await api.get('/clientes');
      setLista(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los clientes.');
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
      total: lista.length,
      publicas: lista.filter((c) => (c.tipo_cliente || '').includes('Pública')).length,
      particulares: lista.filter((c) => (c.tipo_cliente || '').includes('Particular')).length,
    }),
    [lista],
  );

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter(
      (c) =>
        (c.nombre || '').toLowerCase().includes(q) ||
        (c.rut || '').toLowerCase().includes(q) ||
        (c.comuna || '').toLowerCase().includes(q),
    );
  }, [lista, busqueda]);

  function renderItem({ item }: { item: Cliente }) {
    const nombre = item.nombre || 'Sin nombre';
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.75}
        onPress={() => router.push(`/cliente/${item.id}`)}
      >
        <View style={[styles.avatar, { backgroundColor: colorDe(nombre) + '22' }]}>
          <Text style={[styles.avatarText, { color: colorDe(nombre) }]}>
            {nombre.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.nombre} numberOfLines={1}>
            {nombre}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {item.rut || '—'}
            {item.comuna ? `  ·  ${item.comuna}` : ''}
          </Text>
          {item.tipo_cliente ? (
            <View style={styles.tipo}>
              <Text style={styles.tipoText}>{item.tipo_cliente}</Text>
            </View>
          ) : null}
        </View>
        <ChevronRight size={18} color="#b6c2cc" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.screen}>
      <Banner
        titulo="Clientes"
        subtitulo="Cartera comercial y contactos"
        Icono={Users}
        derecha={<BotonBanner texto="+ Nuevo" onPress={() => router.push('/cliente/nuevo')} />}
      >
        <Buscador valor={busqueda} onChange={setBusqueda} placeholder="Buscar por nombre, RUT o comuna…" />
        <StatsRow>
          <Stat valor={stats.total} label="Clientes" />
          <Stat valor={stats.publicas} label="Entidades" />
          <Stat valor={stats.particulares} label="Particulares" />
        </StatsRow>
      </Banner>

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
            data={filtrados}
            keyExtractor={(c) => String(c.id)}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            refreshControl={
              <RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} tintColor={colors.primary} />
            }
            ListHeaderComponent={
              <Text style={styles.contador}>
                {filtrados.length} resultado{filtrados.length === 1 ? '' : 's'}
              </Text>
            }
            ListEmptyComponent={<Text style={styles.vacio}>Sin resultados.</Text>}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '800' },
  nombre: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  tipo: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 5,
  },
  tipoText: { fontSize: 10, fontWeight: '700', color: colors.primaryDark },
});
