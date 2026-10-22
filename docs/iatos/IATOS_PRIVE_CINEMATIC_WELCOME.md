# IATOS Privé · Invitación ceremonial y Grand Welcome

> Parte de la serie Privé. Contrato: `scratchpad/prive/prive_contract.md` §4 y §6. Dirección visual: [UX §7](IATOS_PRIVE_UX.md#7-dirección-visual). Guía de inicio: [Onboarding](IATOS_PRIVE_ONBOARDING.md).
> Rama `claude/wc-prive-ui` (ya incluye la rama core unida en `claude/iatos-world-class`, `bd9078e`). Nada de esto está desplegado.

## Resumen para fundadores

- **Qué ve el miembro al cumplir 90 días de PRO pagado:** abre su correo o la notificación y entra a `/prive/invitacion`, una ceremonia corta en cinco escenas:
  1. pantalla negra, el monograma de Privé aparece y una línea de luz champaña cruza el centro;
  2. un sobre digital con sello dorado y el botón **OPEN INVITATION**;
  3. el sobre se abre: **WELCOME, [NOMBRE].** / **YOUR PRIVÉ MEMBERSHIP HAS BEEN UNLOCKED.**;
  4. crea su contraseña Privé personal (elegida, con guía de fuerza, o generada por el servidor y mostrada una sola vez) y aparece su tarjeta digital de miembro;
  5. **ENTER IATOS PRIVÉ**.
- **Al entrar por primera vez:** la Grand Welcome (**WELCOME TO PRIVÉ** → **YOUR WORLD JUST GOT BIGGER.** → seis destinos con fotos ilustrativas). Se reproduce sola **una vez por versión**, lo decide el servidor, y se puede repetir desde Membresía.
- **Honesto por diseño:**
  - la revelación solo aparece **después** de que el servidor aceptó la invitación (antes ni siquiera está en la página);
  - la tarjeta muestra solo datos públicos; el "código ceremonial" es un adorno con la fecha en números romanos y lo dice;
  - las fotos dicen "Foto ilustrativa · Pexels · fotógrafo" y que muestran la ciudad, no un lugar de la selección;
  - si algo no procede (otra cuenta, invitación vencida, sin PRO, sin 90 días, ya activa) aparece un mensaje calmado con la salida correcta.
- **Ligero:** solo SVG y CSS, sin video ni audio. Las pantallas Privé cargan aparte: el paquete inicial de la app creció **3.1 KB (1.1 KB gzip)**: el código que quita el token del enlace, borra la sesión Privé al cerrar sesión y declara las rutas.
- **Accesible:** todo se puede saltar, se maneja con teclado y, si el sistema pide "reducir movimiento", todo pasa a fundidos de 80 ms sin desplazamientos.
- **Pendiente de producción:** desplegar con las funciones de la rama core; no hay migraciones ni funciones en esta rama.

---

## 1. Qué se reutilizó, qué se construyó y qué se corrigió

| | Detalle |
|---|---|
| **Reutilizado** | Router y `ProtectedRoute` (regreso con `state.from` + `safeRedirectPath`), `AuthContext`, `lazyWithRetry` (code-splitting resistente a despliegues), framer-motion (ya en `vendor-motion`), `lucide-react`, la función `pexels-image` con su caché compartida de 7 días, `PRO_PATH`, colores del sistema (`#C9A961`, negro `#0A0A0A`) y el patrón de adelanto sin nombres de `MembersTeaser`. |
| **Construido** | `src/lib/priveSession.ts` (sesión Privé en `sessionStorage`, captura del `#t=`), `src/lib/priveApi.ts` (cliente tipado del contrato), `src/lib/priveCopy.ts`, `src/lib/privePassword.ts`, `src/lib/priveView.ts`, `src/lib/priveOnboarding.ts`, `src/hooks/usePriveAccess.tsx`, `src/components/prive/*` (monograma, sobre, tarjeta, candado, creador de contraseña, Grand Welcome, guía, fichas de universos, punto de integración del catálogo, `prive.css`), `src/pages/prive/*` (hub, invitación, membresía, restablecer) y las rutas en `src/App.tsx`. |
| **Corregido / ajustado** | `AuthContext`: el token del enlace se quita de la URL al arrancar y cerrar sesión (o `SIGNED_OUT`) borra la sesión Privé y pide `lock` al servidor. Entradas discretas a Privé en `DashboardLayout` y Members Only sin cambiar su flujo. |

## 2. Las escenas

### 2.1 Invitación (`/prive/invitacion`, `src/pages/prive/PriveInvitation.tsx`)

| # | Escena | Qué pasa | Servidor |
|---|---|---|---|
| 0 | Preparando | Monograma tenue mientras llega `prive_status` | `rpc('prive_status')` |
| 1 | **The Arrival** | Negro; los aros del monograma se trazan; línea de luz champaña al centro; "IATOS PRIVÉ". Avanza sola; botón **Saltar** | — |
| 2 | **The Invitation** | "A private invitation awaits you." (preencabezado del correo del dueño), sobre con pliegues, reflejo que cruza una vez, sello dorado. Botón **OPEN INVITATION** | Al pulsar: `accept_invitation {token?}`; el sello late suave mientras responde |
| 3 | **The Reveal** | La solapa gira, la carta sube: **WELCOME, [NOMBRE].** / **YOUR PRIVÉ MEMBERSHIP HAS BEEN UNLOCKED.** Botón **Continuar** | Solo tras `ok:true`; se relee el estado (nombre, fecha, código) |
| 4 | **Personal Access** | "Elegir la mía" (guía 12–72, confirmación) o "Generar una por mí" (frase del servidor una sola vez, **Copiar**, **La guardé**). Luego la tarjeta de miembro | `set_password {password}` o `{generate:true}`; adopta la sesión que devuelve (o `unlock`) |
| 5 | **Enter** | **ENTER IATOS PRIVÉ** → `/prive` | — |

**Por dónde empieza** (`invitationStart` en `src/lib/priveView.ts`): membresía activa con contraseña → "Tu membresía ya está activa" + "Ir a IATOS Privé"; activa sin contraseña → escena 4 ("Continúa donde te quedaste"); revocada, sin PRO o sin 90 días → mensaje; si no, escena 1.

**Respuestas del servidor y su texto** (`CODE_MESSAGES`):

| Código | Pantalla |
|---|---|
| `INVITATION_OTHER_ACCOUNT` | "Esta invitación es para otra cuenta" (texto genérico, sin datos de la otra cuenta) + **Cambiar de cuenta** (cierra sesión y vuelve a `/auth` con regreso a la invitación) |
| `INVITATION_EXPIRED` | "Tu invitación venció" + **Enviarme una nueva** (`resend_invitation`); luego **Abrir ahora** sin el token viejo. Solo dice "te enviamos" si el servidor responde `email:'sent'` |
| `NOT_PRO` / `NOT_ELIGIBLE` | "Privé es parte de IATOS PRO" / "Aún no es momento" con "Llevas N de 90 días de PRO pagado" |
| `NO_INVITATION` | "No encontramos tu invitación" + estado + soporte |
| ya activa | "Tu membresía ya está activa" + **Ir a IATOS Privé** |
| `PASSWORD_ALREADY_SET` | "Tu contraseña ya estaba creada" + entrar o restablecer |
| `PASSWORD_WEAK` / `PASSWORD_BREACHED` | Mensaje bajo el formulario; no se pierde lo escrito |
| `PRIVE_*` | Se borra la sesión local y se vuelve al candado de `/prive` |

**Sin sesión de IATOS:** `ProtectedRoute` manda a `/auth` y regresa a `/prive/invitacion`. El `#t=` ya se quitó de la URL al evaluarse `AuthContext` (antes del router), así que **no viaja en `state.from`**; queda solo en `sessionStorage` (`iatos.prive.invite_token`) hasta aceptar.

### 2.2 Grand Welcome (`src/components/prive/GrandWelcome.tsx`)

1. negro (0.7 s);
2. **WELCOME TO PRIVÉ**;
3. **YOUR WORLD JUST GOT BIGGER.**;
4. seis destinos del piloto de curaduría (París, Ciudad de México, Tokio, Nueva York, Dubái, Roma) con foto de Pexels, crédito "Foto ilustrativa · Pexels · <fotógrafo>" y la nota "muestran la ciudad, no un lugar de la selección";
5. **Continuar** → guía de inicio si no está terminada.

- **Cuándo se reproduce sola:** si `prive_status.welcome_version_seen < WELCOME_VERSION` (hoy 1). Al terminar o saltar se guarda con `save_progress {welcome_version: 1}` (con la sesión Privé). Si se sube `WELCOME_VERSION`, cada miembro la verá una vez más.
- **Nunca `localStorage`:** el estado vive en `prive_memberships`; en la misma visita se marca en memoria para no repetirla si el guardado falla, y la siguiente visita vuelve a preguntar al servidor.
- **Repetir:** Membresía → "Ver la bienvenida otra vez" (no vuelve a escribir la versión).
- **Saltar:** botón fijo arriba a la derecha y la tecla Esc.

## 3. Tiempos y especificación de movimiento

Fuente: `src/components/prive/timings.ts`, `motion.ts` y cada componente. Curva común `cubic-bezier(0.22, 1, 0.36, 1)` (la misma `--transition-smooth` de la app).

| Elemento | Movimiento completo | Movimiento reducido |
|---|---|---|
| Cambio de escena | Fundido cruzado 0.6 s (sale una, entra otra) | Fundido 80 ms |
| Llegada (duración) | 3.2 s y avanza sola | 0.9 s y avanza sola |
| Aros del monograma | Trazo `pathLength` 0→1 en 1.6 s (el interior +0.25 s) | Aparecen ya dibujados |
| Línea de luz | `scaleX` 0→1 y opacidad 0→1→0.7 en 2.2 s, desde 0.9 s | Visible al 80 %, sin escala |
| Sobre (entrada) | Sube 30 px con `rotateX` 8°→0 en 1.4 s | Fundido |
| Reflejo del sobre | Cruza una vez en 2.6 s (desde 0.6 s) | No se dibuja |
| Sello esperando al servidor | Opacidad 1→0.75→1, ciclo de 1.4 s | Quieto |
| Apertura | Solapa `rotateX` 0→178° en 0.9 s; carta sube 38 % en 1.1 s (+0.45 s); sello se desvanece 0.5 s | Solapa y sello se desvanecen; carta aparece (80 ms) |
| "Continuar" tras la revelación | A los 1.8 s | Inmediato |
| Tarjeta de miembro | Sube 24 px con `rotateX` 12°→0 en 1.1 s | Fundido |
| "ENTER IATOS PRIVÉ" | A los 1.4 s | Inmediato |
| Grand Welcome | Negro 0.7 s → título 2.3 s → frase 2.3 s → destinos 3.6 s (fotos escalonadas 0.12 s, 0.9 s c/u) → **Continuar** (≈ 8.9 s en total) | Todo estático de una vez (monograma, las dos frases, los seis destinos y **Continuar**); sin temporizadores |
| Fichas de universos (hub) | Opacidad y 8 px en 220 ms, escalonado 40 ms (máx. 6), como pide UX §7 | Fundido 80 ms |
| Anillo de progreso | Se dibuja en 1.4 s | Ya dibujado |

- Con `prefers-reduced-motion: reduce`, `useReducedMotion()` (framer-motion) cambia todas las variantes a un fundido de 80 ms sin `x/y/scale/rotate`, y `prive.css` anula las transiciones CSS.
- Nada se reproduce en bucle salvo el pulso del sello mientras se espera al servidor. Sin parallax, sin audio, sin video, sin carruseles automáticos.

## 4. Presupuesto de rendimiento (medido con `npm run build`)

| Archivo (Vite 5, minificado) | Tamaño | gzip | Cuándo se descarga |
|---|---|---|---|
| `index-*.js` (paquete inicial) — **antes** | 147,321 B | 46,678 B | siempre |
| `index-*.js` — **después** | 150,464 B (+3,143) | 47,762 B (+1,084) | siempre |
| `PriveRoot-*.js` + `PriveRoot-*.css` | 2,016 B + 7,665 B | 1,002 B + 2,484 B | al entrar a cualquier `/prive/*` |
| `PriveHub-*.js` (hub, candado, bienvenida, guía) | 25,484 B | 8,367 B | `/prive` |
| `PriveInvitation-*.js` | 12,326 B | 4,315 B | `/prive/invitacion` |
| `PriveMembership-*.js` | 9,050 B | 3,277 B | `/prive/membresia` |
| `PriveReset-*.js` | 3,640 B | 1,678 B | `/prive/restablecer` |
| piezas compartidas Privé (monograma, cliente, contraseña, guía) | 31,295 B (Monogram+cliente+textos 14,796 · PasswordCreator 5,980 · priveOnboarding 3,478 · privePassword 2,715 · MemberCard 2,449 · ReportCompromised 1,877) | 13,693 B | según la pantalla |
| `vendor-motion-*.js` (framer-motion, ya existía) | 137,200 B | 45,500 B | ya lo usaban otras pantallas (p. ej. `/auth`) |
| `index-*.css` (Tailwind de toda la app) — antes → después | 125,333 B → 127,562 B | 19,858 B → 20,247 B | siempre |

Medición: `gzip -c <archivo> | wc -c` sobre `dist/assets` (gzip nivel 6). La meta de UX §8 era ≤ 35 KB gzip adicionales y solo al abrir Privé: la ruta más pesada (`/prive` = raíz + hub + compartidas) suma ≈ 22.2 KB (raíz 3.5 + hub 8.4 + monograma/cliente 6.1 + tarjeta 1.1 + guía 1.7 + reglas 1.5); la invitación, ≈ 18.9 KB gzip, sin contar framer-motion, que ya estaba en la app.

**Otros recursos solo dentro de Privé:**
- **Tipografía:** una familia, Cormorant Garamond (300, 400 y 400 itálica), desde Google Fonts con `display=swap`; mientras llega se ve la serifa del sistema (`Fraunces`, `Georgia`, `Times New Roman`). La hoja se inserta al montar `PriveRoot`, no en `index.html`.
- **Fotos de la bienvenida:** máximo 6, con `loading="lazy"` y `decoding="async"`, pedidas cuando falta poco para verlas (desde la segunda frase). Si Pexels no responde, cada ficha queda con un degradado y el monograma, sin crédito inventado.

## 5. Pruebas (Vitest + Testing Library, servidor simulado con `vi.mock("@/lib/priveApi")`)

| Archivo | Qué prueba | Resultado |
|---|---|---|
| `src/test/priveLib.test.ts` | captura del `#t=` (sale de la URL, solo en `sessionStorage`), sesión ligada a usuario y vencimiento, reglas de contraseña, cada estado → pantalla, `invitationStart`, estado de bienvenida y guía, cliente tipado (sin sesión no llama contenido; mapeo de 401/429/PRIVE_*, INVALID/INTERNAL), código ceremonial, destino de los avisos `prive` | 37/37 ✓ |
| `src/test/priveHub.test.tsx` | cada estado del hub, error con Reintentar, candado y desbloqueo, bloqueo temporal, PRIVE_* → candado (hub y membresía), sin contenido sin sesión, bienvenida una sola vez por versión, Saltar guarda, repetir, escenas con temporizador, **ruta de movimiento reducido**, guía (reanudar, atrás/siguiente, teclado, consentimiento, final), membresía pausada y desbloqueada | 28/28 ✓ |
| `src/test/priveInvitation.test.tsx` | token quitado de la URL y enviado solo al aceptar, revelación solo tras aceptar, otra cuenta, vencida → reenviar → abrir, sin PRO / sin 90 / ya activa, **frase generada una vez y nunca guardada**, **tarjeta sin credenciales**, contraseña elegida con guía y error del servidor, `unlock` de respaldo, restablecer (pedir, con token, vencido) | 13/13 ✓ |
| `src/test/priveAuth.test.tsx` | `AuthContext` quita el token al cargarse; sin sesión va a `/auth` y el `from` no lleva el token; **cerrar sesión** y `SIGNED_OUT` borran la sesión Privé y piden `lock` | 4/4 ✓ |
| `src/test/priveUiContract.test.ts` | **contra el manejador real de `prive-access`** (rama core unida en `bd9078e`): `generated_password` + sesión de `set_password`, sesión nueva de `change_password`/`complete_reset`, `LOCKED` con hora, `HARD_LOCKED`, `PRIVE_SESSION_EXPIRED`, 400 `INVALID`, 500 `INTERNAL`, otra cuenta / vencida, miembro sin PRO → pausa | 7/7 ✓ |
| `src/test/priveEntry.test.tsx`, `priveBundle.test.ts` | entradas desde el menú y Members Only sin romper lo existente; rutas con `import()`; sin video/audio | 5/5 ✓ |

Al cierre (después de unir la rama core): `npx vitest run` → **118 archivos, 922 pruebas, todas en verde**; `npx tsc --noEmit -p tsconfig.app.json` sin errores; `npm run build` correcto. En una corrida anterior, con la máquina ocupada por la generación de capturas, falló 1 prueba que no se identificó; no se repitió en las dos corridas completas siguientes.

## 6. Evidencia visual (Playwright)

- **Dónde:** `docs/iatos/evidencia/prive/ui/` (lista completa en `INDEX.txt`). Nombre: `<escena>__<viewport>[__reduced-motion].png`.
- **Tamaños:** 390×844 (tipo iPhone), 412×915 (tipo Android) y 1440×900. Las móviles se capturan a 2× y se guardan en píxeles CSS; todas en PNG de 256 colores (165 capturas, 9.8 MB). **Son viewports emulados en Chromium headless 141 (Playwright 1.56), no dispositivos iOS ni Android reales**: Safari/WebKit y Chrome Android no se probaron.
- **Movimiento reducido:** la ceremonia completa, la bienvenida y la guía también con `reducedMotion: "reduce"` en los tres tamaños.
- **Cómo se generó:** `scripts/prive/ui_evidence.mjs`. El servidor de Vite corre con `VITE_SUPABASE_URL=http://supabase-mock.localhost:54399` y el script intercepta **todas** las llamadas a ese host con `page.route` (estado, `prive-access`, `pexels-image`, auth y tablas). Cualquier otro host se bloquea, salvo Google Fonts (descargado con `curl` por el proxy del entorno, con TLS verificado). Las "fotos" son SVG generados con la leyenda "foto simulada · prueba". **Cero llamadas a producción** (el script imprime los hosts bloqueados: ninguno).
- **El script también verifica:** que el `#t=` desaparece de la URL, que se llamó `accept_invitation`, que la frase generada no queda en `localStorage`/`sessionStorage`, que la bienvenida guardó progreso y que el candado no pidió contenido del catálogo.

## 7. Qué no se pudo verificar

- El servidor real desplegado: la rama core ya está unida y su manejador de `prive-access` se probó conectado al cliente (sin red, con la base simulada); `prive_status` y el SQL no se corrieron contra una base desde esta rama (los prueba la rama core en `supabase/tests/prive`). Las capturas usan un servidor simulado.
- Dispositivos reales (iOS Safari, Android Chrome), lectores de pantalla reales (VoiceOver/TalkBack) y redes lentas reales.
- Fotos reales de Pexels y la descarga real del correo de invitación (lo hace la rama core).
- LCP/CLS en campo: no hay medición de usuarios reales; el presupuesto de §4 es de tamaño de archivos.

## 8. Costos

- **Pexels:** hasta 6 consultas por la primera bienvenida, con la caché compartida de 7 días de `pexels-image`: en la práctica 6 consultas a la semana para todos los miembros. Gratis dentro de la cuota de 20,000 al mes (compartida con `buscar-video`).
- **Google Fonts:** gratis. **Supabase:** 1 RPC `prive_status` por visita y 1 llamada a `prive-access` por acción. **IA:** ninguna.

## 9. Supuestos y formas del servidor (verificadas contra la rama core unida)

- `prive_status()` devuelve los campos del contrato; `password_status` puede ser `none`, `active`, `must_reset` o `hard_locked` (visto en la rama core). `eligible` solo es `true` con PRO vigente.
- `set_password {generate:true}` devuelve la frase como `generated_password` (visto en la rama core; se acepta también `passphrase`). `set_password`, `change_password` y `complete_reset` devuelven `prive_session` y `expires_at`; si no vinieran, la interfaz abre la sesión con `unlock`.
- `unlock` responde `{ok, prive_session, expires_at}` o `{ok:false, code, locked_until?}`.
- `save_progress` acepta `onboarding` como JSON libre (≤ 2 KB en la rama core); la interfaz guarda `{version, step, completed_at, skipped_at, dna_consent}`.
- Códigos extra vistos en la rama core además de la lista del contrato: `NO_PASSWORD`, `EMAIL_UNAVAILABLE`, `RATE_LIMITED`, `INVALID` (400) e `INTERNAL` (500); todos tienen texto.
- Avisos en la app: `notifications.type = 'prive'` → la invitación abre `/prive/invitacion` (sin token: el servidor la busca por cuenta) y los avisos de seguridad abren `/prive/membresia` (`src/lib/notificationTarget.ts`).
- Sin PRO vigente `prive_status` devuelve `tenure_days = 0`: la interfaz usa `membership_status` para mostrar la pausa con **Reactivar IATOS PRO** y no muestra ese 0 como dato.
- Las RPC de contenido del catálogo aún no existen: el hub muestra "Contenido en curaduría" y no llama a nada; se conectan en `PRIVE_HUB_SECTIONS` (`src/components/prive/PriveCatalogSlot.tsx`).

## 10. Riesgos

- **Unión de ramas:** si la rama core cambia nombres de campos, la interfaz lo tolera en lo crítico (frase, sesión), pero conviene correr esta suite contra el servidor real antes de publicar.
- **`dna_consent`** se guarda en `prive_memberships.onboarding`; la personalización del catálogo debe leerlo (hoy no lo hace nadie).
- **Google Fonts** es un tercero: si está bloqueado, se ve la serifa del sistema (no rompe nada).
- La sesión Privé vive en `sessionStorage`: un script malicioso en la misma página podría leerla (igual que el token de Supabase en `localStorage`). La defensa real es del servidor: sesión ligada al usuario y a la sesión de Auth, 12 h / 2 h de inactividad, revocable.

## 11. Cambios que requieren autorización productiva

- Desplegar el front (Lovable) **junto con** la rama core (migraciones `2026102309xxxx`, funciones `prive-access`, `prive-cron`) y, cuando exista, la del catálogo. Sin el servidor, `/prive` muestra "No pudimos cargar Privé" con Reintentar (no rompe el resto de la app).
- Esta rama no agrega migraciones, funciones, secretos, precios ni cambios de lo que incluye cada plan.
