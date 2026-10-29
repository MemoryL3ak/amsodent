import { useEffect, useMemo, useState } from "react";
import { construirQR, cargarDataUrl } from "../lib/qrCustom";

/* QR custom reutilizable (ver src/lib/qrCustom.js). Carga el logo como data
   URL para que el mismo SVG sirva en pantalla y al exportar a PNG/SVG. */

export const LOGO_QR = "/logo-amsodent.png";

export function useDataUrl(url) {
  // Se guarda junto a su url: si la url cambia, el valor viejo no se usa.
  const [cargado, setCargado] = useState({ url: null, valor: null });
  useEffect(() => {
    let vivo = true;
    if (!url) return undefined;
    cargarDataUrl(url)
      .then((valor) => vivo && setCargado({ url, valor }))
      .catch(() => vivo && setCargado({ url, valor: null }));
    return () => {
      vivo = false;
    };
  }, [url]);
  return url && cargado.url === url ? cargado.valor : null;
}

export default function QRCustom({
  texto,
  estilo = "fluido",
  color = "#28aeb1",
  acento = "#f59e0b",
  conLogo = true,
  logo = LOGO_QR,
  tamano = 240,
  className,
  style,
  title,
}) {
  const logoData = useDataUrl(conLogo ? logo : null);
  const svg = useMemo(
    () => (texto ? construirQR({ texto, estilo, color, acento, logo: logoData, tamano }) : ""),
    [texto, estilo, color, acento, logoData, tamano]
  );
  return (
    <div
      className={className}
      title={title}
      style={{ width: tamano, height: tamano, lineHeight: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
