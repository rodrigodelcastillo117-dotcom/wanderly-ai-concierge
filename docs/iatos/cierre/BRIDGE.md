# Cierre de auditoría · grupo `bridge` (AUD-04, AUD-07)

Rama `claude/aud-bridge` (desde `claude/cierre-auditoria`, f62466e). Fecha: 2026-10-22.
Alcance: salidas del Booking Bridge a sitios externos (`allowlist.ts`, `booking-go`, `booking-bridge`,
`booking-links-cron`), dominio registrable y phishing, y revisión de seguridad de los cambios del día
(`src/lib/affiliateLinks.ts` `tpDeepLink`, `analizar-viaje/groundTransport.ts`, `src/lib/externalLinks.ts`).

Evidencia "antes": las pruebas nuevas se corrieron contra f62466e (worktree desechable) y contra el
código sin corregir; "después": esta rama. Commits: `fa42140` (AUD-07), `1132a3a` (AUD-04 y mejoras).

## Tabla

| ID | Severidad | Reproducido (cómo, archivo de prueba) | Solución (archivo:línea, commit) | Tests (nombre, resultado antes/después) | Evidencia | Estado |
|---|---|---|---|---|---|---|
| AUD-04a | P2 | booking-go aceptaba **cualquier** dominio https que no imitara una marca (`checkTrustedSource`) para el destino guardado, aunque se hubiera firmado como destino de la lista estricta; tampoco comprobaba que el destino fuera el mismo que se firmó. `src/test/bookingBridgeAudit.test.ts` › "booking-go: el token queda atado…" (destino cambiado a `pagos-seguros-reserva.com`, a otra URL de Booking.com, nivel equivocado, token sin huella) | `_shared/booking/redirectToken.ts` (`h` = SHA-256 del destino, `t` = nivel, `targetHash`); `booking-go/go.ts` (compara huella; `t=a` → lista estricta, `t=s` → fuente del servidor; sin huella → solo estricta); `booking-bridge/index.ts` `goUrl` | 4 pruebas: **antes 4 ✗** (redirigía a `pagos-seguros-reserva.com`; `reason: ok`) → **después 4 ✓** | salida vitest antes/después (abajo) | VERIFICADO |
| AUD-04b | P2 | La IA o el cliente podían colar un **redirect opaco** (`google.com/aclk?adurl=…`, `/travel/clk`) que pasa la lista estricta, y booking-go lo **firmaba** (lavado de un destino arbitrario por un enlace de IATOS). También `tp.media/click?u=<google.com/aclk…>` (redirect dentro de redirect) pasaba. E2E: "el cliente no puede hacer que booking-go firme un redirect de anuncios"; unidad: "cadenas de redirects", "lo que escribió la IA o mandó el cliente…" | `allowlist.ts`: `redirector: "wrapper"|"opaque"` por entrada; `checkAllowlisted` rechaza redirect anidado; `checkUntrusted` (IA/cliente: sin redirects opacos); `resolver.ts` `check()`; `booking-bridge/handler.ts` `signTier` | antes ✗ (acción "Sitio oficial" → `google.com/aclk…evil.io`, firmada) → después ✓ | idem | VERIFICADO |
| AUD-04c | P2 | Un **colaborador** del viaje puede editar `restaurantes_json` (trigger `trips_collab_columns_guard` lo permite) y poner `website` a un dominio de phishing; el dueño lo veía como **"Sitio oficial"**, "verificado" por "Ficha de Google Maps". E2E: "un sitio fuera de la lista blanca que viene del viaje…" | `resolver.ts` `editableTripData`: etiqueta **"Sitio web del lugar (sin verificar)"**, aviso "IATOS no lo verificó… revisa que <dominio> sea el sitio del lugar", sin `verified_at`; sigue sin firmarse en booking-go (se abre directo). No se bloquea: los sitios reales siguen disponibles | antes ✗ (`label: "Sitio oficial"`) → después ✓ | idem | VERIFICADO |
| AUD-04d | P2 | **URL que ya no corresponde a la misma oferta:** con una intención viva de la oferta (p. ej. "Ver tarifas en Booking"), elegir otra acción ("Ver en Google Maps") devolvía un enlace firmado que llevaba al destino **anterior**. E2E: "si ya hay una intención viva… la salida lleva al destino que el usuario eligió ahora" | `handler.ts` start_booking: compara el destino guardado (`deps.intentTarget`, service role filtrado por dueño) con el elegido; antes de salir lo alinea con `booking_intent_transition` (queda en historial); si ya salió, no se reescribe ni se firma (se abre directo) | antes ✗ (llevaba a booking.com) → después ✓ | idem | VERIFICADO |
| AUD-04e | P3 | Un cambio del destino guardado (mismo estado) **no dejaba rastro** en `booking_intent_events`. SQL `AUD04-6` | Migración **nueva** `supabase/migrations/20261024070000_aud_bridge_target_trace.sql` (`booking_intents_log` registra "Destino: host (acción) → host (acción)"). **Requiere autorización** para producción | SQL: antes 41 OK / 1 FALLA (AUD04-6) → después 42 OK | `supabase/tests/bridge/run.sh` | VERIFICADO |
| AUD-04f | P3 | `https://localhost./` (punto final) y TLDs inexistentes (`*.tld-que-no-existe`, `intranet.corp` cubierto) pasaban como "fuente confiable" (el cron de enlaces los habría pedido: SSRF menor). Unidad: "esquemas, credenciales, IPs…", "un TLD que no existe en la PSL…" | `allowlist.ts` `basicCheck`: TLD real de la PSL y regex con punto final | antes ✗ → después ✓ | idem | VERIFICADO |
| AUD-04g | P3 | Rutas de google.com con **barras/puntos codificados** (`/maps/..%2F..%2Furl?q=…`) pasaban la regla de ruta. Unidad: "rutas de google.com…" | `allowlist.ts` `ENCODED_PATH_TRICK` en entradas con `paths` | antes ✗ → después ✓ | idem | VERIFICADO |
| AUD-04h | P3 | `booking-links-cron` seguía saltos a **http** del mismo sitio (y, con el dominio registrable viejo, saltos entre sitios distintos de `wixsite.com`/`github.io`). Unidad: "booking-links-cron no sigue saltos a http…" | `booking-links-cron/linkcheck.ts`: el salto debe pasar `checkTrustedSource` y ser del mismo dominio registrable (PSL) o un proveedor | antes ✗ (http) → después ✓ | idem | VERIFICADO |
| AUD-04i | P3 | UI: oferta exacta y búsqueda general solo se distinguían por la etiqueta del botón; el destino no se veía; el motivo `?salida=` de booking-go nunca se mostraba. `src/test/bookingActionsUi.test.tsx` (2 pruebas nuevas) | `src/lib/bookingExit.ts` (`linkKindLine`, `exitNotice`, `useBookingExitNotice`); `BookingSheet.tsx` (línea "Enlace a esta oferta exacta…" / "Búsqueda general en X: no es un enlace a esta oferta…" y "Destino: dominio"); `TripDetail.tsx`, `Reservas.tsx` (aviso) | nuevas (no existía la función) → ✓ | idem | CORREGIDO |
| AUD-04j | P3 | `externalLinks.ts`: un enlace externo que ya traía `target="_blank"` sin `rel` no recibía `noopener` (reverse tabnabbing en navegadores viejos). `src/test/externalLinks.test.ts` | `src/lib/externalLinks.ts`: agrega `noopener` (no `noreferrer`, para no romper atribución) | antes ✗ → después ✓ | idem | VERIFICADO |
| AUD-04k | — | Allowlist: cada entrada debe decir por qué es legítima | `allowlist.ts` `PROVIDERS[].why` (con su evidencia EV-* o el archivo que la usa); no se agregó ningún dominio (Expedia sigue fuera de la lista estricta: IATOS no arma ni recibe enlaces suyos) | "cada entrada de la lista blanca dice por qué es legítima": antes ✗ → después ✓ | idem | VERIFICADO |
| AUD-07 | P2 | `registrableDomain` usaba "últimas 2 etiquetas (3 si com/co/… + ccTLD)": fallaba con `ltd.uk`, `k12.ca.us`, `*.kawasaki.jp`/`!city.kawasaki.jp`, IDN (`bücher.de`), sufijos privados (`foo.blogspot.com`, `chef.wixsite.com`, `x.github.io` → todos el mismo "dominio"), y devolvía `co.uk` para `co.uk`. Detector de marcas por subcadena: falsos negativos (`bookingcom.ltd.uk`, `b00king.com`, `bookimg.com`, `opentab1e.com`, `aeromexic0.com`, `vivaaerobus.co`, `lufthansa-deals.com`, `iberia-vuelos.mx`, `thef0rk.es`, `sevenr00ms.com`) y falsos positivos (`fresyogurt.com` por "resy"). Unidad: bloque "AUD-07" | **PSL fijada**: `_shared/booking/psl_data.ts` (generado; VERSION 2026-10-20_08-40-56_UTC, COMMIT 5dd321ffe02039e2431382a095cf80e27ff5eb94, SHA256 8228e4bd…0755, 6949 ICANN + 3447 privadas), `_shared/booking/psl.ts` (algoritmo oficial: regla más larga, comodín, excepción), `scripts/booking/update_psl.mjs` (regenera; nunca en tiempo de ejecución). `allowlist.ts`: `registrableDomain` = PSL; `looksLikeBrandImpersonation` sobre la etiqueta registrable con sustituciones (0→o, 1→l/i, rn→m…), distancia de edición 1 (marcas ≥ 7 letras, misma inicial) y marcas cortas solo como palabra completa o junto a palabras de phishing; marcas tomadas de PROVIDERS | 8 pruebas: antes 7 ✗ / 1 ✓ → después 8 ✓ (+1 de PSL fijada) | idem | VERIFICADO |

## HALLAZGOS NUEVOS

- **AUD-04c** (colaborador → sitio "oficial" falso), **AUD-04d** (salida a la URL de otra acción de la misma oferta), **AUD-04e** (cambio de destino sin historial), **AUD-04f/g/h** (localhost., TLD falso, ruta codificada, saltos http en el cron), **AUD-04i** (`?salida=` nunca se mostraba), **AUD-04j** (`target=_blank` sin `rel`). Todos con prueba y corregidos (tabla).
- **Documentación desactualizada**: `IATOS_BOOKING_BRIDGE_PROVEEDORES.md` §3 decía que Trenes/Ferries/Autos/eSIM seguían con `tp.media` roto; desde 99cc9af abren el proveedor directo. Corregido.
- booking-go marcaba la intención como `REDIRECTED_TO_PROVIDER` **antes** de comprobar el destino (si se bloqueaba, el historial decía "salió"). Corregido sin migración (ver Mejoras adicionales).

## HALLAZGOS REFUTADOS CON EVIDENCIA

| Ataque | Por qué no funciona | Prueba |
|---|---|---|
| Open redirect vía `booking-go?u=https://evil.io` | booking-go nunca lee URLs de la petición; sin token firmado regresa a IATOS | `bookingBridgeAudit.test.ts` "token vencido, alterado…", E2E 19 |
| Token alterado / vencido / de otro usuario | HMAC-SHA256 con comparación en tiempo constante de la forma canónica; caduca a 30 min; `mark_redirected` filtra por `user_id` | idem; SQL B5 |
| Cambiar el destino guardado desde el cliente | `booking_intents` sin escritura para `authenticated`; `booking_intent_transition` y `mark_redirected` solo `service_role`; guardia de trigger | SQL `AUD04-1…4`, B1/B2/B7 |
| Origen de regreso manipulado (`o: https://evil.io` en el token) | `safeOrigin` lo reemplaza por el de IATOS | "token vencido, alterado…" |
| URL con credenciales (`user:pass@`, `booking.com@evil.io`), http, `javascript:`, `data:`, `vbscript:`, `file:` | `basicCheck` | "esquemas, credenciales, IPs…" |
| IP literal: decimal `3232235521`, hex `0x7f000001`, octal `0177.0.0.1`, corta `127.1`, `0x7f.0.0.1`, `[::1]`, `[::ffff:127.0.0.1]`, `[2001:db8::1]`, `169.254.169.254` | el parser WHATWG normaliza a IPv4/IPv6 y se rechaza | idem |
| CRLF / control / espacios / barra invertida | rechazados antes de parsear; un `%0d%0a` codificado no produce CR/LF reales en `Location` | "caracteres de control, CRLF…" |
| Subdominio fraudulento `booking.com.evil.io`, `evil-booking.com`, homógrafos (`bооking.com` cirílico, `οpentable` griego, `аirbnb`) | `hostMatches` por etiquetas; el parser pasa Unicode a punycode (no coincide con la lista y `xn--` se marca) | bloque AUD-07 |
| Afiliado anidado `tp.media → tp.media`, `tp.media → google.com/url?q=` | ya rechazado antes; ahora también `tp.media → aclk/clk` | "cadenas de redirects" |
| Oferta vencida presentada como exacta | el resolver no ofrece `exact_offer` vencida (`exact_expired`) y start_booking deja `PRICE_RECHECK_REQUIRED` sin enlace hasta aceptar | `bookingBridge.test.ts` resolver; E2E "después de aceptar el precio…" |
| Proveedores legítimos bloqueados | OpenTable (.com/.com.mx/.co.uk), Resy, SevenRooms, Tock, TheFork, Booking.com, aerolíneas, ADO pasan la lista estricta; sitios reales de restaurantes pasan la vía confiable | "proveedores legítimos…", "no hay falsos positivos…" |
| `tpDeepLink` / `groundTransport.ts` (cambio del día) | Hosts fijos en código, parámetros con `URLSearchParams`/`encodeURIComponent`; el texto del usuario solo cae en ruta o query, nunca en la autoridad: no hay open redirect. `affiliateLinks.test.ts` sigue verde | revisión de código |
| `externalLinks.ts` abre en otra pestaña enlaces que deberían quedarse | Pagos (Stripe), descargas de documentos y auth usan `window.location` o `download`, no anclas: el listener no los toca; esquemas `tel:/mailto:/javascript:/data:` excluidos | `externalLinks.test.ts` |

## Mejoras adicionales

| Mejora | Archivo | Prueba |
|---|---|---|
| booking-go revisa el destino **antes** de marcar la salida (lectura previa con service role filtrada por dueño): un destino bloqueado ya no deja la intención como "salió al proveedor". Sin migración. | `supabase/functions/booking-go/go.ts` (`peekTarget`), `booking-go/index.ts` | "mejora: con lectura previa…" (antes ✗ → después ✓) |
| Fuente honesta del teléfono que viene del viaje: "Google Maps al cotizar (dato guardado en el viaje; confírmalo en la ficha)" en lugar de "Ficha de Google Maps del lugar". | `_shared/booking/offers.ts` `VERIFIED_BY` | E2E AUD-04 (Places) |
| Aviso claro al volver de booking-go (`?salida=enlace_vencido|enlace_invalido|destino_bloqueado|comprueba_el_precio|no_disponible`), y se limpia el parámetro. | `src/lib/bookingExit.ts`, `TripDetail.tsx`, `Reservas.tsx` | `bookingActionsUi.test.tsx` |
| "Destino: dominio" visible antes de salir. | `BookingSheet.tsx` | `bookingActionsUi.test.tsx` |
| Script reproducible para actualizar la PSL con validaciones (VERSION/COMMIT, mínimo de reglas, punycode). | `scripts/booking/update_psl.mjs` | generó `psl_data.ts` |

## Resultados de las suites

| Suite | Resultado |
|---|---|
| Vitest pruebas nuevas contra f62466e | `bookingBridgeAudit` + `externalLinks`: **18 fallan / 7 pasan** (las 7 son los ataques refutados); `bookingBridgeE2E` con las 4 nuevas: **4 fallan / 24 pasan** |
| Vitest Booking Bridge en esta rama | `bookingBridgeAudit` 21, `bookingBridge` 67, `bookingBridgeE2E` 28, `bookingLinkCheck` 6, `bookingActionsUi` 6, `externalLinks` 4, `affiliateLinks` 4: **136/136 ✓** (una corrida tuvo 1 timeout de 5 s por carga; aislada pasa) |
| Vitest completo (`npx vitest run`) | 1526 pruebas: **1503 ✓, 23 ✗, todas por `Test timed out in 5000ms`** salvo 2 que también pasaron al repetir; la máquina estaba con load average 43–54 (otros grupos en paralelo). Repetidos los 16 archivos en serie: 108/110 ✓; los 2 restantes (`dashboardActiveTrip`, `godtierHome`) **fallan igual en f62466e** con la misma carga y **pasan** con `--testTimeout=30000` (8/8). Ninguno toca archivos de esta rama. |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npm run build` | exit 0 (2 m 16 s). El chunk perezoso `BookingActions-*.js` pesa 221 KB (69 KB gzip) por la PSL; no está en el paquete inicial |
| `deno check` booking-bridge, booking-go, booking-links-cron, analizar-viaje | exit 0 los cuatro (`deno.lock` borrado) |
| `supabase/tests/bridge/run.sh` (db `audbr_before` sin la migración / `audbr_after`) | antes **41 OK, 1 FALLA (AUD04-6)** → después **42 OK, 0 FALLA** |
| `supabase/tests/security/run.sh` (db `audbr_sec`) | 95 OK, 0 FALLA; A1–A5 en 0, L1–L7, D1–D6, T1–T7 correctos; único error esperado: pg_cron |
| `scripts/booking/verify_links.mjs --only edge,hotels` (en vivo, sin clics) | 16 páginas: H1–H10 y X5 Booking.com con hotel, fechas y viajeros correctos; X1 Resy roto detectado; X2 Maps; X3 Aviasales; X4 Tock 403 (anti-bots, no se evade); **H0 `tp.media/click` sigue respondiendo 400** (confirma el cambio del líder); las 9 URLs peligrosas: `permitida=false`. No se corrieron flights/experiences/restaurants (carga de la máquina). |

## Requiere autorización para producción

- Migración `20261024070000_aud_bridge_target_trace.sql` (solo `CREATE OR REPLACE` de `booking_intents_log`, idempotente).
- Desplegar funciones Edge: `booking-bridge`, `booking-go`, `booking-links-cron` (comparten `_shared/booking`), y el frontend. **Orden:** primero `booking-go` (acepta tokens con y sin huella), luego `booking-bridge`. Los tokens emitidos antes del despliegue (máx. 30 min) solo salen por la lista estricta.
- `analizar-viaje` no cambió de código propio (solo revisado), pero importa `_shared` sin cambios relevantes.

## Riesgo residual

- El detector de marcas es heurístico: un dominio nuevo sin parecido con ninguna marca (`reservas-premium-cdmx.com`) **pasa** la vía "fuente confiable". El control real es la fuente: fuera de la lista estricta solo salen datos del catálogo curado o del escaneo del sitio oficial (no editables por usuarios), y los de `trips.*_json` se muestran "sin verificar" y no se firman.
- Teléfonos de Google Places guardados en el viaje (editables por colaboradores) se siguen ofreciendo para llamar; ahora la fuente dice "dato guardado en el viaje; confírmalo en la ficha", pero no se verifican contra Google Places en vivo.
- `google.com/aclk` y `/travel/clk` de SerpApi siguen permitidos (redirect opaco de Google); su destino final depende de Google.
- La PSL fijada envejece: regenerar con `node scripts/booking/update_psl.mjs` (trimestral). Suma ~150 KB (≈ 44 KB gzip) al chunk de las páginas del viaje que importan `src/lib/booking.ts`.
- `scripts/booking/verify_links.mjs` (verificación en vivo con navegador) — ver "Resultados".
