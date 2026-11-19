/* ── Aviso «Guía de despacho por enviar»: solo la primera vez (2026-11-19) ────
   Pedido de Ariel: «cuando se genera una guía de despacho se levanta el popup
   de aviso de envío de documento. Este popup solo debe desplegarse la primera
   vez que se genera el documento. Cuando se actualiza/reemplaza con otro
   archivo, no se debe desplegar».

   En la plataforma una guía no se «edita»: para cambiarle el archivo se
   elimina y se vuelve a cargar (o se carga otra vez con el mismo folio, por
   ejemplo el PDF firmado de un despacho interno). Cada carga creaba un
   documento nuevo y, con él, un aviso nuevo.

   Una carga es REEMPLAZO de una guía ya avisada cuando en la misma cotización
   ya hubo un aviso de guía:
     · con el mismo N° de guía (folio), o
     · si ninguna de las dos trae número: de una guía que ya no existe (se
       eliminó) y que derivaba de la misma orden de compra.
   En ese caso no se crea otro aviso. Si el aviso original sigue sin atender
   (pospuesto), se le apunta al documento nuevo para que, cuando vuelva, envíe
   el archivo vigente y no uno eliminado.

   Aquí solo está la decisión (sin base de datos) para poder probarla. */

export interface AvisoGuiaPrevio {
  id: number;
  leida_at: string | null;
  metadata: { documento_id?: any; numero?: any; deriva_de_id?: any } | null;
}

/** Folio comparable: «N° 001234», «GD-1234» y «1234» son la misma guía. */
export function normNumeroGuia(v: any): string {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return '';
  const digitos = s.replace(/\D/g, '').replace(/^0+/, '');
  if (digitos) return digitos;
  return s.replace(/\s+/g, '');
}

export interface DecisionAvisoGuia {
  /** La guía reemplaza a una que ya tuvo su aviso: no se avisa de nuevo. */
  reemplazo: boolean;
  /** Aviso anterior aún sin atender: hay que apuntarlo al documento nuevo. */
  pendiente: AvisoGuiaPrevio | null;
}

/**
 * @param previos   avisos `guia_despacho_enviar` de la cotización (leídos o no)
 * @param nueva     la guía que se acaba de registrar
 * @param vigentes  ids de las guías que hoy existen en la cotización
 */
export function decidirAvisoGuia(
  previos: AvisoGuiaPrevio[],
  nueva: { docId: number; numero?: any; derivaDeId?: any },
  vigentes: number[],
): DecisionAvisoGuia {
  const numero = normNumeroGuia(nueva.numero);
  const existen = new Set((vigentes || []).map(Number));
  const oc = nueva.derivaDeId == null || nueva.derivaDeId === '' ? null : Number(nueva.derivaDeId);
  const calzan = (previos || []).filter((p) => {
    const m = p?.metadata || {};
    const doc = Number(m.documento_id);
    if (!(doc > 0) || doc === Number(nueva.docId)) return false;
    const numPrevio = normNumeroGuia(m.numero);
    if (numero) return numPrevio === numero;
    if (numPrevio) return false;
    // Sin número en ninguna de las dos: solo si la anterior ya no existe (se
    // eliminó para cargarla de nuevo) y no consta que fuera de otra orden.
    if (existen.has(doc)) return false;
    const ocPrevia = m.deriva_de_id == null || m.deriva_de_id === '' ? null : Number(m.deriva_de_id);
    return oc == null || ocPrevia == null || oc === ocPrevia;
  });
  if (!calzan.length) return { reemplazo: false, pendiente: null };
  const sinLeer = calzan.filter((p) => !p.leida_at).sort((a, b) => Number(b.id) - Number(a.id));
  return { reemplazo: true, pendiente: sinLeer[0] || null };
}
