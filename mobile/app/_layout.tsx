import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import { initMonitor } from '../lib/monitor';

initMonitor();

function RootNavigator() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const enLogin = segments[0] === 'login';
    if (!session && !enLogin) {
      router.replace('/login');
    } else if (session && enLogin) {
      router.replace('/');
    }
  }, [session, loading, segments]);

  // Cada pantalla dibuja su propio banner de marca (components/ui.tsx), así
  // que el header nativo del Stack va oculto en toda la app.
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AuthProvider>
  );
}
