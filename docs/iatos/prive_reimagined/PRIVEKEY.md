# THE PRIVÉ KEY · equipo privekey

**Rama:** `claude/wc-privekey` (desde `claude/cierre-auditoria`) · **Fecha:** 22-oct-2026 · **Nada está desplegado.**
**Alcance (Doc B):** §2 THE PRIVÉ KEY, §3 YOUR WORLD IS READY, datos de personalización honesta para FOR YOU (Doc A Fase 1 §3 y §5), §11 THE PERFECT 48 HOURS y §10 SURPRISE ME como modos de The Key, y el costo por plan (§17).

---

## 1. Qué se construyó

### 1.1 The Privé Key es Iato en modo Privé, no otro chatbot
- **Mismo servicio:** `concierge-chat` con `mode: "prive_key"` (`supabase/functions/concierge-chat/priveKeyMode.ts`, enganchado en `index.ts` antes de cualquier llamada a modelos). Misma autenticación, el mismo viaje activo (`_shared/activeTrip.ts`), la misma sesión Privé (`x-prive-session` → `prive_search` con el JWT del usuario: `prive_require` decide) y el mismo catálogo verificado.
- **Mismo motor:** el plan lo arma el **Experience Planner** existente (`_shared/privePlanner.ts`). `_shared/priveKey.ts` solo lee el deseo, decide qué falta, ordena por nivel y valida presupuesto. Al planificador se le agregó un gancho aditivo `preference` (puntos por candidato) y “lucha libre” como espectáculo.
- **En el chat también:** la herramienta `search_prive` acepta `key: { request, mode }` y devuelve las mismas tres propuestas para que Iato las presente y ofrezca abrirlas en `/prive/key`.
- **Pantalla dedicada:** `/prive/key` (`src/pages/prive/PriveKeyPage.tsx`, ruta agregada en `src/App.tsx` dentro de `PriveRoot`). “Pregúntale a Iato” abre el Concierge de siempre con la pregunta escrita (`/dashboard/concierge?ask=…`); el Concierge solo llena el campo, nunca la envía.

### 1.2 Flujo (Doc B §2, los 16 puntos)
| # | Requisito | Cómo |
|---|---|---|
| 1 | Detecta destino y contexto | `detectPlace` con los 141 destinos/alias/barrios de la lista del dueño (generado de `scripts/prive/destinations.mjs` → `_shared/priveKeyPlaces.ts`); ocasión, compañía, menores, restricciones, fecha, presupuesto, modo (48 h, sorpresa, escala). Sin IA. |
| 2 | Usa bien el viaje activo | `resolveActiveTrip` (el mismo del chat). Sin lugar en el texto → destino, fechas y viajeros del viaje. Si el texto nombra **otro** lugar, no se mezcla y se dice. Con empate **no adivina**: pregunta el lugar con los destinos de esos viajes. “CDMX” reconoce el viaje a “Ciudad de México”. |
| 3 | Travel DNA consentido | `prive_search` ordena con `prive_user_signals`, que solo usa el DNA con `dna_consent = true` (ver §6: esa bandera nunca se guardaba; corregido). |
| 4 | Pregunta solo lo faltante | Lugar, fecha, personas, presupuesto: en **una sola ronda**, con botones. Sorpréndeme solo pide el lugar. Un país (“Japón”) pregunta la ciudad con opciones reales (Tokio, Kioto, Osaka). |
| 5 | Experiencias verificables | Solo `prive_search` (VERIFICADO/CURADO/ESTIMADO vigentes). Se excluyen clubes solo para miembros y eventos fuera de las fechas. |
| 6 | Hasta tres alternativas diferenciadas | THE SIGNATURE (calidad y reconocimientos con fuente dentro del presupuesto), THE INSIDER (carácter local y valor), THE UNEXPECTED (un universo que la firma no usó). **Ninguna experiencia se repite** entre niveles; con poco catálogo se muestran menos y se dice. |
| 7 | Presupuesto | Lo que por sí solo rebasa (precio con fuente o nota de precio de la curaduría, como ESTIMADO) no entra; si la suma conocida rebasa se quita el paso opcional más caro; si aun así rebasa, no se presenta. “Cabe en tu presupuesto” solo si **todo** tiene precio con fuente. |
| 8 | Fechas y horarios | Del planificador: horario publicado o “HH:MM sugerido · horario por confirmar”. Noche completa por omisión. |
| 9 | Ubicación del hotel | Hotel del viaje en ese destino: coordenadas del viaje o del catálogo Privé; si no hay, se dice que los traslados desde el hotel no están calculados (no se geocodifica: sería una API de pago). |
| 10 | Traslados con advertencias | ESTIMADO (línea recta × 1.4, 20 km/h + 10 min) “aprox., depende del tráfico”. |
| 11 | Restricciones y disponibilidad pendiente | Edad, dress code, reserva, alergias/vegetariano/accesible (se avisan, no se prometen), “Disponibilidad no consultada” siempre que no haya consulta real. |
| 12–13 | Booking Bridge y enlaces reales | “Cómo reservar” por paso: `offerFromVenue` + `BookingActions` del Booking Bridge (página oficial de reservas, sitio, Maps, guardar). La salida la vuelve a resolver `booking-bridge`. “Pedírselo al equipo IATOS” = `RequestDialog` → `prive_request_create` (solicitud, no reserva). |
| 14 | Guardar el plan | `prive_key_save`: guarda **solo referencias** (experience_id, horas, paso). Nombres, estado y enlaces se releen del catálogo. |
| 15 | Integrarlo al itinerario | `prive_key_add_to_trip` → `prive_add_to_trip` existente (`bookings` con `trip_id`, `pending`, `iatos_prive`), sin duplicar. Selector de viaje: preselecciona el que usó Iato; con empate no preselecciona. |
| 16 | Seguimiento sin inventar | “Mis planes” (`prive_key_plans`): por paso, propuesta / en el viaje sin reservar / estado real de la solicitud / “confirmado por el proveedor” **solo** con `external_confirmation` (la base además impide marcar confirmado sin evidencia). |

### 1.3 Modos
- **THE PERFECT 48 HOURS** (§11): “48 horas/dos días/fin de semana completo” o el botón; 2–3 días con el planificador, sin repetir lugares entre días ni niveles.
- **SURPRISE ME** (§10): una experiencia inesperada y adecuada (de noche, nada de museos a las 10:00). Acciones: Me encanta (guarda), Otra sorpresa (excluye las anteriores), Agregar a mi viaje, Cómo reservar. Cupo propio.
- **Escala**: “escala de N horas” limita los pasos (≤ 1 con < 6 h).

### 1.4 FOR YOU (ranuras para el shell de prive-ux) — `src/components/prive/key/index.ts`
| Ranura | Qué hace |
|---|---|
| `<PriveKeyLauncher />` | Acceso destacado a The Key con ejemplos, 48 h y Sorpréndeme. |
| `<CuratedForYou />` | 3–6 experiencias de `prive_for_you` del destino correcto. Etiqueta honesta: “Priorizado para tu viaje: …”, “Ordenado por tus gustos, con tu permiso” (solo si el servidor dio razones `dna:`), o “Selección editorial verificada · aún no personalizada”. Con dos viajes pregunta cuál; viaje sin cobertura lo dice y muestra editorial aparte. Motivo de cada tarjeta = razones del servidor o el hecho curado. |
| `<YourNextJourney />` | Con viaje: “Tu próximo capítulo: Ciudad de México.” + Explorar / Experiencias para mis fechas / Organizar una noche / Ver mi itinerario. Con empate no adivina; sin viaje ofrece planear uno. |
| `<YourWorldIsReady />` | §3. Miembro activado hace ≤ 30 días y con la ceremonia ya vista. Tres experiencias, una propuesta completa de The Key (en segundo plano, tope 8 s, con respaldo), enlaces a Antes de ir (`/prive/insider/:destino`), Oportunidades (`/prive/drops`), Tarjeta y pasaporte (`/prive/mi`), Sorpréndeme; sin viaje, “¿Por dónde empezamos?”; sin gustos, **configuración rápida** (3 toques, permiso explícito). Nunca bloquea. |

Todo el texto en el idioma de la persona (`src/lib/priveKeyI18n.ts`: español por omisión, inglés si el navegador está en inglés); nombres de marca en inglés con subtítulo (THE SIGNATURE · La firma). Cuando prive-ux publique `PriveLangProvider`, `useKeyLang` puede leerlo.

### 1.5 Base de datos — `supabase/migrations/20261024310000_privekey_plans.sql` (**requiere autorización**)
- Tablas `prive_key_plans` (planes, solo referencias) y `prive_key_events` (recorrido sin texto libre). RLS encendida y **sin privilegios directos** (contrato Privé P56): todo por RPC.
- RPC (todas empiezan con `prive_require`): `prive_key_save`, `prive_key_plans`, `prive_key_add_to_trip`, `prive_key_archive`, `prive_key_track`, `prive_key_taste_save`; panel `admin_prive_key_metrics` (solo `admins`).
- Corrección de `prive_save_progress` (ver §6). Agregadas a la lista permitida de la prueba P54 de `supabase/tests/prive/prive.sql` (extensión del contrato, no relajación).
- Cuentas borradas: ambas tablas usan `user_id` (cascada / SET NULL), como pide AGENTS.md.

---

## 2. Pruebas

| Suite | Resultado |
|---|---|
| `src/test/priveKey.test.ts` (motor) | **42/42** — lectura del deseo, solo preguntas faltantes, viaje correcto, 3 niveles diferenciados sin repetidos, presupuesto (Quintonil fuera con $10,000 para 2; dentro con $40,000; suma exacta con precios publicados; presupuesto imposible → nada), sin afirmaciones de reserva/VIP en 5 deseos del dueño, solo catálogo, respaldo sin datos, eventos fuera de fecha, sin alcohol, menores, 48 h, sorpresa, escala, inglés. |
| `src/test/priveKeyMode.test.ts` (modo de Iato) | **23/23** — sin sesión no consulta; preguntas sin base/cupo/costo; viaje correcto (mención, empate, fijado de otro destino, único); 1 RPC y 0 IA por plan; caché por usuario; cupo diario 429; cupo de sorpresas; respaldo sin cobertura; Otra sorpresa; Iato en el chat; hotel del viaje. |
| `src/test/priveKeyUi.test.tsx` (pantalla, con el `runPriveKey` real) | **9/9** — nada por tecla; preguntas → tres propuestas sin afirmar reservas; guardar solo referencias; al viaje correcto; enlaces del Booking Bridge; Pregúntale a Iato; Sorpréndeme; límite; inglés; candado. |
| `src/test/priveKeyForYou.test.tsx` (FOR YOU) | **18/18** — viaje, barrio, empate, fijado, sin cobertura, editorial; etiquetas honestas; razones solo del servidor; componentes; World Ready (solo recién activados, no bloquea, mide ms, gustos con permiso). |
| `src/test/privePlanner.test.ts` + `searchPrive.test.ts` (existentes) | 30/30 tras el cambio del planificador. |
| Vitest completo | ver §2.1 |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `npm run build` | exit 0 (✓ built) |
| `deno check supabase/functions/concierge-chat/index.ts` (Deno 2.1) | exit 0 |
| SQL `prive_key` (nueva, `pkey_prive_key`) | **47 OK / 0 FALLA** |
| SQL `prive` (`pkey_prive`) | **89 OK / 0 FALLA** |
| SQL `prive_catalog` (`pkey_prive_catalog`) | **110 OK / 0 FALLA** |
| SQL `security` (`pkey_security`) | **95 OK / 0 FALLA** (las líneas ERROR son los ataques denegados que imprime `rls_attacks.sql`) |
| SQL `concierge2` (`pkey_concierge2`) | **7 OK / 0 FALLA** |

Única línea esperada fuera de OK en todas: `pg_cron` no existe en local.

### 2.1 Vitest completo
- **Antes** (base `claude/cierre-auditoria`, máquina con carga ≈ 47 por los demás equipos): 1485 pasan / 15 fallan (todas por tiempo de espera en archivos ajenos).
- **Después** (esta rama, misma carga): **1584 pasan / 8 fallan** (1592; +92 pruebas nuevas de privekey). De las 8: 7 son las mismas ajenas que ya fallaban (dashboardActiveTrip, godtierHome ×2, membersMore, priveEntry, priveHub Grand Welcome, tripSplitLive) y 1 era de privekey (`priveKeyUi` › guardar y agregar al viaje) por el límite de 5 s con la máquina cargada: se le dio margen (30 s / 8 s para esperas) sin cambiar aserciones.
- Re-corrida aislada: las 4 suites de privekey + planificador + searchPrive + las ajenas que fallaban → privekey **92/92**; `tripSplitLive` y `membersMore`/`priveHub` pasan solos; `dashboardActiveTrip`, `godtierHome` ×2 y `priveEntry` **también fallan en la rama base** (`/home/user/wanderly-ai-concierge`, 32947ce) sin cambios de privekey: no son regresiones de esta rama.

### 2.2 Defecto ANTES / DESPUÉS (dna_consent)
`EXCLUDE=privekey supabase/tests/prive_key/run.sh` (sin la migración): `FALLA D1/D2/D2b/D3`. Con la migración: `OK D1/D2/D2b/D3`.

---

## 3. Costo por plan (Doc B §17)

The Key **no llama a ningún modelo de IA ni a APIs de pago**:

| Concepto | Por plan |
|---|---|
| Llamadas a IA / tokens | **0 / 0** |
| APIs de pago (SerpApi, Google, Pexels nuevas) | **0** (las fotos usan la caché existente de `pexels-image`, igual que el catálogo) |
| RPC de Postgres | **1** (`prive_search`); preguntas: 0; caché: 0 |
| Cómputo del motor (medido, 200 repeticiones) | 6.4 ms aniversario CDMX · 6.2 ms 48 h París · 5.6 ms Mónaco · 1.1 ms sorpresa |
| Respuesta | 17–30 KB (3 propuestas) · 4 KB (sorpresa) |
| Costo estimado | ≈ **USD 0.000002** (una invocación de Edge fuera del plan incluido); tipo de cambio en vivo solo si el presupuesto está en otra moneda (frankfurter, gratis, caché 6 h) |
| Referencia | Un mensaje del Concierge con modelo ≈ USD 0.004 promedio (IATOS_CONCIERGE_2.md §4). |

Controles: preguntas sin costo; caché por usuario y deseo normalizado (10 min); cupo diario por usuario (40 planes, 30 sorpresas, `check_rate_limit` con ventana de 24 h) además de 12/min y 80/h; nada por tecla; nada en segundo plano salvo una propuesta de ejemplo en Your World is Ready (≤ 1 por visita, cacheada). El panel `admin_prive_key_metrics` reporta `ai_cost_usd: 0`.

---

## 4. Tiempo a la primera opción útil (recorrido con guion, Playwright)

`scratchpad/pkey/shoot.ts`: vite local + servidor simulado donde `concierge-chat` es el `runPriveKey` **real** con filas reales de la curaduría (`src/test/fixtures/priveKeyCatalog.json`, generado por `scripts/prive/gen_key_fixture.mjs`); sin producción, sin cuentas reales, sin IA. Resultado en `docs/iatos/evidencia/privekey/recorrido.json`:

| Medición | 390 px | 1440 px |
|---|---|---|
| Enviar deseo incompleto → preguntas | 278 ms | 157 ms |
| Contestar (1 toque: presupuesto; el viaje ya dio lugar y fecha) → tres propuestas | 349 ms | 410 ms |
| Ejemplo del dueño completo → tres propuestas | 179 ms | 333 ms |
| Abrir la página → primera opción útil (incluye escribir y capturas del guion) | 3.47 s | 3.39 s |
| Your World is Ready abierta → primera experiencia visible | 1.48 s | 1.50 s |

En producción se suma la latencia de red y de la RPC (no medida aquí: no se usó producción). La meta de §3 (≤ 2 min para abrir una experiencia y entender cómo volverla plan) queda medida en vivo con `world_ready_shown`/`world_ready_open` (ms) y `first_option` (ms) → `admin_prive_key_metrics` (`first_option_ms_p50/p90`, `world_ready_within_2min_pct`).

Con un viaje a CDMX en contexto, “Quiero una noche inolvidable con mi pareja” solo preguntó **presupuesto**.

## 5. Capturas (`docs/iatos/evidencia/privekey/`, 390 y 1440, datos simulados)
`01` inicio · `02` solo lo que falta · `03` tres propuestas · `04` guardado, en el viaje y cómo reservar · `05` Perfect 48 Hours (París) · `06` Surprise Me · `07` FOR YOU con viaje (World is Ready + Launcher + Curated + Next Journey) · `08` FOR YOU sin viaje (editorial, “aún no personalizada”). Sin scroll horizontal en ninguna. Fotos: biblioteca ilustrativa local de prive-ux (Pexels), siempre con “Foto ilustrativa”; en las capturas se repiten porque la biblioteca simulada es por universo. `07/08` usan un arnés local no versionado (`pk-harness.html`) porque la maquetación de `/prive` es de prive-ux.

## 6. Mejoras adicionales (orden del dueño: GOD TIER)
1. **Defecto real corregido — el Travel DNA nunca podía activarse:** `prive_save_progress` descartaba `onboarding.dna_consent`, así que aunque el miembro dijera “sí” en la guía, `prive_user_signals` siempre veía `false`. Corregido en la migración (acepta true/false/null, rechaza otro tipo) con prueba antes/después.
2. Concierge `?ask=`: The Key (y cualquier pantalla) puede abrir a Iato con la pregunta escrita, sin enviarla.
3. Clubes solo para miembros (Soho House, Cigar Club) nunca se proponen en un plan; eventos con fecha fuera del plan tampoco.
4. Lucha libre cuenta como espectáculo en el planificador (antes no se podía planear).
5. “Foto ilustrativa” siempre legible sobre el degradado de la tarjeta.

## 7. Qué necesita autorización / despliegue
- **Migración** `20261024310000_privekey_plans.sql` (aditiva + corrección de `prive_save_progress`).
- **Función** `concierge-chat` (modo `prive_key`, `search_prive` con `key`). No hay secretos nuevos.
- **Frontend**: ruta `/prive/key`, ranuras de `src/components/prive/key`, `?ask=` en Concierge.
- Integración con **prive-ux**: poner en `/prive` `<YourWorldIsReady />`, `<PriveKeyLauncher />`, `<CuratedForYou />`, `<YourNextJourney />` (ya exportados, sin props) y el área THE KEY de la navegación → `/prive/key`. Posible conflicto trivial en `src/App.tsx` (una línea de ruta y un import).
- Integración con **privevalor**: los enlaces de World is Ready apuntan a `/prive/insider/:destino`, `/prive/drops`, `/prive/mi` (rutas del contrato).

## 8. Riesgo residual / pendiente honesto
- Hoy la curaduría casi no tiene precios ni horarios con fuente: la mayoría de las propuestas dirán “precio/horario por confirmar” y “no puedo asegurar que cabe”. Es lo correcto; mejora sola cuando la curaduría agregue fuentes.
- El orden de una noche con espectáculo es una sugerencia (los horarios no tienen fuente) y lo dice.
- Restricciones (alergias, accesibilidad) se avisan; el catálogo no las verifica.
- Escala: no se calcula el tiempo al aeropuerto (no hay coordenadas del aeropuerto en el viaje); se limitan los pasos.
- El recorrido real (≤ 2 min) solo se puede medir con miembros reales tras desplegar; aquí quedó instrumentado y medido con guion.
