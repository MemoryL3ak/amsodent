import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { UserPlus } from 'lucide-react-native';
import { api } from '../../lib/api';
import { colors } from '../../lib/theme';
import { Banner } from '../../components/ui';

const TIPOS = ['Entidad Pública', 'Cliente Particular'] as const;

export default function NuevoClienteScreen() {
  const router = useRouter();
  const [form, setForm] = useState({
    rut: '',
    nombre: '',
    tipo_cliente: 'Entidad Pública' as (typeof TIPOS)[number],
    region: '',
    comuna: '',
    direccion: '',
    contacto: '',
    email: '',
    telefono: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function set<K extends keyof typeof form>(campo: K, valor: (typeof form)[K]) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar() {
    if (!form.rut.trim() || !form.nombre.trim()) {
      setError('RUT y nombre son obligatorios.');
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      // Evitar duplicados: si el RUT ya existe se avisa en vez de crear otro.
      const existente = await api.get(`/clientes?rut=${encodeURIComponent(form.rut.trim())}`);
      if (existente) {
        setGuardando(false);
        Alert.alert('Cliente ya existe', `El RUT ${form.rut.trim()} ya está registrado como "${existente.nombre}".`);
        return;
      }
      const creado = await api.post('/clientes', {
        rut: form.rut.trim(),
        nombre: form.nombre.trim(),
        tipo_cliente: form.tipo_cliente,
        region: form.region.trim(),
        comuna: form.comuna.trim(),
        direccion: form.direccion.trim(),
        contacto: form.contacto.trim(),
        email: form.email.trim(),
        telefono: form.telefono.trim(),
      });
      setGuardando(false);
      if (creado?.id) {
        router.replace(`/cliente/${creado.id}`);
      } else {
        router.back();
      }
    } catch (e: any) {
      setGuardando(false);
      setError(e?.message || 'No se pudo guardar el cliente.');
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Banner titulo="Nuevo Cliente" subtitulo="Registro en la cartera comercial" Icono={UserPlus} />
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.label}>Tipo de cliente</Text>
          <View style={styles.tipoRow}>
            {TIPOS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.tipoChip, form.tipo_cliente === t && styles.tipoChipActivo]}
                onPress={() => set('tipo_cliente', t)}
              >
                <Text style={[styles.tipoText, form.tipo_cliente === t && styles.tipoTextActivo]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Campo label="RUT *" valor={form.rut} onChange={(v) => set('rut', v)} placeholder="76.123.456-7" />
          <Campo label="Nombre / Razón social *" valor={form.nombre} onChange={(v) => set('nombre', v)} placeholder="Hospital de..." />
          <Campo label="Región" valor={form.region} onChange={(v) => set('region', v)} placeholder="Metropolitana" />
          <Campo label="Comuna" valor={form.comuna} onChange={(v) => set('comuna', v)} placeholder="Santiago" />
          <Campo label="Dirección" valor={form.direccion} onChange={(v) => set('direccion', v)} placeholder="Av. ..." />
          <Campo label="Contacto" valor={form.contacto} onChange={(v) => set('contacto', v)} placeholder="Nombre del contacto" />
          <Campo label="Email" valor={form.email} onChange={(v) => set('email', v)} placeholder="contacto@correo.cl" teclado="email-address" />
          <Campo label="Teléfono" valor={form.telefono} onChange={(v) => set('telefono', v)} placeholder="+56 9 ..." teclado="phone-pad" />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.boton, guardando && { opacity: 0.7 }]}
            onPress={guardar}
            disabled={guardando}
            activeOpacity={0.85}
          >
            {guardando ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.botonText}>Guardar cliente</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Campo({
  label,
  valor,
  onChange,
  placeholder,
  teclado,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
  teclado?: 'default' | 'email-address' | 'phone-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={valor}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9aa7b4"
        keyboardType={teclado || 'default'}
        autoCapitalize={teclado === 'email-address' ? 'none' : 'sentences'}
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(40,174,177,0.13)',
  },
  tipoRow: { flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 14 },
  tipoChip: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#fbfdfd',
  },
  tipoChipActivo: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  tipoText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  tipoTextActivo: { color: colors.primaryDark },
  field: { marginBottom: 13 },
  label: { fontSize: 12.5, fontWeight: '600', color: colors.text, marginBottom: 6 },
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
  error: { color: colors.danger, fontSize: 13, marginBottom: 10 },
  boton: {
    height: 46,
    backgroundColor: colors.primary,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  botonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
