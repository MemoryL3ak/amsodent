# Amsodent Mobile

App móvil (iOS y Android) de la plataforma Amsodent, construida con **Expo + React Native + expo-router**, siguiendo el mismo modelo del proyecto Seven (`mobile/` dentro del repo, cliente HTTP hacia el backend NestJS existente).

## Pantallas incluidas (v1)

| Pantalla | Descripción |
|---|---|
| **Login** | Inicio de sesión con las mismas credenciales del web (Supabase Auth) |
| **Home** | Accesos a los módulos según los permisos del usuario + contador de notificaciones |
| **Cotizaciones** | Listado con búsqueda y filtro por estado; detalle con datos, totales e ítems |
| **Nueva Cotización** | Creación completa: cliente por RUT (autocompleta), productos con precios por lista/campañas, flete repartido, totales e IVA, regla de margen (<20% → Pendiente Aprobación) |
| **Postulaciones Disponibles** | Listado del portal con vigencia por fecha/hora de cierre; permite Tomar/Liberar y marcar No Aplica |
| **Clientes** | Búsqueda, creación (valida RUT duplicado) y detalle con contactos y acciones de llamar/escribir |
| **Chat Grupal** | Salas del equipo (misma tabla `chat_*` del web) con mensajes en tiempo real vía Supabase Realtime |
| **Notificaciones** | Avisos del backend, marcar leída (individual o todas) y salto al detalle de la cotización |

La app **no** accede a Supabase para datos: todos los datos pasan por el backend NestJS (igual que el web), y Supabase se usa solo para la sesión (token JWT que se adjunta como `Authorization: Bearer`).

---

## Requisitos

- Node.js 18+
- [EAS CLI](https://docs.expo.dev/eas/) para builds: `npm install -g eas-cli`

## Setup inicial

```bash
cd mobile

# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Edita .env:
#   EXPO_PUBLIC_API_URL          → URL del backend NestJS (incluye /api)
#   EXPO_PUBLIC_SUPABASE_URL     → misma VITE_SUPABASE_URL del web
#   EXPO_PUBLIC_SUPABASE_ANON_KEY→ misma VITE_SUPABASE_ANON_KEY del web

# 3. Iniciar en modo desarrollo
npm start
```

Escanea el QR con la app **Expo Go** (iOS/Android) para probar en un teléfono real.

> **Backend local**: el teléfono debe alcanzar la API. Usa la IP local de tu PC
> (ej: `http://192.168.1.10:3001/api`) en `EXPO_PUBLIC_API_URL`, no `localhost`.
> En emulador Android usa `http://10.0.2.2:3001/api`.

---

## Publicar en App Store y Google Play

### 1. Configurar EAS

```bash
eas login
eas init          # crea el projectId
```

Actualiza `app.json` con el `projectId` generado.

### 2. Configurar `app.json`

- `ios.bundleIdentifier` y `android.package` ya vienen como `com.amsodent.app` (ajústalos si tu cuenta usa otro dominio).

### 3. Configurar `eas.json` para publicación

En la sección `submit.production`:
- **iOS**: `appleId`, `ascAppId` (App Store Connect) y `appleTeamId`.
- **Android**: archivo `google-service-account.json` (se crea en Google Play Console).

### 4. Build y envío

```bash
npm run build:ios       # requiere cuenta Apple Developer (US$99/año)
npm run build:android
npm run build:all

npm run submit:ios      # a TestFlight primero
npm run submit:android
```

Los builds corren en la nube de Expo (EAS Build); no se necesita Mac para iOS.

---

## Estructura del proyecto

```
mobile/
├── app/
│   ├── _layout.tsx          # Navegación raíz + guard de sesión
│   ├── login.tsx            # Inicio de sesión
│   ├── index.tsx            # Home (módulos según permisos)
│   ├── cotizaciones.tsx     # Listado de cotizaciones
│   ├── cotizacion/[id].tsx  # Detalle de cotización (datos + ítems)
│   ├── clientes.tsx         # Listado/búsqueda de clientes
│   ├── cliente/[id].tsx     # Detalle de cliente + contactos
│   ├── disponibles.tsx      # Postulaciones disponibles (tomar / no aplica)
│   └── notificaciones.tsx   # Notificaciones del usuario
├── lib/
│   ├── api.ts               # Cliente HTTP → backend NestJS (bearer de Supabase)
│   ├── auth.tsx             # Contexto de sesión + perfil/permisos (/auth/profile)
│   ├── supabase.ts          # Cliente Supabase (solo auth, AsyncStorage)
│   ├── types.ts             # Tipos de entidades
│   ├── format.ts            # fmtCLP, fechas, parseo de cierre del portal
│   └── theme.ts             # Paleta (alineada con src/styles.css del web)
├── app.json                 # Config de la app (nombre, bundle ids)
├── eas.json                 # Config de EAS Build/Submit
└── .env                     # Variables de entorno (no commitear)
```

## Agregar íconos

Crea la carpeta `assets/` y referencia en `app.json` (`icon`, `splash`, `android.adaptiveIcon`):
- `icon.png` — 1024×1024 px
- `splash.png` — 1242×2436 px
- `adaptive-icon.png` — 1024×1024 px

## Cómo agregar un módulo nuevo

1. Crea la pantalla en `app/<modulo>.tsx` (o `app/<modulo>/[id].tsx` para detalle).
2. Regístrala en el `<Stack>` de `app/_layout.tsx`.
3. Agrega la tarjeta en `app/index.tsx` con la clave de permiso correspondiente (las mismas de `src/constants/modulos.js` del web).
4. Consume el backend con `api.get/post/put/delete` de `lib/api.ts`.
