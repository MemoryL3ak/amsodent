/* Logo de Amsodent para correos (2026-10-06).
   Antes se tomaba de https://amsodentmedical.cl/wp-content/uploads/2025/12/Amsodent-1.png,
   pero el sitio de la empresa se rehízo y esa ruta ya no existe (404): todos
   los correos salían con la imagen rota. Ahora el logo vive en el propio
   sistema (public/logo-amsodent.png del frontend) y los correos lo piden al
   dominio de la aplicación, que es público. */
export const APP_PUBLICA_URL = (process.env.PUBLIC_APP_URL || 'https://amsodent.vercel.app').replace(/\/+$/, '');
export const LOGO_AMSODENT_URL = `${APP_PUBLICA_URL}/logo-amsodent.png`;
