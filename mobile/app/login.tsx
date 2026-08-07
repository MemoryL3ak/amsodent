import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';

// Mismo logo que usa el login del web.
const LOGO_URL = 'https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [focusEmail, setFocusEmail] = useState(false);
  const [focusPwd, setFocusPwd] = useState(false);

  async function onSubmit() {
    if (!email.trim() || !password) {
      setError('Debes ingresar correo y contraseña.');
      return;
    }
    setError(null);
    setEnviando(true);
    const { error: err } = await signIn(email, password);
    setEnviando(false);
    if (err) {
      // Distinguir problemas de red/configuración de credenciales malas: si no
      // se alcanzó el servidor de Supabase, decirlo en vez de culpar la clave.
      if (/network|fetch|failed|resolve|connect/i.test(err)) {
        setError('No se pudo conectar con el servidor. Revisa tu conexión a internet.');
      } else {
        setError('Credenciales incorrectas. Verifica tu correo y contraseña.');
      }
    }
    // Con sesión creada, el guard del layout redirige al home.
  }

  return (
    <LinearGradient
      colors={['#f0f4f6', '#f7f9fa', '#eaf0f2']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      {/* Anillos decorativos, como los del panel del web */}
      <View pointerEvents="none" style={[styles.ring, styles.ring1]} />
      <View pointerEvents="none" style={[styles.ring, styles.ring2]} />
      <View pointerEvents="none" style={[styles.ring, styles.ring3]} />

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              {/* Header: logo centrado + título, como el web */}
              <View style={styles.cardHeader}>
                <Image source={{ uri: LOGO_URL }} style={styles.logo} resizeMode="contain" />
                <Text style={styles.titulo}>Iniciar sesión</Text>
                <Text style={styles.subtitulo}>Ingresa tus credenciales para continuar</Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Correo electrónico</Text>
                <TextInput
                  style={[styles.input, focusEmail && styles.inputFocus]}
                  value={email}
                  onChangeText={setEmail}
                  onFocus={() => setFocusEmail(true)}
                  onBlur={() => setFocusEmail(false)}
                  placeholder="correo@amsodent.cl"
                  placeholderTextColor="#9aa7b4"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Contraseña</Text>
                <View>
                  <TextInput
                    style={[styles.input, { paddingRight: 76 }, focusPwd && styles.inputFocus]}
                    value={password}
                    onChangeText={setPassword}
                    onFocus={() => setFocusPwd(true)}
                    onBlur={() => setFocusPwd(false)}
                    placeholder="••••••••"
                    placeholderTextColor="#9aa7b4"
                    secureTextEntry={!showPwd}
                    textContentType="password"
                    onSubmitEditing={onSubmit}
                  />
                  <TouchableOpacity
                    style={styles.toggle}
                    onPress={() => setShowPwd((v) => !v)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.toggleText}>{showPwd ? 'Ocultar' : 'Mostrar'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorIcon}>!</Text>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={onSubmit}
                disabled={enviando}
                activeOpacity={0.85}
                style={[styles.buttonWrap, enviando && { opacity: 0.8 }]}
              >
                <LinearGradient
                  colors={[colors.primary, colors.primaryDark]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.button}
                >
                  {enviando ? (
                    <View style={styles.buttonInner}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.buttonText}>Verificando…</Text>
                    </View>
                  ) : (
                    <Text style={styles.buttonText}>Ingresar al sistema</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <View style={styles.footerCard}>
                <Text style={styles.footerText}>¿Olvidaste tu contraseña?</Text>
                <Text style={styles.footerHint}>Recupérala desde la versión web.</Text>
              </View>
            </View>

            <Text style={styles.footer}>Amsodent · Gestión comercial y cotizaciones</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  // Anillos suaves detrás de la tarjeta (equivalente a .lf-ring-* del web).
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(40,174,177,0.16)',
  },
  ring1: { width: 220, height: 220, top: -70, right: -60 },
  ring2: { width: 140, height: 140, bottom: 90, left: -50, borderColor: 'rgba(40,174,177,0.12)' },
  ring3: { width: 90, height: 90, top: '30%', left: 24, borderColor: 'rgba(40,174,177,0.10)' },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingVertical: 34,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: 'rgba(40,174,177,0.14)',
    shadowColor: colors.primary,
    shadowOpacity: 0.14,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  cardHeader: {
    alignItems: 'center',
    gap: 4,
    paddingBottom: 24,
    marginBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logo: { width: 180, height: 60, marginBottom: 10 },
  titulo: { fontSize: 23, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitulo: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  field: { marginBottom: 16 },
  label: { fontSize: 12.5, fontWeight: '600', color: colors.text, marginBottom: 7 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: '#fbfdfd',
  },
  inputFocus: {
    borderColor: colors.primary,
    backgroundColor: '#ffffff',
  },
  toggle: {
    position: 'absolute',
    right: 13,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  toggleText: { fontSize: 12.5, fontWeight: '700', color: colors.primaryDark },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginBottom: 6,
  },
  errorIcon: {
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: '#b91c1c',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 1,
    overflow: 'hidden',
  },
  errorText: { flex: 1, color: '#b91c1c', fontSize: 13.5, lineHeight: 19 },
  buttonWrap: {
    marginTop: 8,
    borderRadius: 11,
    shadowColor: colors.primary,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  button: {
    height: 47,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15, letterSpacing: 0.15 },
  footerCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 5,
    marginTop: 20,
  },
  footerText: { fontSize: 13, color: colors.textMuted },
  footerHint: { fontSize: 13, color: colors.primaryDark, fontWeight: '600' },
  footer: { textAlign: 'center', color: '#9aa7b4', fontSize: 12, marginTop: 24 },
});
