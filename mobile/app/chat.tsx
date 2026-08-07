// Chat grupal — mismas tablas y canales realtime que ChatEquipo.jsx del web:
// chat_salas / chat_sala_miembros / chat_mensajes vía Supabase directo (el RLS
// permite a los usuarios autenticados; el backend solo interviene para
// notificaciones). Los adjuntos se muestran como referencia (v1 sin subida).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MessagesSquare, Send } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import { Banner } from '../components/ui';

type Sala = {
  id: string;
  nombre: string;
  es_general?: boolean | null;
  es_directo?: boolean | null;
};

type Fila =
  | { tipo: 'dia'; key: string; label: string }
  | { tipo: 'msg'; key: string; m: Mensaje; conAutor: boolean };

type Mensaje = {
  id: string;
  sala_id: string;
  autor_email: string;
  autor_nombre?: string | null;
  tipo?: string | null;
  texto?: string | null;
  adjunto_nombre?: string | null;
  responde_a_autor?: string | null;
  responde_a_texto?: string | null;
  created_at: string;
};

const AVATAR_COLORES = ['#28aeb1', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#10b981', '#6366f1', '#ec4899'];

function colorAvatar(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORES[h % AVATAR_COLORES.length];
}

function primerNombre(nombre?: string | null, email?: string | null): string {
  const n = (nombre || '').trim();
  if (n) return n.split(' ')[0];
  return (email || '').split('@')[0] || '—';
}

function horaDe(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function etiquetaDia(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  const mismo = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mismo(d, hoy)) return 'Hoy';
  if (mismo(d, ayer)) return 'Ayer';
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function resumenAdjunto(m: Mensaje): string {
  switch (m.tipo) {
    case 'imagen':
      return `📷 Imagen${m.adjunto_nombre ? ` · ${m.adjunto_nombre}` : ''}`;
    case 'pdf':
      return `📄 PDF${m.adjunto_nombre ? ` · ${m.adjunto_nombre}` : ''}`;
    case 'audio':
      return '🎙️ Audio';
    case 'licitacion':
      return '📋 Cotización compartida';
    default:
      return m.texto || '';
  }
}

export default function ChatScreen() {
  const { profile, session } = useAuth();
  const miEmail = (profile?.email || session?.user?.email || '').toLowerCase();
  const miNombre = profile?.nombre || miEmail;

  const [salas, setSalas] = useState<Sala[]>([]);
  const [salaActiva, setSalaActiva] = useState<Sala | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listaRef = useRef<FlatList<Fila>>(null);

  // ── Salas del usuario (dos pasos, igual que el web) ──
  useEffect(() => {
    if (!miEmail) return;
    let activo = true;
    (async () => {
      try {
        const { data: miembros, error: e1 } = await supabase
          .from('chat_sala_miembros')
          .select('sala_id')
          .eq('email', miEmail);
        if (e1) throw e1;
        const ids = (miembros || []).map((m) => m.sala_id);
        const { data, error: e2 } = await supabase
          .from('chat_salas')
          .select('id, nombre, es_general, es_directo')
          .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
          .order('es_general', { ascending: false })
          .order('nombre', { ascending: true });
        if (e2) throw e2;
        if (!activo) return;
        const lista = (data || []) as Sala[];
        setSalas(lista);
        setSalaActiva(lista.find((s) => s.es_general) || lista[0] || null);
      } catch (e: any) {
        if (activo) setError(e?.message || 'No se pudieron cargar las salas.');
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => {
      activo = false;
    };
  }, [miEmail]);

  const marcarLeido = useCallback(
    (salaId: string) => {
      if (!miEmail || !salaId) return;
      supabase
        .from('chat_sala_miembros')
        .update({ leido_hasta: new Date().toISOString() })
        .eq('sala_id', salaId)
        .eq('email', miEmail)
        .then(() => {});
    },
    [miEmail],
  );

  // ── Mensajes + realtime de la sala activa ──
  useEffect(() => {
    const salaId = salaActiva?.id;
    if (!salaId) return;
    const sid: string = salaId;
    let activo = true;
    setCargandoMensajes(true);

    async function cargar() {
      // Los 300 más recientes, en orden cronológico para render.
      const { data } = await supabase
        .from('chat_mensajes')
        .select('id, sala_id, autor_email, autor_nombre, tipo, texto, adjunto_nombre, responde_a_autor, responde_a_texto, created_at')
        .eq('sala_id', salaId)
        .order('created_at', { ascending: false })
        .limit(300);
      if (!activo) return;
      setMensajes(((data || []) as Mensaje[]).reverse());
      setCargandoMensajes(false);
      marcarLeido(sid);
    }
    cargar();

    const canal = supabase
      .channel(`chat_sala_movil_${salaId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_mensajes', filter: `sala_id=eq.${salaId}` },
        (payload) => {
          const nuevo = payload.new as Mensaje;
          setMensajes((prev) => (prev.some((m) => m.id === nuevo.id) ? prev : [...prev, nuevo]));
          marcarLeido(salaId);
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'chat_mensajes' },
        (payload) => {
          const idBorrado = (payload.old as { id?: string })?.id;
          if (idBorrado) setMensajes((prev) => prev.filter((m) => m.id !== idBorrado));
        },
      )
      .subscribe((status) => {
        // Resincronizar al (re)conectar para no perder mensajes.
        if (status === 'SUBSCRIBED') cargar();
      });

    return () => {
      activo = false;
      supabase.removeChannel(canal);
    };
  }, [salaActiva?.id, marcarLeido]);

  async function enviar() {
    const t = texto.trim();
    const salaId = salaActiva?.id;
    if (!t || !salaId || !miEmail || enviando) return;
    setEnviando(true);
    try {
      const { data, error: e } = await supabase
        .from('chat_mensajes')
        .insert({
          sala_id: salaId,
          autor_email: miEmail,
          autor_nombre: miNombre,
          tipo: 'texto',
          texto: t,
        })
        .select()
        .single();
      if (e) throw e;
      setTexto('');
      if (data) {
        setMensajes((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data as Mensaje]));
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo enviar el mensaje.');
    } finally {
      setEnviando(false);
    }
  }

  // Separadores de día + agrupar consecutivos del mismo autor.
  const filas = useMemo(() => {
    const out: Fila[] = [];
    let diaPrev = '';
    let autorPrev = '';
    for (const m of mensajes) {
      const dia = etiquetaDia(m.created_at);
      if (dia !== diaPrev) {
        out.push({ tipo: 'dia', key: `dia-${m.id}`, label: dia });
        diaPrev = dia;
        autorPrev = '';
      }
      out.push({ tipo: 'msg', key: m.id, m, conAutor: m.autor_email !== autorPrev });
      autorPrev = m.autor_email;
    }
    return out;
  }, [mensajes]);

  useEffect(() => {
    // Al llegar mensajes, bajar al final.
    if (filas.length > 0) {
      setTimeout(() => listaRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [filas.length]);

  if (cargando) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <Banner
        titulo="Chat Grupal"
        subtitulo={salaActiva ? `Sala: ${salaActiva.nombre}` : 'Conversaciones del equipo'}
        Icono={MessagesSquare}
      >
        {/* Selector de salas dentro del banner */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.salas}>
          {salas.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.sala, salaActiva?.id === s.id && styles.salaActiva]}
              onPress={() => setSalaActiva(s)}
            >
              <Text style={[styles.salaText, salaActiva?.id === s.id && styles.salaTextActiva]}>
                {s.es_general ? '★ ' : s.es_directo ? '@ ' : '# '}
                {s.nombre}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Banner>

      <View style={styles.inner}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Mensajes */}
        {cargandoMensajes ? (
          <View style={styles.centro}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listaRef}
            data={filas}
            keyExtractor={(f) => f.key}
            contentContainerStyle={{ padding: 14, gap: 2 }}
            onContentSizeChange={() => listaRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <Text style={styles.vacio}>No hay mensajes en esta sala. ¡Escribe el primero!</Text>
            }
            renderItem={({ item: f }) => {
              if (f.tipo === 'dia') {
                return (
                  <View style={styles.dia}>
                    <Text style={styles.diaText}>{f.label}</Text>
                  </View>
                );
              }
              const m = f.m;
              const mio = m.autor_email?.toLowerCase() === miEmail;
              const esTexto = !m.tipo || m.tipo === 'texto' || m.tipo === 'sistema';
              return (
                <View style={[styles.filaMsg, mio && { flexDirection: 'row-reverse' }]}>
                  {!mio && f.conAutor ? (
                    <View style={[styles.avatar, { backgroundColor: colorAvatar(m.autor_email || '') }]}>
                      <Text style={styles.avatarText}>
                        {primerNombre(m.autor_nombre, m.autor_email).charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  ) : (
                    !mio && <View style={{ width: 30 }} />
                  )}
                  <View style={[styles.burbuja, mio ? styles.burbujaMia : styles.burbujaOtra, { marginTop: f.conAutor ? 8 : 2 }]}>
                    {!mio && f.conAutor ? (
                      <Text style={[styles.autor, { color: colorAvatar(m.autor_email || '') }]}>
                        {primerNombre(m.autor_nombre, m.autor_email)}
                      </Text>
                    ) : null}
                    {m.responde_a_texto ? (
                      <View style={styles.cita}>
                        <Text style={styles.citaAutor}>{m.responde_a_autor || '—'}</Text>
                        <Text style={styles.citaTexto} numberOfLines={2}>
                          {m.responde_a_texto}
                        </Text>
                      </View>
                    ) : null}
                    <Text style={[styles.msgTexto, mio && { color: '#ffffff' }, !esTexto && { fontStyle: 'italic' }]}>
                      {esTexto ? m.texto : resumenAdjunto(m)}
                    </Text>
                    <Text style={[styles.hora, mio && { color: 'rgba(255,255,255,.75)' }]}>
                      {horaDe(m.created_at)}
                    </Text>
                  </View>
                </View>
              );
            }}
          />
        )}

        {/* Barra de envío */}
        <View style={styles.barra}>
          <TextInput
            style={styles.inputMsg}
            value={texto}
            onChangeText={setTexto}
            placeholder={salaActiva ? `Mensaje a ${salaActiva.nombre}…` : 'Mensaje…'}
            placeholderTextColor="#9aa7b4"
            multiline
          />
          <TouchableOpacity
            style={[styles.enviarBtn, (!texto.trim() || enviando) && { opacity: 0.5 }]}
            onPress={enviar}
            disabled={!texto.trim() || enviando}
          >
            {enviando ? <ActivityIndicator color="#fff" size="small" /> : <Send size={18} color="#fff" />}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  salas: { gap: 8 },
  sala: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  salaActiva: { backgroundColor: '#ffffff', borderColor: '#ffffff' },
  salaText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.9)' },
  salaTextActiva: { color: colors.primaryDark, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 12.5, paddingHorizontal: 16, paddingBottom: 6 },
  vacio: { textAlign: 'center', color: colors.textMuted, marginTop: 40, fontSize: 13 },
  dia: { alignSelf: 'center', backgroundColor: '#e2e8f0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3, marginVertical: 10 },
  diaText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  filaMsg: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  burbuja: {
    maxWidth: '78%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  burbujaMia: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  burbujaOtra: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  autor: { fontSize: 12, fontWeight: '800', marginBottom: 2 },
  cita: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,255,255,.5)',
    backgroundColor: 'rgba(15,23,42,.08)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 5,
  },
  citaAutor: { fontSize: 11, fontWeight: '800', color: colors.textMuted },
  citaTexto: { fontSize: 12, color: colors.textMuted },
  msgTexto: { fontSize: 14, color: colors.text, lineHeight: 20 },
  hora: { fontSize: 10, color: colors.textMuted, alignSelf: 'flex-end', marginTop: 3 },
  barra: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  inputMsg: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14.5,
    color: colors.text,
    backgroundColor: '#fbfdfd',
    maxHeight: 110,
  },
  enviarBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
