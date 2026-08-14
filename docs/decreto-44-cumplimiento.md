# Decreto Supremo 44/2023 — mapa de cumplimiento

> Nuevo reglamento sobre gestión preventiva de los riesgos laborales
> (Ministerio del Trabajo y Previsión Social). **Vigente desde el 01-02-2025**;
> deroga los DS 40 y DS 54 de 1969. Aplica a **toda** entidad empleadora,
> cualquiera sea su tamaño o actividad.
>
> Este documento resume qué exige el decreto, qué parte cubre la plataforma
> (pestaña **RR.HH. → Prevención**) y qué queda como gestión de la empresa.
> Sirve de guía para la certificación con la asesora laboral.

## Cómo lo cubre la plataforma

La pestaña **Prevención** del módulo RR.HH. es el *registro electrónico de la
actividad preventiva* que exige el **art. 72** («registrar y respaldar de forma
documental y fidedigna toda la información vinculada a la gestión de los
riesgos laborales… preferentemente en formato electrónico, a disposición de la
entidad fiscalizadora»). Tiene cuatro bloques:

1. **Checklist de cumplimiento** — calculado en vivo según la dotación activa
   y los registros cargados; cada punto cita el artículo del D.S. 44.
2. **Documentos del sistema de gestión** — con versión, fecha de aprobación y
   fecha de próxima revisión (las versiones anteriores quedan como histórico).
3. **Actividades preventivas** — capacitaciones, ODI, entrega de EPP,
   simulacros y charlas, con asistentes, resultado de evaluación y respaldo
   adjunto (hoja de asistencia firmada, material, fotos).
4. **Incidentes y accidentes** — registro e investigación, con sexo del
   afectado, relato, causas, medidas, días perdidos, denuncia DIAT/DIEP y la
   **tasa anual de accidentabilidad** (art. 75).

Requiere aplicar la migración `supabase/migrations/20260813_rrhh_prevencion.sql`.

## Obligaciones y estado

| Obligación | Referencia | Quién la cumple | Apoyo de la plataforma |
|---|---|---|---|
| Matriz de identificación de peligros y evaluación de riesgos (IPER), por puesto de trabajo, con enfoque de género; revisión al menos anual o al cambiar condiciones / ocurrir un accidente | art. 7 | Empresa (puede pedir asistencia técnica a la mutual) | Se sube como documento vigente; el checklist alerta si falta o venció su revisión |
| Programa de trabajo preventivo, elaborado dentro de 30 días desde la matriz, escrito y aprobado por el representante legal; incluye promoción sobre alcohol/drogas, vida saludable y riesgos de conducción (aplica a los choferes) | art. 8 | Empresa | Documento vigente; alerta si es anterior a la última matriz. La evaluación anual (art. 14) se registra como nueva versión |
| Informar los riesgos a cada persona **antes de iniciar labores** (ODI) y ante cambios de proceso | art. 15 | Empresa | Actividad tipo «ODI» por trabajador; el checklist nombra a quienes no la tienen |
| Capacitación en prevención: curso de **al menos 8 horas**, con periodicidad **máxima de 2 años**, con registro de asistentes, relatores y resultados de evaluación | art. 16 | Empresa / mutual | Actividad tipo «Capacitación» con duración, asistentes y resultado; checklist por trabajador |
| EPP: procedimiento de uso/mantención/reposición y capacitación mínima de **1 hora** con refuerzo **anual**, registrada | art. 13 | Empresa | Actividad tipo «Entrega / capacitación EPP» con registro por trabajador |
| Situaciones de riesgo grave e inminente: informar, suspender y evacuar; derecho a interrumpir labores | art. 18 | Empresa (procedimiento en el Reglamento Interno) | El procedimiento queda dentro del Reglamento Interno subido |
| Plan de emergencias, catástrofes o desastres, **ensayado al menos una vez al año** | art. 19 | Empresa | Documento «Plan de emergencias» + actividad «Simulacro»; alerta si no hay simulacro en 12 meses |
| Comité Paritario de Higiene y Seguridad si trabajan **más de 25** personas (constitución, reuniones mensuales, acta en el sitio de la DT) | arts. 23–49 | Empresa | El checklist lo exige solo si la dotación supera 25; se registra el acta de constitución |
| Departamento de Prevención de Riesgos si hay **más de 100** personas | arts. 50–55 | Empresa | El checklist lo señala si la dotación lo exige |
| Reglamento Interno de Higiene y Seguridad: obligatorio **sin mínimo de trabajadores**, ejemplar gratuito a cada persona, consulta previa de 30 días, revisión al menos anual, subido a los sitios de la DT y Seremi de Salud | arts. 56–61 | Empresa | Documento vigente con alerta de revisión anual; la entrega a cada trabajador puede registrarse como documento firmado en su ficha (firma electrónica simple ya existente) |
| Mapa de riesgos visible en cada lugar de trabajo, actualizado cuando cambie la matriz | art. 62 | Empresa | Documento vigente; alerta si quedó desactualizado respecto de la matriz |
| Régimen simplificado para entidades de **hasta 25** personas: política SST, autoevaluación con instrumentos de la mutual, matriz y programa con pauta base de la mutual | art. 64 | Empresa + mutual | El checklist indica el régimen aplicable según dotación |
| Empresas de **hasta 100** personas: pedir a la mutual capacitación en gestión de riesgos para el representante legal o quien designe (encargado de prevención) | art. 65 | Empresa | — (gestión directa con la mutual) |
| **Delegado de Seguridad y Salud en el Trabajo** si laboran **entre 10 y 25** personas y no hay Comité Paritario: elección en asamblea, acta, mandato de hasta 2 años | art. 66 | Empresa | Se registra el acta de elección; el checklist lo exige según dotación |
| Vigilancia ambiental y de salud si existe un agente de riesgo (protocolos Minsal); autorizar citaciones a exámenes (tiempo trabajado) | arts. 67–68 | Empresa + mutual | Los informes se archivan como documentos; los permisos por exámenes ya se gestionan en Solicitudes |
| Investigar **todo** accidente del trabajo, incidente peligroso o enfermedad profesional (causas y medidas correctivas), con la metodología de la mutual | art. 71 | Empresa | Ficha de investigación en el registro de incidentes (relato, causas, medidas, respaldo); alerta si queda abierto |
| **Registro documental de toda la actividad preventiva**, preferentemente electrónico, a disposición del fiscalizador | art. 72 | **Plataforma** | La pestaña Prevención es este registro |
| Registros mínimos de incidentes/accidentes: lugar, fecha y hora, personas, descripción, causas, medidas; accidentes y EP con **nombre y sexo**; desagregación por sexo | arts. 73–74 | Empresa | Campos del formulario de incidentes (incluye sexo del afectado) |
| Empresas sin Depto. de Prevención: al menos **tasa anual de accidentabilidad** + registro de todos los accidentes (nombre, sexo, lugar, descripción, relato) | art. 75 | **Plataforma** | KPI calculado automáticamente: accidentes del año ÷ dotación activa × 100 |
| Denunciar accidentes y enfermedades profesionales al organismo administrador (DIAT/DIEP) y notificar a la fiscalizadora los fatales/graves | art. 4 Nº8 | Empresa | Campo «DIAT/DIEP presentada» con fecha; alerta si falta |

## Qué NO hace la plataforma (gestión de la empresa)

- Confeccionar la matriz IPER, el programa, el reglamento o el plan de
  emergencia: son documentos que elabora la empresa (con asistencia técnica de
  su mutual, que está **obligada** a dársela — arts. 6 y 76). La plataforma los
  archiva, versiona y vigila sus plazos.
- Subir el Reglamento Interno a los sitios web de la DT y la Seremi de Salud
  (art. 57) y registrar el acta del Comité Paritario en el sitio de la DT
  (art. 36): trámites en portales del Estado.
- La elección del Delegado SST o del Comité (asambleas, votaciones).

## Relación con lo ya certificado

- **Asistencia / marcajes**: la captura de geolocalización quedó puntual (solo
  al marcar), con margen de error de 30 m y ubicación en el comprobante, según
  Res. Ex. N° 38 y Dictamen Ord. N° 2927/58 de la DT (2026-08-13).
- **Registro electrónico laboral (art. 515 CT, ley 21.327)**: el módulo RR.HH.
  ya mantiene contratos, anexos, liquidaciones y solicitudes en formato
  electrónico con firma simple.
