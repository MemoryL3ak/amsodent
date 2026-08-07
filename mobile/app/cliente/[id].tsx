import { useEffect, useState, type ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Users } from 'lucide-react-native';
import { api } from '../../lib/api';
import type { Cliente, Contacto } from '../../lib/types';
import { colors } from '../../lib/theme';
import { Banner } from '../../components/ui';

function Dato({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <View style={styles.dato}>
      <Text style={styles.datoLabel}>{label}</Text>
      <Text style={styles.datoValor}>{children ?? '—'}</Text>
    </View>
  );
}

export default function DetalleClienteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      setCargando(true);
      setError(null);
      try {
        const [c, cts] = await Promise.all([
          api.get(`/clientes/${id}`),
          api.get(`/clientes/${id}/contactos`).catch(() => []),
        ]);
        if (!activo) return;
        setCliente(c);
        setContactos(Array.isArray(cts) ? cts : []);
      } catch (e: any) {
        if (activo) setError(e?.message || 'No se pudo cargar el cliente.');
      } finally {
        if (activo) setCargando(false);
      }
    }
    if (id) cargar();
    return () => {
      activo = false;
    };
  }, [id]);

  if (cargando) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Banner titulo="Cliente" Icono={Users} />
        <View style={styles.centro}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </View>
    );
  }

  if (error || !cliente) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Banner titulo="Cliente" Icono={Users} />
        <View style={styles.centro}>
          <Text style={{ color: colors.danger }}>{error || 'Cliente no encontrado.'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <Banner
      titulo={cliente.nombre || 'Cliente'}
      subtitulo={`${cliente.rut || ''}${cliente.tipo_cliente ? '  ·  ' + cliente.tipo_cliente : ''}`}
      Icono={Users}
    />
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' }}
    >
      <View style={styles.card}>
        <View style={styles.grid}>
          <Dato label="RUT">{cliente.rut}</Dato>
          <Dato label="Comuna">{cliente.comuna}</Dato>
          <Dato label="Dirección">{cliente.direccion}</Dato>
          <Dato label="Contacto">{cliente.contacto}</Dato>
          <Dato label="Teléfono">{cliente.telefono}</Dato>
          <Dato label="Email">{cliente.email}</Dato>
        </View>

        <View style={styles.acciones}>
          {cliente.telefono ? (
            <TouchableOpacity
              style={styles.accion}
              onPress={() => Linking.openURL(`tel:${String(cliente.telefono).replace(/\s/g, '')}`)}
            >
              <Text style={styles.accionText}>📞 Llamar</Text>
            </TouchableOpacity>
          ) : null}
          {cliente.email ? (
            <TouchableOpacity
              style={styles.accion}
              onPress={() => Linking.openURL(`mailto:${cliente.email}`)}
            >
              <Text style={styles.accionText}>✉️ Escribir</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Text style={styles.seccion}>Contactos ({contactos.length})</Text>
      {contactos.length === 0 ? (
        <Text style={styles.vacio}>Sin contactos registrados.</Text>
      ) : (
        contactos.map((ct, i) => (
          <View key={ct.id ?? i} style={styles.contacto}>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactoNombre}>{ct.nombre || 'Sin nombre'}</Text>
              {ct.cargo ? <Text style={styles.contactoMeta}>{ct.cargo}</Text> : null}
              {ct.telefono ? <Text style={styles.contactoMeta}>{ct.telefono}</Text> : null}
              {ct.email ? <Text style={styles.contactoMeta}>{ct.email}</Text> : null}
            </View>
            {ct.telefono ? (
              <TouchableOpacity
                style={styles.accionMini}
                onPress={() => Linking.openURL(`tel:${String(ct.telefono).replace(/\s/g, '')}`)}
              >
                <Text style={{ fontSize: 16 }}>📞</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  dato: { width: '50%', paddingRight: 10 },
  datoLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.textMuted,
  },
  datoValor: { fontSize: 13.5, color: colors.text, marginTop: 2 },
  acciones: { flexDirection: 'row', gap: 10, marginTop: 16 },
  accion: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  accionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  accionMini: {
    backgroundColor: colors.primaryLight,
    borderRadius: 10,
    padding: 10,
  },
  seccion: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 20, marginBottom: 10 },
  vacio: { color: colors.textMuted, fontSize: 13 },
  contacto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  contactoNombre: { fontSize: 14, fontWeight: '700', color: colors.text },
  contactoMeta: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
});
