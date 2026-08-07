// Paleta alineada con el frontend web (src/styles.css).
export const colors = {
  primary: '#28aeb1',
  primaryDark: '#1e9295',
  primaryLight: '#e8f7f7',
  bg: '#f1f5f9',
  surface: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  textMuted: '#64748b',
  danger: '#dc2626',
  warning: '#b45309',
  success: '#15803d',
};

// Colores de badge por estado de cotización (mismos estados del web).
export function colorEstado(estado?: string | null): { bg: string; fg: string } {
  switch ((estado || '').trim()) {
    case 'Adjudicada':
      return { bg: '#dcfce7', fg: '#15803d' };
    case 'En espera':
      return { bg: '#fef9c3', fg: '#a16207' };
    case 'Perdida':
      return { bg: '#fee2e2', fg: '#b91c1c' };
    case 'Descartada':
      return { bg: '#e2e8f0', fg: '#475569' };
    case 'Pendiente Aprobación':
      return { bg: '#e0e7ff', fg: '#4338ca' };
    default:
      return { bg: '#e8f7f7', fg: '#1e9295' };
  }
}
