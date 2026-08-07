// Kit visual compartido de la app: banner superior con degradado de marca
// (mismo teal del web), chips de estadísticas sobre el banner, buscador y
// botones de acción. Todas las pantallas de módulo lo usan para verse como
// una sola aplicación.
import React, { type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import {
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft, Search, type LucideIcon } from 'lucide-react-native';
import { colors } from '../lib/theme';

export function Banner({
  titulo,
  subtitulo,
  Icono,
  derecha,
  children,
  sinVolver = false,
}: {
  titulo: string;
  subtitulo?: string;
  Icono?: LucideIcon;
  derecha?: ReactNode;
  children?: ReactNode;
  sinVolver?: boolean;
}) {
  const router = useRouter();
  return (
    <LinearGradient
      colors={[colors.primary, colors.primaryDark]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={s.banner}
    >
      {/* Círculos decorativos translúcidos */}
      <View pointerEvents="none" style={[s.deco, s.deco1]} />
      <View pointerEvents="none" style={[s.deco, s.deco2]} />
      <View pointerEvents="none" style={[s.deco, s.deco3]} />

      <View style={s.inner}>
        <View style={s.fila}>
          {!sinVolver ? (
            <TouchableOpacity
              style={s.volver}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <ChevronLeft size={21} color="#ffffff" />
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={s.titulo} numberOfLines={1}>
              {titulo}
            </Text>
            {subtitulo ? (
              <Text style={s.subtitulo} numberOfLines={2}>
                {subtitulo}
              </Text>
            ) : null}
          </View>
          {derecha ??
            (Icono ? (
              <View style={s.iconoChip}>
                <Icono size={20} color="#ffffff" />
              </View>
            ) : null)}
        </View>
        {children ? <View style={{ marginTop: 14 }}>{children}</View> : null}
      </View>
    </LinearGradient>
  );
}

// Botón blanco translúcido para la esquina derecha del banner ("+ Nueva", etc).
export function BotonBanner({ texto, onPress }: { texto: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.botonBanner} onPress={onPress} activeOpacity={0.8}>
      <Text style={s.botonBannerText}>{texto}</Text>
    </TouchableOpacity>
  );
}

// Fila de estadísticas dentro del banner.
export function StatsRow({ children }: { children: ReactNode }) {
  return <View style={s.statsRow}>{children}</View>;
}

export function Stat({ valor, label }: { valor: string | number; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValor} numberOfLines={1}>
        {valor}
      </Text>
      <Text style={s.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Buscador blanco, pensado para vivir dentro del banner.
export function Buscador({
  valor,
  onChange,
  placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={s.buscador}>
      <Search size={16} color={colors.textMuted} />
      <TextInput
        style={s.buscadorInput}
        value={valor}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9aa7b4"
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

// Chip de filtro (segmentos bajo el banner).
export function ChipFiltro({
  texto,
  activo,
  onPress,
}: {
  texto: string;
  activo: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[s.chip, activo && s.chipActivo]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={[s.chipText, activo && s.chipTextActivo]}>{texto}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  banner: {
    paddingTop: Platform.OS === 'ios' ? 58 : Platform.OS === 'android' ? 42 : 22,
    paddingBottom: 18,
    paddingHorizontal: 18,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    overflow: 'hidden',
  },
  inner: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  deco: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  deco1: { width: 190, height: 190, top: -80, right: -50 },
  deco2: { width: 110, height: 110, bottom: -46, left: -30 },
  deco3: {
    width: 70,
    height: 70,
    top: 14,
    right: 90,
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  volver: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: { fontSize: 20, fontWeight: '800', color: '#ffffff', letterSpacing: -0.3 },
  subtitulo: { fontSize: 12.5, color: 'rgba(255,255,255,0.82)', marginTop: 2 },
  iconoChip: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonBanner: {
    backgroundColor: '#ffffff',
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  botonBannerText: { color: colors.primaryDark, fontWeight: '800', fontSize: 13 },
  statsRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  statValor: { fontSize: 17, fontWeight: '800', color: '#ffffff' },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 1,
  },
  buscador: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    borderRadius: 13,
    paddingHorizontal: 13,
    shadowColor: '#0f172a',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  buscadorInput: {
    flex: 1,
    paddingVertical: Platform.OS === 'web' ? 11 : 10,
    fontSize: 14,
    color: colors.text,
  },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActivo: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  chipText: { fontSize: 12.5, color: colors.textMuted, fontWeight: '600' },
  chipTextActivo: { color: '#ffffff', fontWeight: '700' },
});
