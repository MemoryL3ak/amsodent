import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, // escucha en 0.0.0.0 (LAN) para túneles/dispositivos
    allowedHosts: true, // permite hosts externos (ej. *.trycloudflare.com)
    watch: {
      // El backend vive en el mismo repo pero no es parte del bundle: sin
      // esto, un `nest build` bloquea archivos de backend/dist y bota el
      // watcher de Vite con EBUSY (visto 2026-09-03).
      ignored: ["**/backend/**", "**/mobile/**", "**/supabase/**"],
    },
    proxy: {
      // El frontend llama a /api (relativo) y Vite lo redirige al backend
      // local. Así un único túnel HTTPS sirve front + API en el celular.
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
