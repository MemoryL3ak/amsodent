import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Bell,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  FileText,
  LogOut,
  MessagesSquare,
  Users,
} from 'lucide-react-native';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { colors } from '../lib/theme';

// Mismo logo que el login del web.
const LOGO_URL = 'https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png';

type Modulo = {
  route:
    | '/cotizaciones'
    | '/cotizacion/nueva'
    | '/disponibles'
    | '/clientes'
    | '/chat'
    | '/notificaciones';
  permiso: string | null;
  titulo: string;
  descripcion: string;
  color: string;
  Icono: typeof FileText;
};

const MODULOS: Modulo[] = [
  {
    route: '/cotizaciones',
    permiso: 'cotizaciones',
    titulo: 'Cotizaciones',
    descripcion: 'Estado, ítems y montos de tus cotizaciones.',
    color: colors.primary,
    Icono: FileText,
  },
  {
    route: '/cotizacion/nueva',
    permiso: 'crear_cotizacion',
    titulo: 'Nueva Cotización',
    descripcion: 'Crea una cotización con cliente y productos.',
    color: '#10b981',
    Icono: FilePlus2,
  },
  {
    route: '/disponibles',
    permiso: 'cotizaciones',
    titulo: 'Postulaciones Disponibles',
    descripcion: 'Licitaciones del portal: tómalas o marca No Aplica.',
    color: '#f59e0b',
    Icono: ClipboardList,
  },
  {
    route: '/clientes',
    permiso: 'clientes',
    titulo: 'Clientes',
    descripcion: 'Datos comerciales y contactos de tus clientes.',
    color: '#0ea5e9',
    Icono: Users,
  },
  {
    route: '/chat',
    permiso: 'chat',
    titulo: 'Chat Grupal',
    descripcion: 'Conversa con el equipo en tiempo real.',
    color: '#ec4899',
    Icono: MessagesSquare,
  },
  {
    route: '/notificaciones',
    permiso: null,
    titulo: 'Notificaciones',
    descripcion: 'Avisos de documentos y actividad reciente.',
    color: '#8b5cf6',
    Icono: Bell,
  },
];

export default function HomeScreen() {
  const router = useRouter();
  const { profile, signOut, tienePermiso } = useAuth();
  const [noLeidas, setNoLeidas] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let activo = true;
      api
        .get('/notificaciones/unread-count')
        .then((r) => {
          if (activo) setNoLeidas(Number(r?.total) || 0);
        })
        .catch(() => {});
      return () => {
        activo = false;
      };
    }, []),
  );

  const visibles = MODULOS.filter((m) => !m.permiso || tienePermiso(m.permiso));
  const nombre = (profile?.nombre || '').trim().split(' ')[0];

  return (
    <LinearGradient
      colors={['#f0f4f6', '#f7f9fa', '#eaf0f2']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      {/* Anillos decorativos, como el panel del login web */}
      <View pointerEvents="none" style={[styles.ring, styles.ring1]} />
      <View pointerEvents="none" style={[styles.ring, styles.ring2]} />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.inner}>
            {/* Encabezado */}
            <View style={styles.header}>
              <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
              <TouchableOpacity style={styles.logout} onPress={signOut} activeOpacity={0.7}>
                <LogOut size={14} color={colors.primaryDark} />
                <Text style={styles.logoutText}>Salir</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.saludoBox}>
              <Text style={styles.saludo}>{nombre ? `Hola, ${nombre}` : 'Bienvenido'}</Text>
              <Text style={styles.saludoSub}>
                {profile?.email || ''}
                {profile?.rol ? `  ·  ${profile.rol}` : ''}
              </Text>
            </View>

            {/* Módulos */}
            <View style={styles.cards}>
              {visibles.map((m) => {
                const Icono = m.Icono;
                return (
                  <TouchableOpacity
                    key={m.route}
                    style={styles.card}
                    activeOpacity={0.75}
                    onPress={() => router.push(m.route)}
                  >
                    <View style={[styles.iconChip, { backgroundColor: m.color + '18' }]}>
                      <Icono size={21} color={m.color} />
                      {m.route === '/notificaciones' && noLeidas > 0 ? (
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{noLeidas > 99 ? '99+' : noLeidas}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{m.titulo}</Text>
                      <Text style={styles.cardDescription}>{m.descripcion}</Text>
                    </View>
                    <ChevronRight size={18} color="#b6c2cc" />
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.footer}>Amsodent · Gestión comercial y cotizaciones</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 20, paddingBottom: 40 },
  inner: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(40,174,177,0.14)',
  },
  ring1: { width: 230, height: 230, top: -80, right: -70 },
  ring2: { width: 130, height: 130, bottom: 60, left: -50, borderColor: 'rgba(40,174,177,0.10)' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  logo: { width: 150, height: 50 },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(40,174,177,0.35)',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  logoutText: { color: colors.primaryDark, fontSize: 13, fontWeight: '700' },
  saludoBox: { marginTop: 22, marginBottom: 18 },
  saludo: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  saludoSub: { fontSize: 12.5, color: colors.textMuted, marginTop: 3 },
  cards: { gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#ffffff',
    borderRadius: 15,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(40,174,177,0.13)',
    shadowColor: colors.primary,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  iconChip: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: colors.danger,
    borderRadius: 999,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  badgeText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  cardTitle: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  cardDescription: { fontSize: 12.5, color: colors.textMuted, marginTop: 3, lineHeight: 17 },
  footer: { textAlign: 'center', color: '#9aa7b4', fontSize: 12, marginTop: 30 },
});
