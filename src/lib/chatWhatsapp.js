import { api } from "./api";

// Reenvía al grupo de WhatsApp un mensaje recién publicado en la sala GENERAL
// del Chat del equipo.
//
// Vive acá y no dentro del chat porque los mensajes se insertan DIRECTO en
// `chat_mensajes` desde varios lugares (el chat mismo, la toma de
// postulaciones, y lo que venga después). Nada los replica solo: si un módulo
// nuevo publica en la general y no llama a esta función, su aviso no llega a
// WhatsApp. Centralizarlo hace el olvido menos probable y el arreglo, uno solo.
//
// Solo la sala general se reenvía: las salas privadas y los directos nunca
// salen de la plataforma. Es responsabilidad de quien llama comprobarlo.
//
// Fire-and-forget: si el puente está apagado (sin credenciales de Green API)
// o falla, el chat sigue funcionando igual y el usuario no ve ningún error.
export function replicarEnWhatsApp({ autor, texto, tipo, adjunto_url, file_name } = {}) {
  try {
    api
      .post("/chat/whatsapp", {
        autor: autor || "",
        texto: texto || "",
        tipo: tipo || "texto",
        adjunto_url: adjunto_url || "",
        file_name: file_name || "",
      })
      .catch(() => {
        /* puente apagado o caído: no molesta al chat */
      });
  } catch {
    /* nunca interrumpe al llamador */
  }
}
