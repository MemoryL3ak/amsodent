import { useEffect, useState, type ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FileText } from 'lucide-react-native';
import { api } from '../../lib/api';
import type { Licitacion, LicitacionItem } from '../../lib/types';
import { fmtCLP, fmtFecha } from '../../lib/format';
import { colors, colorEstado } from '../../lib/theme';
import { Banner } from '../../components/ui';

function Dato({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <View style={styles.dato}>
      <Text style={styles.datoLabel}>{label}</Text>
      <Text style={styles.datoValor}>{children ?? '—'}</Text>
    </View>
  );
}

export default function DetalleCotizacionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [lic, setLic] = useState<Licitacion | null>(null);
  const [items, setItems] = useState<LicitacionItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      setCargando(true);
      setError(null);
      try {
        const [l, its] = await Promise.all([
          api.get(`/licitaciones/${id}`),
          api.get(`/licitaciones/${id}/items`).catch(() => []),
        ]);
        if (!activo) return;
        setLic(l);
        setItems(Array.isArray(its) ? its : []);
      } catch (e: any) {
        if (activo) setError(e?.message || 'No se pudo cargar la cotización.');
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
        <Banner titulo={`Cotización #${id}`} Icono={FileText} />
        <View style={styles.centro}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </View>
    );
  }

  if (error || !lic) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Banner titulo={`Cotización #${id}`} Icono={FileText} />
        <View style={styles.centro}>
          <Text style={{ color: colors.danger }}>{error || 'Cotización no encontrada.'}</Text>
        </View>
      </View>
    );
  }

  const c = colorEstado(lic.estado);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Banner
        titulo={`Cotización #${lic.id}`}
        subtitulo={`${lic.id_licitacion || ''}${lic.nombre_entidad ? '  ·  ' + lic.nombre_entidad : ''}`}
        derecha={
          <View style={[styles.estadoBanner, { backgroundColor: '#ffffff' }]}>
            <Text style={[styles.estadoText, { color: c.fg }]}>{lic.estado || '—'}</Text>
          </View>
        }
      >
        <View style={styles.totalesBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.totalBannerLabel}>TOTAL NETO</Text>
            <Text style={styles.totalBannerValor}>{fmtCLP(lic.total_sin_iva)}</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={styles.totalBannerLabel}>TOTAL CON IVA</Text>
            <Text style={styles.totalBannerValor}>{fmtCLP(lic.total_con_iva)}</Text>
          </View>
        </View>
      </Banner>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' }}
    >
      <View style={styles.card}>
        {lic.jerarquia === 'hija' && lic.madre_id ? (
          <Text style={styles.hija}>Cotización Alternativa · Hija de la Cotización #{lic.madre_id}</Text>
        ) : null}

        <View style={styles.grid}>
          <Dato label="Cliente">{lic.nombre_entidad}</Dato>
          <Dato label="RUT">{lic.rut_entidad}</Dato>
          <Dato label="Tipo de cliente">{lic.tipo_cliente}</Dato>
          <Dato label="Comuna">{lic.comuna}</Dato>
          <Dato label="Fecha">{fmtFecha(lic.fecha)}</Dato>
          <Dato label="Adjudicada">{fmtFecha(lic.fecha_adjudicada || lic.fecha_adjudicacion)}</Dato>
          <Dato label="Vendedor">{lic.vendedor_nombre || lic.creado_por}</Dato>
          <Dato label="Condición de venta">{lic.condicion_venta}</Dato>
          <Dato label="Flete estimado">{fmtCLP(lic.flete_estimado)}</Dato>
        </View>

      </View>

      <Text style={styles.seccion}>Ítems ({items.length})</Text>
      {items.length === 0 ? (
        <Text style={styles.vacio}>Sin ítems cargados.</Text>
      ) : (
        items.map((it, i) => (
          <View key={it.id ?? i} style={styles.item}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemNombre} numberOfLines={2}>
                {it.producto || 'Sin nombre'}
              </Text>
              <Text style={styles.itemMeta}>
                {it.sku ? `SKU ${it.sku} · ` : ''}
                {Number(it.cantidad || 0)} × {fmtCLP(it.valor_unitario)}
              </Text>
            </View>
            <Text style={styles.itemTotal}>{fmtCLP(it.total)}</Text>
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
  estadoBanner: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  estadoText: { fontSize: 11.5, fontWeight: '800' },
  totalesBanner: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  totalBannerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 0.4,
  },
  totalBannerValor: { fontSize: 17, fontWeight: '800', color: '#ffffff', marginTop: 1 },
  hija: { fontSize: 12, color: colors.warning, marginBottom: 8, fontWeight: '600' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  dato: { width: '50%', paddingRight: 10 },
  datoLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.textMuted,
  },
  datoValor: { fontSize: 13.5, color: colors.text, marginTop: 2 },
  totales: {
    flexDirection: 'row',
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalValor: { fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 2 },
  seccion: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 20, marginBottom: 10 },
  vacio: { color: colors.textMuted, fontSize: 13 },
  item: {
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
  itemNombre: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  itemTotal: { fontSize: 13.5, fontWeight: '700', color: colors.text },
});
