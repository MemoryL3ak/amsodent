// Contexto de autenticación: sesión Supabase persistida en AsyncStorage y
// perfil (rol + permisos) obtenido del backend (/auth/profile), que es la
// fuente de verdad de permisos, igual que en el web.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api } from './api';
import type { Profile } from './types';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  tienePermiso: (modulo: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function esAdminRol(rol?: string | null): boolean {
  const r = String(rol || '').trim().toLowerCase();
  return r === 'admin' || r === 'administrador';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelado = false;
    if (!session) {
      setProfile(null);
      return;
    }
    api
      .get('/auth/profile')
      .then((p: Profile) => {
        if (!cancelado) setProfile(p);
      })
      .catch(() => {
        // Sin perfil se sigue mostrando la app; los permisos quedan abiertos y
        // el backend igualmente rechaza lo que no corresponda.
        if (!cancelado) setProfile(null);
      });
    return () => {
      cancelado = true;
    };
  }, [session?.user?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const tienePermiso = useCallback(
    (modulo: string) => {
      if (!profile) return true;
      if (esAdminRol(profile.rol)) return true;
      const permisos = profile.permisos;
      if (!Array.isArray(permisos)) return true;
      return permisos.includes(modulo);
    },
    [profile],
  );

  return (
    <AuthContext.Provider value={{ session, profile, loading, signIn, signOut, tienePermiso }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
