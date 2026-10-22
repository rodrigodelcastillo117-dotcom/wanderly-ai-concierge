# IATOS: auditoría de línea base

- **Fecha:** 2026-10-22
- **Producto:** IATOS, concierge de viajes con IA ("Iato"). Producción: https://traveliatos.life
- **Repositorio:** `wanderly-ai-concierge`, rama `claude/iatos-world-class` (commit auditado `b5aca1b`, igual a `origin/main` al iniciar)
- **Para quién es:** el dueño, que quiere vender la app, y también los ingenieros y el equipo de *due diligence* del comprador.
- **Documentos hermanos:**
  - [IATOS_MATRIZ_FUNCIONAL.md](./IATOS_MATRIZ_FUNCIONAL.md): estado de cada pantalla y cada función.
  - [IATOS_HALLAZGOS_PRIORIZADOS.md](./IATOS_HALLAZGOS_PRIORIZADOS.md): lista única de problemas, ordenada por gravedad.

---

## 1. Resumen en una página

IATOS es un producto amplio: 48 pantallas, 53 funciones de servidor, 44 tablas y 3 tareas automáticas, con integraciones reales (Gemini, Claude, SerpApi, Travelpayouts, Stripe, Google Maps). La base técnica compila sin errores y sus 75 pruebas automáticas pasan. **Hoy no está lista para venderse como producto de pago.** Hay cuatro razones:

1. **Seguridad.** La auditoría encontró cuatro fallas graves (P0) en producción. Las tres de base de datos (colaboradores falsos, amistades falsas y fotos listables), más el cambio de dueño de un viaje, **se corrigieron y verificaron en producción el 2026-10-22** con el GO del dueño. La cuarta (envío de correos arbitrarios) está corregida en la rama y pendiente de despliegue. No hay evidencia de que alguien haya abusado de estas fallas.
2. **Cobro.** Nadie paga hoy. Los 11 usuarios tienen PRO de cortesía, Stripe está en **modo de prueba** y la publicidad ("30 días sin tarjeta") contradice lo que hace el checkout (pide tarjeta). Casi todos los beneficios que se anuncian como PRO están abiertos a cualquier cuenta gratuita.
3. **Exactitud.** Hay errores que muestran mal el dinero en flujos normales. El total del viaje muestra el presupuesto del usuario en lugar de la cotización. El hospedaje de un grupo se cotiza como si fuera una sola habitación. Gastos suma pesos, dólares y euros como si fueran la misma moneda.
4. **Iato y flujos centrales.** Cuando Iato busca vuelos u hoteles, casi siempre recibe un error en vez de los resultados (confirmado en el código), y además el chat no dibuja las tarjetas de vuelo ni de hotel. Un usuario nuevo que termina el onboarding entra en un bucle de redirecciones (reproducido en un arnés local). "Re-analizar" un viaje borra el diario, el equipaje y los gastos compartidos.

Al unificar los seis informes quedaron **110 hallazgos: 10 P0, 33 P1, 48 P2 y 19 P3** (detalle en `IATOS_HALLAZGOS_PRIORIZADOS.md`). La meta es llegar a 95 o más en cada dimensión de la sección 6. Hoy ninguna pasa de 45.

---

> **Actualización 2026-10-22, posterior a la auditoría.**
> - La migración `20261022120000_security_p0_fixes.sql` se **aplicó en producción** y se verificó en vivo:
>   - en `pg_policies` no queda ninguna de las 6 políticas peligrosas, y existen las nuevas `journal_photos_read_members` y `travel_moments_read_own`;
>   - `authenticated` ya no tiene INSERT ni UPDATE sobre `trip_collaborators`, `friendships` y `tracked_flights`;
>   - el trigger `trips_guard_owner` está presente y la FK `trip_collaborators_trip_fk` se agregó como NOT VALID;
>   - los datos siguen intactos (4 colaboradores, 2 amistades);
>   - el listado anónimo de `travel-moments` devuelve `[]` y una URL pública de avatar sigue sirviendo.
> - En la rama, pendientes de despliegue con Lovable, están corregidos:
>   - `send-email` (IATOS-004);
>   - el bucle del onboarding (IATOS-005);
>   - el recorte de herramientas de Iato (IATOS-006);
>   - el total del viaje (IATOS-007);
>   - el enlace del correo de cotización (IATOS-071);
>   - las reglas de `track-flight` (partes de IATOS-017 y 044);
>   - la fecha local en la UI (parte de IATOS-032).
> - La suite pasó de 75 a **88/88 pruebas**.
> - Las calificaciones de la sección 7 ya reflejan esta actualización.

## 2. Alcance

En el alcance:
- El frontend completo: 48 rutas, 47 páginas y 100 componentes.
- Las 53 funciones de servidor (Supabase Edge Functions, Deno).
- Las 49 migraciones SQL del repo: las 48 originales más la de correcciones de seguridad agregada hoy en la rama.
- RLS y storage.
- Las tareas programadas (pg_cron).
- Los integradores externos.
- Los textos comerciales y legales.
- Los datos de producción, en solo lectura.

Seis auditorías temáticas alimentan este documento:

| Informe | Tema |
|---|---|
| A | Acceso, cuotas, Stripe y promesa comercial |
| B | Concierge "Iato" y funciones de IA |
| C | Tareas programadas, alertas y notificaciones |
| D | Dinero, moneda y exactitud de cotizaciones |
| E | Frontend, UX, accesibilidad y móvil |
| F | Seguridad: RLS, funciones, secretos, storage, *prompt injection* y retención |

Más un inventario verificado en vivo ("Fase 0").

Fuera del alcance: pruebas de carga, revisión legal formal (LFPDPPP, PROFECO), auditoría del panel de Stripe, Travelpayouts o Resend, y pruebas en dispositivos físicos.

---

## 3. Método: qué se verificó y cómo

Cada afirmación de estos documentos cae en una de cinco categorías. Cuando algo no se pudo verificar, se dice.

### 3.1 Verificado en vivo contra producción (solo lectura, 2026-10-22)

- **Funciones desplegadas: 53/53.** Se hizo un sondeo OPTIONS sin ejecutar lógica. 51 responden 200 al *preflight*. `health-check` y `price-watch-cron` responden 401 porque exigen el secreto de cron. Un nombre inexistente da 404 (control). *Esto prueba que existen y están desplegadas, no que funcionen bien.*
- **Base de datos:**
  - 44 tablas en `public`, todas con RLS activo.
  - `comp_grants` no tiene políticas (solo el servidor la toca; es correcto).
  - Lectura anónima solo en tablas de referencia (`destination_daily_costs`, `historical_flight_prices`).
  - Todas las funciones SECURITY DEFINER tienen `search_path` fijo.
  - Funciones internas como `consume_free_quota`, `is_pro`, `check_rate_limit` o `purge_account_data` no son ejecutables por usuarios.
- **Políticas vulnerables presentes en producción.** Las políticas de F-01, F-02 y F-03 están confirmadas en `pg_policies`.
- **Sin evidencia de abuso pasado:**
  - las 4 filas de `trip_collaborators` las invitó el dueño del viaje;
  - hay 2 amistades;
  - el bucket `journal-photos` tiene 0 objetos;
  - `travel-moments` tiene 13 objetos (bucket público).
- **Buckets:** `recibos` es privado. `journal-photos` y `travel-moments` son **públicos**.
- **Datos:**
  - 11 usuarios y 25 viajes.
  - 11 suscripciones, **todas `comped`** (cortesía) y ninguna de Stripe. 10 se crearon en bloque el 2026-08-24 (beta) y 1 por `comp_grants` el 2026-10-21.
  - `usage_limits` tiene 0 filas: nadie ha consumido cuota gratuita, porque todos son PRO.
  - `tracked_flights` 0, `price_watches` 0, `affiliate_clicks` 1, `concierge_conversations` 4, `health_checks` 3.
- **Registro de migraciones.** `supabase_migrations.schema_migrations` tiene 35 versiones (hasta `20260824040643`) y el repo tenía 48. Las posteriores se aplicaron por SQL directo y no quedaron registradas, así que hay deriva entre el repo y la base.
- **Tareas programadas:**
  - `flight-watch-every-15-min`: 32 ejecuciones desde 2026-10-21 17:45, 0 fallos, HTTP 200 en las 27 respuestas registradas.
  - `price-watch-twice-daily` (03:17 y 15:17 UTC) y `health-check-daily` (13:07 UTC): creadas el 2026-10-21 17:45. Al hacer el inventario aún no les tocaba correr (0 corridas).
- **Secretos.** No se pueden leer. Verificación indirecta: el `health-check` del 2026-10-21 confirmó que existen los de GEMINI, LOVABLE, ANTHROPIC, SERPAPI, TRAVELPAYOUTS y STRIPE (este último en **modo prueba**).
- **Estado comercial y de proveedores**, dato que aportó el líder de la auditoría:
  - Stripe en modo TEST;
  - SerpApi con unas **216 búsquedas restantes**;
  - dominio de Resend **no verificado**.

### 3.2 Confirmado leyendo el código

- **B-01:** el resultado de cada herramienta del concierge se recorta a 6,000 caracteres y luego se vuelve a parsear como JSON, lo que da error. Confirmado en `supabase/functions/concierge-chat/index.ts:150-153`.
- **Los seis informes son en su mayoría lectura de código.** Cada hallazgo cita `archivo:línea`. En este consolidado se volvieron a leer los puntos en conflicto (ver 3.6).

### 3.3 Reproducido en local (sin tocar producción)

- **Pruebas del repo:**
  - `npx vitest run`: 18 archivos y **75/75 pruebas pasan**;
  - `tsc --noEmit`: 0 errores;
  - `npm run build`: correcto.
- **Réplica local de la base.** Se reprodujeron las 48 migraciones en un PostgreSQL 16 desechable con un *shim* mínimo de Supabase:
  - **antes de la corrección**, los 5 ataques (F-01, F-02, F-03, F-05, F-06) **tienen éxito**;
  - con la migración `supabase/migrations/20261022120000_security_p0_fixes.sql` (rama `claude/iatos-world-class`), **los 5 quedan bloqueados**;
  - los flujos legítimos pasan: agregar amigo por código, invitar, aceptar, que el colaborador edite y que el dueño quite a un colaborador;
  - el arnés está en `supabase/tests/security/`;
  - al cierre de la auditoría no estaba aplicada en producción; **se aplicó y verificó en vivo el 2026-10-22** (ver la actualización arriba).
- **Sondas locales con lógica copiada tal cual del repo:**
  - truncado de herramientas (B-01);
  - elección de viaje (B-08);
  - etiquetas de origen (B-05);
  - unicidad con NULL en Postgres/PGlite (C-01);
  - detección de cambios de vuelo (C-03, C-05);
  - FX contra las alertas de precio (C-09/D-09);
  - aritmética de presupuesto y monedas (D-01, D-06, D-07, D-19, D-20).
- **Bucle del onboarding (E-01).** Arnés con React y Supabase simulado: 195 navegaciones en 400 ms y el dashboard nunca aparece.

### 3.4 Deducido del código, sin ejecutar

La mayoría de los hallazgos de Stripe (A-04 a A-08, A-14, A-16), de concurrencia (C-06, C-07) y de UX en iOS (D-12/E-05) son deducciones razonadas del código y de la documentación de las librerías. Cada hallazgo dice cómo se reproduciría.

### 3.5 No verificable desde aquí (requiere al dueño o al proveedor)

- Valores de secretos y variables de entorno (por ejemplo, si existe `TRAVELPAYOUTS_MARKER`).
- Configuración de Stripe: Stripe Tax, `tax_behavior` del precio, Billing Portal, recordatorio de fin de prueba.
- Estado exacto del dominio en Resend y su efecto con varios destinatarios.
- Programas de afiliado confirmados en el panel de Travelpayouts.
- Configuración de Auth: si se exige confirmar el correo.
- Restricciones de la llave de Google Maps.
- Respuestas reales de SerpApi y Travelpayouts, y comportamiento real de los modelos (Gemini, Claude, Perplexity).
- Si los modelos señalados como retirados en B-13 responden hoy.
- Comportamiento en iPhone o Safari real.
- Si existe personal humano real detrás del "Fixer 24/7".
- Límite de tiempo de ejecución de las funciones en el plan contratado.

### 3.6 Conflictos entre informes y cómo se resolvieron

| Conflicto | Resolución |
|---|---|
| F dice 52 funciones; el inventario dice 53 | Se contó el repo: hay 53 carpetas de función (sin `_shared`), y el sondeo en vivo encontró 53 desplegadas. **Valen 53.** |
| C marca las tareas programadas en producción como "BLOQUEADO / no verificado" | El inventario en vivo encontró las 3 tareas y sus corridas. **Existen y la de vuelos corre sin fallos.** |
| C-16 (el correo de cotización enlaza a `/dashboard/trips/…`, que no existe) | En la rama, `_shared/email.ts` ya enlaza a `/dashboard/viajes/…`. **CORREGIDO EN RAMA**, pendiente de despliegue. |
| F-04 (`send-email` es un *relay* abierto) | En la rama ya está reescrito: solo invitaciones, verificación en el servidor, plantilla escapada y límite de frecuencia. **CORREGIDO EN RAMA**, pendiente de despliegue. |
| Severidades distintas para el mismo problema (por ejemplo C-09 P2 contra D-09 P1, o C-01 P1) | Se re-evaluó con un solo criterio (sección 4 del documento de hallazgos). Cada cambio se anota en el hallazgo. |

---

## 4. Inventario (números verificados)

| Concepto | Valor | Fuente |
|---|---|---|
| Archivos en `src/` | 211 | repo |
| Páginas / componentes | 47 / 100 | repo |
| Rutas (`<Route>` en `App.tsx`) | 48 | repo |
| Funciones de servidor | 53 (53/53 desplegadas) | repo + sondeo en vivo |
| Migraciones en el repo | 48 originales + 1 de seguridad (`20261022120000`, aplicada en producción el 2026-10-22 por SQL directo) | repo + en vivo |
| Migraciones registradas en producción | 35 (las demás se aplicaron por SQL directo, sin registro) | en vivo |
| Tablas en `public` | 44, todas con RLS | en vivo |
| Buckets de storage | 3: `recibos` (privado), `journal-photos` (público), `travel-moments` (público) | en vivo |
| Tareas programadas | 3: vuelos cada 15 min, precios 2 veces al día, salud 1 vez al día | en vivo |
| Pruebas automáticas | Al auditar: 18 archivos y 75 pruebas, todas pasan. Hoy en la rama: 88/88. Más un arnés SQL de RLS en `supabase/tests/security/`. Ninguna cubre funciones de servidor completas ni Stripe | local |
| Usuarios / viajes | 11 / 25 | en vivo |
| Suscripciones | 11, todas de cortesía (`comped`); 0 de Stripe; 0 pagando | en vivo |

---

## 5. Arquitectura (foto actual)

```
Navegador (React 18 + Vite 5 + TypeScript + Tailwind, PWA solo para push)
   │  supabase-js (llave pública anon + sesión del usuario)
   ▼
Supabase
   ├─ Auth (registro abierto con correo)
   ├─ Postgres: 44 tablas con RLS, funciones SQL (is_pro, consume_free_quota, get_access_state…)
   ├─ Storage: recibos (privado), journal-photos y travel-moments (públicos)
   ├─ Edge Functions (Deno): 53
   └─ pg_cron + pg_net: 3 tareas → flight-watch-cron, price-watch-cron, health-check
          │
          ▼
Proveedores externos
   ├─ IA de texto: Gemini directo (GEMINI_API_KEY) → respaldo Lovable AI Gateway (cadena aiFetch probada)
   ├─ Claude claude-sonnet-5-5: análisis de viaje (analizar-viaje). Dos funciones aún usan un modelo
   │    Claude anterior (B-13)
   ├─ Perplexity (sonar / sonar-pro): estado de vuelo, promociones, vida nocturna, apoyo en análisis
   ├─ SerpApi: Google Flights, Google Hotels, Google Maps/TripAdvisor, estado de vuelo (~216 búsquedas restantes)
   ├─ Travelpayouts / Aviasales: tarifas de caché (≤48 h) y enlaces de afiliado (marker 533299)
   ├─ Google Maps / Places / Routes: geocodificación, lugares, rutas, fotos
   ├─ Stripe: checkout de suscripción $99 MXN/mes, portal y webhook (MODO PRUEBA)
   ├─ Resend (vía gateway de Lovable): correos transaccionales (dominio NO verificado)
   ├─ Tipo de cambio: frankfurter (servidor), open.er-api (cliente); respaldos fijos 20.5 / 18.5
   ├─ Clima: open-meteo · Imágenes y video: Pexels · Generación de avatar: Lovable (imagen)
   └─ Telemetría: PostHog, Sentry · Push web: VAPID
```

Puntos de diseño relevantes para un comprador:
- **Identidad.** Toda función de pago exige un usuario autenticado, pero el registro es libre, así que "autenticado" equivale a "cualquiera con un correo". Las únicas cuotas del servidor están en `concierge-chat` (3 mensajes al mes gratis) y `analizar-viaje` (1 análisis gratis de por vida).
- **Funciones públicas.** Las cuatro funciones sin JWT (`stripe-webhook`, `flight-watch-cron`, `price-watch-cron`, `health-check`) se autentican por su cuenta y fallan cerrado. Eso está bien.
- **Origen del precio.** Hay una etiqueta (`fuente_precio`) que distingue "en vivo" de "estimado por IA", pero en varios caminos la escribe el modelo y no el servidor (hallazgo IATOS-026).
- **Lo que está bien hecho y conviene conservar:**
  - RLS en todas las tablas;
  - funciones SECURITY DEFINER con `search_path` fijo;
  - cadena de respaldo de IA probada;
  - reglas de alerta de precio probadas;
  - verificación de firma del webhook de Stripe;
  - total del análisis recalculado en el servidor;
  - borrado de cuenta que rechaza un `user_id` enviado por el cliente.

---

## 6. Estado del negocio hoy

| Concepto | Estado |
|---|---|
| Usuarios | 11, todos con PRO de cortesía (beta). **0 pagando.** |
| Cobro | Stripe en **modo prueba**: hoy no se puede cobrar a nadie. La configuración de impuestos (IVA sobre $99 MXN) no es verificable desde el repo. |
| Usuario nuevo | Entra como **gratis**: 3 mensajes de Iato al mes y 1 análisis de viaje de por vida. No recibe prueba automática, aunque la página principal promete "30 días gratis, sin tarjeta". |
| Prueba de 30 días | Solo existe vía Stripe Checkout, pide tarjeta y se puede repetir sin límite. |
| Beneficios PRO anunciados | 6. Solo una parte de 2 (chat ilimitado y análisis ilimitado) es exclusiva de verdad. El resto (Members Only, Fixer humano, cotizaciones verificadas, bóveda de beneficios, logística) funciona igual para cuentas gratis. |
| SerpApi | Unas 216 búsquedas restantes. Cuando se agoten, las cotizaciones "en vivo" caen al respaldo de IA, la tarea de vuelos sigue marcando revisiones "exitosas" sin datos (IATOS-033) y el aviso del health-check salta solo por debajo de 200. |
| Correo | Dominio de Resend sin verificar. Según el informe C (por confirmar con la documentación de Resend), en ese modo solo se entrega al dueño de la cuenta, así que los correos a usuarios (bienvenida, cotización, invitación) y a otros administradores probablemente no llegan. |
| Monitoreo | Hay un health-check diario de proveedores. No vigila que las tareas corran (IATOS-069) y su correo de alerta probablemente no llega (IATOS-034). |

---

## 7. Calificación de línea base por dimensión (0-100)

Criterio conservador: una dimensión solo sube de 90 si no tiene P0 ni P1 abiertos **en producción** y su comportamiento está cubierto por pruebas. Las correcciones que solo existen en la rama no suben la calificación hasta que se apliquen. **Meta: ≥95 en todas.** Calificaciones al 2026-10-22, después de aplicar en producción la migración de seguridad.

| Dimensión | Hoy | Justificación (una línea) |
|---|---|---|
| Seguridad y privacidad | **50** | 3 P0 y el cambio de dueño ya están corregidos y verificados en producción, sin evidencia de abuso; sigue abierto en producción el *relay* de correo (P0, corregido en rama), y quedan sin atender las columnas de perfil, los uploads y el *prompt injection*. Al cierre de la auditoría era 30. |
| Pagos y acceso PRO | **20** | Stripe en modo prueba, 0 cobros reales, prueba repetible, webhook que pierde errores, suscripciones duplicadas posibles y casi ningún beneficio PRO protegido. |
| Precisión de datos/cotizaciones | **35** | El total muestra el presupuesto, el hospedaje va a una habitación para N y Gastos mezcla monedas (P0); las etiquetas "en vivo" no siempre son confiables; el recálculo determinista del total y `enforceSources` sí están bien y probados. |
| Iato (concierge IA) | **25** | Las herramientas le llegan como error (P0) y las tarjetas de vuelo y hotel no se dibujan; hay precios de jet inventados y elección de viaje ambigua; la cadena de respaldo de modelos está probada. |
| Alertas y automatizaciones | **45** | Las 3 tareas existen y la de vuelos corre sin fallos; las reglas de precio están probadas; pero las fechas van en UTC, las fallas cuentan como éxito, hay alertas falsas por tipo de cambio y el correo de alerta no llega. |
| Experiencia y móvil | **35** | Bucle del onboarding para usuarios nuevos (P0), "Re-analizar" borra datos (P0), botón Atrás que duplica viajes, recuperación de contraseña frágil y navegación móvil que se encima. |
| Pruebas y calidad | **35** | 88 pruebas en verde (75 al auditar), compilación limpia y un arnés SQL de RLS nuevo; pero no hay pruebas de funciones completas ni de Stripe, el arnés no corre en CI y la prueba de presupuesto prueba una copia del código. |
| Operación y monitoreo | **30** | Hay health-check y cron, pero no vigila los trabajos, su correo no llega, las migraciones de producción no están registradas (35 contra 49; la de seguridad también entró por SQL directo), SerpApi está casi agotado y hay documentación de operación desactualizada. |
| Coherencia comercial | **20** | La publicidad promete "sin tarjeta" y el checkout pide tarjeta; se anuncian beneficios PRO que son gratis; "Fixer humano 24/7 por WhatsApp" no tiene respaldo; el README dice cosas falsas sobre el estado de las suscripciones. |

### Qué haría subir cada calificación (resumen)

- **Seguridad:**
  - ~~aplicar la migración de seguridad~~ (hecho el 2026-10-22);
  - desplegar `send-email` (IATOS-004);
  - columnas de `profiles` y uploads (IATOS-052 a IATOS-054).
- **Pagos:** decidir la política (prueba con o sin tarjeta y qué es PRO), pasar Stripe a producción y cerrar IATOS-011 a IATOS-022.
- **Precisión:** IATOS-007, 009 y 010, y luego asignar el origen del precio solo en el servidor (IATOS-026) y guardar un *snapshot* fechado de cada cotización (IATOS-080).
- **Iato:** desplegar IATOS-006, y luego 023 a 031, más un set de evaluación automatizado de 20 casos (diseñado en el informe B, sección C-3).
- **Alertas:** IATOS-032, 033, 034 y 038.
- **Experiencia:** desplegar IATOS-005, y luego 008, 041, 042 y 087.
- **Pruebas:** pruebas SQL de RLS en CI (el arnés de `supabase/tests/security/` es el inicio), pruebas de los *handlers* de Stripe y del concierge con dependencias simuladas, y extraer la lógica de presupuesto a módulos probables.
- **Operación:** registrar las migraciones, vigilar los trabajos, verificar el dominio de correo y fijar presupuesto y alertas de SerpApi.
- **Comercial:** una sola fuente de precios y beneficios usada por Landing, Pro, Legal y ProGate, y textos que solo prometan lo que existe.
