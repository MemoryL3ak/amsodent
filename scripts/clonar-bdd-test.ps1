<#
.SYNOPSIS
  Clona la base de PRODUCCIÓN de Supabase a la rama/proyecto de PRUEBAS.

.DESCRIPTION
  Las tablas centrales del sistema no nacen en supabase/migrations (se crearon
  a mano), así que la rama "test" no se puede reconstruir desde el repo: hay
  que clonar producción. Este script hace, en orden:
    1. Usuarios de Auth (auth.users + auth.identities) → para que los mismos
       correos y contraseñas entren en pruebas (omitir con -SinAuth).
    2. Buckets de Storage (filas de storage.buckets; los ARCHIVOS no se copian).
    3. Políticas RLS de storage.objects (regeneradas desde pg_policies).
    4. Esquema PUBLIC completo con datos: tablas, funciones RPC (damaria_sql,
       reporteria_sql…), triggers, políticas y secuencias (solo esquema con
       -SinDatos). Se restaura con --clean: lo que hubiera en public en
       pruebas se reemplaza.
    5. Comparación de conteos producción vs pruebas en las tablas clave.

  Requiere pg_dump, pg_restore y psql (PostgreSQL 17 client). Instalar con:
    winget install -e --id PostgreSQL.PostgreSQL.17
  o pasar la carpeta bin con -PgBin "C:\Program Files\PostgreSQL\17\bin".

  Cadenas de conexión (Dashboard → Connect → "Session pooler", puerto 5432):
    postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
  La de la rama test se saca desde el dashboard DE LA RAMA (tiene otro ref).

.EXAMPLE
  .\scripts\clonar-bdd-test.ps1 -ProdUrl "postgresql://..." -TestUrl "postgresql://..."
.EXAMPLE
  .\scripts\clonar-bdd-test.ps1 -ProdUrl ... -TestUrl ... -SinDatos   # solo esquema
#>
param(
  [Parameter(Mandatory = $true)] [string] $ProdUrl,
  [Parameter(Mandatory = $true)] [string] $TestUrl,
  [string] $PgBin = "",
  [string] $Salida = (Join-Path $env:TEMP "amsodent-clon"),
  [switch] $SinDatos,
  [switch] $SinAuth,
  [switch] $SoloDump
)

$ErrorActionPreference = "Stop"
function Paso($t) { Write-Host ""; Write-Host ("== " + $t) -ForegroundColor Cyan }
function Ok($t)   { Write-Host ("   OK " + $t) -ForegroundColor Green }
function Aviso($t){ Write-Host ("   ! " + $t) -ForegroundColor Yellow }

# ── Herramientas ─────────────────────────────────────────────────────────
if (-not $PgBin) {
  $cands = @("C:\Program Files\PostgreSQL\17\bin", "C:\Program Files\PostgreSQL\16\bin", "C:\Program Files\PostgreSQL\15\bin")
  foreach ($c in $cands) { if (Test-Path (Join-Path $c "pg_dump.exe")) { $PgBin = $c; break } }
}
if ($PgBin) { $env:PATH = "$PgBin;$env:PATH" }
foreach ($exe in @("pg_dump", "pg_restore", "psql")) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
    throw "No encuentro $exe. Instala PostgreSQL 17 client (winget install -e --id PostgreSQL.PostgreSQL.17) o pasa -PgBin."
  }
}
Paso "Herramientas"
Ok ((& pg_dump --version) -join " ")

# ── Seguridad: nunca restaurar sobre producción ──────────────────────────
function HostDe($url) { try { ([uri]$url).Host + "/" + ([uri]$url).UserInfo.Split(":")[0] } catch { $url } }
if ((HostDe $ProdUrl) -eq (HostDe $TestUrl)) {
  throw "ProdUrl y TestUrl apuntan al mismo servidor/usuario. Me niego: esto restauraría sobre producción."
}
Paso "Destinos"
Ok ("Producción : " + (HostDe $ProdUrl))
Ok ("Pruebas    : " + (HostDe $TestUrl))

New-Item -ItemType Directory -Force $Salida | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$dumpPublic = Join-Path $Salida "public-$stamp.dump"
$dumpAuth   = Join-Path $Salida "auth-$stamp.sql"
$dumpBuck   = Join-Path $Salida "buckets-$stamp.sql"
$polStorage = Join-Path $Salida "storage-policies-$stamp.sql"
$log        = Join-Path $Salida "restore-$stamp.log"

# ── 1. Dumps desde producción (solo lectura) ─────────────────────────────
Paso "Volcando producción → $Salida"
$flagsDatos = @()
if ($SinDatos) { $flagsDatos = @("--schema-only") }
& pg_dump --dbname=$ProdUrl -Fc --schema=public --no-owner --no-privileges @flagsDatos -f $dumpPublic
Ok ("public (esquema" + $(if ($SinDatos) { ")" } else { " + datos)" }) + ": " + [math]::Round((Get-Item $dumpPublic).Length / 1MB, 1) + " MB")

if (-not $SinAuth) {
  & pg_dump --dbname=$ProdUrl --data-only --column-inserts --on-conflict-do-nothing --no-owner --no-privileges `
    --table=auth.users --table=auth.identities -f $dumpAuth
  Ok "auth.users + auth.identities"
}

& pg_dump --dbname=$ProdUrl --data-only --column-inserts --on-conflict-do-nothing --no-owner --no-privileges `
  --table=storage.buckets -f $dumpBuck
Ok "storage.buckets"

$qPol = @"
select format('create policy %I on storage.objects as %s for %s to %s%s%s;',
  policyname, lower(permissive::text), lower(cmd::text), array_to_string(roles, ', '),
  case when qual is not null then ' using (' || qual || ')' else '' end,
  case when with_check is not null then ' with check (' || with_check || ')' else '' end)
from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname
"@
& psql --dbname=$ProdUrl -At -c $qPol | Out-File -Encoding utf8 $polStorage
Ok ("políticas de storage.objects: " + ((Get-Content $polStorage | Measure-Object -Line).Lines))

if ($SoloDump) { Aviso "-SoloDump: no se restaura nada. Archivos en $Salida"; exit 0 }

# ── 2. Restaurar en pruebas ──────────────────────────────────────────────
Paso "Restaurando en PRUEBAS (log: $log)"
"== restore $stamp ==" | Out-File -Encoding utf8 $log

if (-not $SinAuth) {
  & psql --dbname=$TestUrl -v ON_ERROR_STOP=0 -q -f $dumpAuth 2>&1 | Out-File -Append -Encoding utf8 $log
  Ok "usuarios de Auth (los que ya existían en pruebas se conservan)"
}
& psql --dbname=$TestUrl -v ON_ERROR_STOP=0 -q -f $dumpBuck 2>&1 | Out-File -Append -Encoding utf8 $log
Ok "buckets"
& psql --dbname=$TestUrl -v ON_ERROR_STOP=0 -q -f $polStorage 2>&1 | Out-File -Append -Encoding utf8 $log
Ok "políticas de storage (las repetidas se ignoran)"

# public: --clean --if-exists reemplaza lo que hubiera; los errores sueltos
# (objetos que ya existen, extensiones del sistema) quedan en el log.
& pg_restore --dbname=$TestUrl --no-owner --no-privileges --clean --if-exists --schema=public -j 2 $dumpPublic 2>&1 | Out-File -Append -Encoding utf8 $log
$errores = (Select-String -Path $log -Pattern "ERROR" | Measure-Object).Count
if ($errores -gt 0) { Aviso "public restaurado con $errores línea(s) ERROR en el log (revisar; suelen ser objetos ya existentes)." } else { Ok "public restaurado sin errores" }

# ── 3. Comparar conteos ──────────────────────────────────────────────────
Paso "Conteos producción vs pruebas"
$tablas = @("licitaciones", "items_licitacion", "licitacion_documentos", "productos", "clientes", "profiles", "inventario_movimientos", "stock_solicitudes_cotizacion", "reportes_guardados")
"{0,-32} {1,12} {2,12}" -f "tabla", "produccion", "pruebas" | Write-Host
foreach ($t in $tablas) {
  $q = "select count(*) from public.$t"
  $a = (& psql --dbname=$ProdUrl -At -c $q 2>$null); if (-not $a) { $a = "-" }
  $b = (& psql --dbname=$TestUrl -At -c $q 2>$null); if (-not $b) { $b = "-" }
  $color = if ("$a" -eq "$b") { "Green" } else { "Yellow" }
  Write-Host ("{0,-32} {1,12} {2,12}" -f $t, $a, $b) -ForegroundColor $color
}

Paso "Listo"
Aviso "Pendiente manual en la rama de pruebas: subir archivos a los buckets si hacen falta, y revisar Authentication → URL Configuration (Site URL y Redirect URLs del frontend de pruebas)."
