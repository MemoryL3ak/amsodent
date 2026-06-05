// Loader idempotente del script de Google Maps JS API.
// Carga el script una sola vez (singleton) y resuelve cuando `google.maps`
// está disponible. La API key sale de VITE_GOOGLE_MAPS_API_KEY.

let promesa = null;

export function getGoogleMapsApiKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";
}

export function cargarGoogleMaps() {
  if (typeof window === "undefined") return Promise.reject(new Error("Sin window"));
  if (window.google?.maps?.Map) return Promise.resolve(window.google);
  if (promesa) return promesa;

  const key = getGoogleMapsApiKey();
  if (!key) {
    return Promise.reject(
      new Error(
        "Falta la API key de Google Maps. Define VITE_GOOGLE_MAPS_API_KEY en el .env del frontend.",
      ),
    );
  }

  promesa = new Promise((resolve, reject) => {
    // Callback global que Google invoca cuando la API está lista (patrón
    // recomendado con loading=async; evita el warning de carga directa).
    window.__onGoogleMapsReady = () => resolve(window.google);

    if (document.getElementById("google-maps-script")) {
      if (window.google?.maps?.Map) resolve(window.google);
      return; // el callback resolverá cuando termine de cargar
    }
    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry,places&loading=async&callback=__onGoogleMapsReady`;
    script.async = true;
    script.onerror = () => {
      promesa = null;
      reject(new Error("No se pudo cargar Google Maps."));
    };
    document.head.appendChild(script);
  });
  return promesa;
}
