# Lista las rutas de los controladores que no tienen ningun @UseGuards pegado.
#
# Existe porque `tsc` no avisa: un endpoint sin guard compila perfecto. Y es
# facil dejar uno asi sin querer -- basta insertar un endpoint nuevo ENTRE un
# @UseGuards y su @Get: el guard queda pegado al nuevo y el de abajo se queda
# sin ninguno (paso tres veces en stock-clientes.controller.ts, 2026-10-02).
#
# Uso, desde la raiz del repo, despues de tocar cualquier controlador:
#   python backend/scripts/revisar-guards.py $(find backend/src -name "*.controller.ts")
# Sale con codigo 1 si encuentra alguna ruta sin guard que no este en PUBLICAS.
import io, re, sys

# Rutas publicas A PROPOSITO (archivo -> rutas). Agregar aca solo con motivo.
PUBLICAS = {
    "app.controller.ts": {""},                                   # salud del servicio
    "auth.controller.ts": {"login"},                             # inicio de sesion de la plataforma
    "choferes.controller.ts": {"login", "recuperacion"},         # portal del chofer
    "portal.controller.ts": {"login"},                           # portal del cliente (RUT + N de cotizacion)
    "stock-clientes.controller.ts": {"verificar-rut", "login", "recuperacion", "pagos/webpay/confirmar"},
    "chat.controller.ts": {"whatsapp/entrante/:secreto"},        # webhook: lo protege el secreto de la URL
    "comunidad.controller.ts": {"registrar"},                    # formulario publico
    "eventos.controller.ts": {"registrar"},                      # formulario publico
    "sorteo.controller.ts": {"registrar"},                       # formulario publico
    "correos.controller.ts": {"oauth/callback"},                 # retorno de Google
    "mailings-track.controller.ts": {"open"},                    # pixel de apertura
}
mal = 0
for p in sys.argv[1:]:
    lines = io.open(p, encoding="utf-8").read().splitlines()
    clase_con_guard = False
    for i, l in enumerate(lines):
        if l.startswith("export class"):
            clase_con_guard = any(x.strip().startswith("@UseGuards") for x in lines[max(0, i - 4):i])
        m = re.match(r"\s*@(Get|Post|Put|Delete)\((?:'([^']*)')?\)", l)
        if not m or clase_con_guard: continue
        guards = False
        for rango in (range(i - 1, max(i - 8, 0), -1), range(i + 1, min(i + 4, len(lines)))):
            for j in rango:
                t = lines[j].strip()
                if t.startswith("@UseGuards"): guards = True
                elif t.startswith("@"): continue
                else: break
        archivo = p.replace("\\", "/").split("/")[-1]
        if not guards and (m.group(2) or "") not in PUBLICAS.get(archivo, set()):
            mal += 1
            print(f"SIN GUARD  {p}:{i+1}  {m.group(1)} {m.group(2) or ''}")
print("rutas sin guard (fuera de las publicas a proposito):", mal)
sys.exit(1 if mal else 0)
