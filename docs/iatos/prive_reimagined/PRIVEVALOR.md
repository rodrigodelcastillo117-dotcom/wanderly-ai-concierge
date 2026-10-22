# privevalor — Privé Drops, Privilege Radar, Value of Your Privé, Insider's Notebook, Passport, vista previa, costos y métricas

Rama `claude/wc-privevalor` (desde `claude/cierre-auditoria` @ 9ff1466). Especificación: Documento B §6, §7, §8, §12, §14, §17 y §18 (22-oct-2026).
Nada se desplegó ni se aplicó en producción. Sin correos, sin llamadas de IA, sin sesiones de personas reales.

**Cambio de alcance a media tarea (líder, 22-oct):** THE PRIVATE EDIT (§9) pasó a THE PRIVATE EDITION (equipo `edition`,
`/prive/edicion/**`). No construí una Private Edit aparte: `PrivateEditTeaser` queda como ranura reservada que no pinta nada,
y PRIVÉ DROPS es la **única fuente** de "Privé Opportunities" para la revista (API estrecha documentada abajo). La preferencia
de correo opt-in de la Private Edit tampoco se construyó: le corresponde a `edition` (consentimiento de marketing ≠ correo transaccional).

## 1. Qué se construyó

| Área | Dónde | Qué hace |
|---|---|---|
| **PRIVÉ DROPS** (§6) | `/prive/drops` · `PriveDropsPage.tsx`, `value/DropCard.tsx`, `value/DropsTeaser.tsx` | Oportunidades tipadas (promoción pública, tarifa publicada, lealtad, tarjeta *potencialmente aplicable*, oferta temporal, beneficio IATOS por convenio, editorial etiquetada). Cada tarjeta muestra proveedor, destino, tipo, beneficio real, condiciones, elegibilidad, restricciones, vigencia, fuente con nombre, fecha de verificación, enlace oficial (pestaña nueva, sin referer) y estado (vigente / por verificar). Filtros por tipo y destino en la URL (se conservan al volver). Prioriza por viaje real, destinos guardados y programas de la Bóveda, y lo dice ("Para tu próximo viaje"). Sin nada verificable → mensaje honesto + contenido editorial útil (consejos del Insider con fuente). |
| **THE PRIVILEGE RADAR** (§7) | sección `#radar` de `/prive/drops` y ranura `<PrivilegeRadar />` | Lee la Bóveda **actual** (`user_vault_benefits`) y, si existe, la nueva del equipo `boveda` (`vault_items`, leída con SQL dinámico para no depender de su rama). Solo nombres y niveles: **nunca** números de socio ni de tarjeta. Coincidencia de marca = POSIBLE BENEFICIO (no elegibilidad). Estados: POSIBLE BENEFICIO · ELEGIBILIDAD POR COMPROBAR · BENEFICIO VERIFICADO (exige escribir cómo se verificó) · BENEFICIO UTILIZADO (exige estar verificado y fecha de uso). Beneficios propios manuales. |
| **THE VALUE OF YOUR PRIVÉ** (§7) | ranura `<ValueOfYourPrive />` | Cuatro cajas que nunca se suman entre sí ni entre monedas: ahorro **comprobado** (referencia con fuente + pagado + evidencia), **estimado** (referencia con fuente), **potencial** (beneficios del radar aún no usados, sin monto) y **valor sin ahorro** (experiencias organizadas + planes Privé agregados a viajes, contados aparte). El ahorro es columna **calculada** (referencia − pagado): nadie lo escribe a mano. |
| **THE INSIDER'S NOTEBOOK + BEFORE YOU GO** (§8) | `/prive/insider`, `/prive/insider/:destino` · `PriveInsiderPage.tsx`, `value/InsiderTipCard.tsx`, `value/BeforeYouGo.tsx` | Cuadernos por destino agrupados por categoría (cuándo ir, reservar antes, vestimenta, transporte, documentos, errores frecuentes, seguridad, temporada…), cada consejo con fuente oficial y fecha de revisión; los que dependen de una fecha vencen solos. BEFORE YOU GO: cinco cosas para el **próximo viaje real** del miembro (destino resuelto con el catálogo, alias y "París, Francia"); sin viaje no se inventa nada. Guardar consejo y **agregarlo a las notas del viaje** (aparece en "Tips de tu concierge" de `TripDetail`, con fuente y fecha, sin duplicar). |
| **THE PRIVÉ PASSPORT** (§12) | ranura `<PassportCard />` | Tarjeta: nombre, Member Since, número de miembro no sensible (`member_code` existente), antigüedad, estado. Registro voluntario y privado de visitados, experiencias, favoritos, deseos y recuerdos en línea de tiempo. Sin niveles por riqueza; sin columnas de compartir ni coordenadas. **Founding Member** solo con criterio explícito (abajo). |
| **Vista previa antes del día 90** (§14) | ranura `<PrivePreview />` | Presentación, las seis áreas, algunos destinos públicos (del adelanto `prive_teaser`), tres ejemplos editoriales marcados "Ejemplo ilustrativo", progreso real (N de 90 días de PRO pagado, sin cuenta regresiva) y cómo funciona. No llama a ninguna RPC protegida. Sin urgencia ni invitaciones inventadas; recuerda que PRO conserva todo. |
| **Costos** (§17) | §6 de este documento | |
| **Métricas** (§18) | `prive_value_events`, `prive_value_track`, `admin_prive_product_metrics` | Eventos sin datos personales y panel agregado para el equipo. |

Idioma: toda la interfaz en el idioma de la persona (español por omisión; inglés si `navigator.languages` empieza por inglés),
`src/lib/priveValueI18n.ts`. Marcas en inglés (`lang="en"`) con subtítulo en el idioma de la persona. Mismo criterio que
`priveI18n.ts` de prive-ux (que no está en mi base): **el líder puede unificar la detección** al integrar.

### Ranuras para prive-ux (contrato) — `src/components/prive/value/index.ts`

| Export | Dónde lo monta prive-ux | Sin sesión Privé |
|---|---|---|
| `<DropsTeaser />` | FOR YOU | no pinta nada |
| `<PrivateEditTeaser />` | FOR YOU | reservado para THE PRIVATE EDITION; hoy no pinta nada |
| `<PassportCard />` | MY PRIVÉ | no pinta nada |
| `<ValueOfYourPrive />` | MY PRIVÉ | no pinta nada |
| `<PrivilegeRadar />` (extra) | MY PRIVÉ (opcional; ya vive en `/prive/drops#radar`) | no pinta nada |
| `<BeforeYouGo onlyWhenNear />` (extra) | FOR YOU, cuando faltan ≤ 30 días o durante el viaje | no pinta nada |
| `<PrivePreview />` (extra) | `/prive` para PRO < 90 días y cuentas gratis (hoy `PriveHub` muestra `Progress`/`Teaser`) | es su caso de uso |

Todas sin props obligatorias. Rutas nuevas en `App.tsx` (lazy, dentro de `PriveRoot`): `drops`, `insider`, `insider/:destino`.

## 2. Modelo de datos y API

Migraciones nuevas (idempotentes, RLS, sin tocar tablas de otros equipos salvo **leer** `user_vault_benefits`, `vault_items` si
existe, `trips`, `recomendaciones`, `bookings`, `prive_*` del catálogo, y **agregar** líneas a `trips.tips_personalizados` vía RPC):

| Migración | Contenido |
|---|---|
| `20261024100000_privevalor_drops.sql` | utilidades (`prive_has_card_number`, `prive_has_fake_urgency`, `prive_has_percent`), eventos `prive_value_events` + `prive_value_track` + `prive_preview_track`, **`prive_drops`** + trigger de validación, vistas `prive_drops_v` / `prive_drops_live`, `prive_vault_programs`, `prive_trip_destination`, RPC `prive_drops` / `prive_drop`, importador `prive_drops_import_batch` |
| `20261024100100_privevalor_radar_value.sql` | `prive_radar_items`, `prive_value_entries` (ahorro calculado) + RPC `prive_radar`, `prive_radar_save`, `prive_radar_delete`, `prive_value_summary`, `prive_value_save`, `prive_value_delete` |
| `20261024100200_privevalor_insider.sql` | `prive_insider_tips`, `prive_saved_tips`, vista `prive_insider_tips_v` + RPC `prive_insider_index`, `prive_insider`, `prive_before_you_go`, `prive_tip_save`, `prive_tip_add_to_trip`, importador `prive_insider_import_batch` |
| `20261024100300_privevalor_passport.sql` | `prive_passport_entries`, `app_flags.prive_founding_cutoff` (null), RPC `prive_passport`, `prive_passport_save`, `prive_passport_delete` |
| `20261024100400_privevalor_seed.sql` | **generada** por `scripts/prive/load_value_curation.mjs` desde `data/prive/valor/2026-10/*.json`: 9 Drops + 20 consejos verificados, pasando por los mismos importadores |
| `20261024100500_privevalor_metrics.sql` | `admin_prive_product_metrics(_days)` (solo admins) |

**Permisos:** ninguna tabla nueva se lee ni escribe directo desde el cliente (`REVOKE ALL … FROM anon, authenticated`). Todo pasa
por RPC `SECURITY DEFINER` que empiezan con `prive_require(_ps)` (miembro Privé con sesión Privé válida). Las tablas personales
además tienen RLS `user_id = auth.uid()` como defensa en profundidad (probado concediendo SELECT a propósito: otra cuenta sigue
viendo 0 filas). Borrar la cuenta (`purge_account_data`) borra radar, valor, guardados, pasaporte y eventos automáticamente
(columnas `user_id uuid`; probado).

### Reglas que la base hace imposibles de romper (`prive_drops_validate`)
- Proveedor, fuente https, enlace oficial https, fecha de verificación y quién verificó, siempre; condiciones y elegibilidad en todo lo que no es editorial.
- **Porcentaje solo con comparación verificable:** `discount_pct` exige precio de referencia + precio de oferta + moneda + URL de la fuente de precios y que la aritmética cuadre (±0.5). Cualquier "40 %", "40 por ciento" o "percent" en los textos sin esa comparación → rechazado.
- Sin precio "antes" sin precio actual; todo precio con moneda y fuente.
- Sin escasez ni urgencia falsas (es/en: "solo quedan", "últimos lugares", "only 3 left", "last chance"…).
- Beneficio de tarjeta: debe nombrar la(s) tarjeta(s) (`program_match`) y la UI siempre dice "puede aplicar · confírmalo con tu emisor".
- **Beneficio IATOS:** solo ligado a un beneficio del registro de alianzas existente (`prive_partner_benefits`, el del equipo catalog); el texto sale del contrato; se publica solo si `prive_benefit_active()` (acuerdo **firmado** y vigente). Hoy no hay acuerdos → ese tipo no aparece. El importador nunca crea uno.
- Sin números de tarjeta en ningún texto de privevalor (13–19 dígitos seguidos, con o sin separadores).
- Estado **calculado**: `vencido` al pasar `valid_until` en la fecha local del destino; `programado` antes de `valid_from`; `por_verificar` a los 45 días sin revisión; `retirado` a mano o por convenio inactivo. Vencidos, programados y retirados salen solos de la lista; un enlace guardado a un vencido dice "vencido".
- El cliente repite estas reglas como segunda línea (`priveValueModel.ts`: `effectiveDropStatus`, `visibleDrops`, `verifiableDiscount`, `hasUnverifiablePercent`).

### API estrecha para THE PRIVATE EDITION (equipo `edition`) — "Privé Opportunities"
1. **Cliente (miembro):** `prive_drops(_ps text, _destination text = NULL, _types text[] = NULL, _interests text[] = NULL, _limit int = 30) → jsonb`
   `{ items: Drop[], expired_recent: int, destination_found: bool, generated_at }`. `Drop` = `{ id, slug, type, status, title{es,en}, provider{name,url}, destination{slug,es,en}|null, benefit{es,en}, conditions, eligibility, restrictions, valid_from, valid_until, price{offer,reference,currency,source,discount_pct}|null, source{url,name}, link, last_verified_at, relationship ('ninguna'|'afiliado'|'publicidad'|'convenio'), universes[], interests[], reasons[] ('viaje'|'guardado'|'boveda') }`. Solo `activo` y `por_verificar`. Cliente TS: `createPriveValueApi(content).drops({ destination, types, interests })` en `src/lib/priveValueApi.ts`; tipos en `src/lib/priveValueModel.ts`.
2. **Servidor (armado de la edición, sin datos de personas):** vista `public.prive_drops_live` (solo `service_role`): mismas columnas planas + `effective_status`. Úsala para la edición compartida y personaliza en el cliente con `prive_drops`.
3. **Intereses:** `interests` usa claves snake_case alineadas con la lista del dueño (`viajes_internacionales`, `hoteles_y_villas`, `formula_1`, `deportes`, `eventos_internacionales`, `cultura`, `arte`, `mexico`, `experiencias_extraordinarias`, …). `edition` puede mapearlas; si necesita más, se agregan en la curaduría, no en el código.
4. **Reglas para la revista:** marcar promociones como "información a la fecha de verificación" (`last_verified_at`); no reinterpretar porcentajes (usar `price.discount_pct` tal cual o nada); mostrar `relationship` (afiliado/publicidad) cuando no sea `ninguna`; no imprimir Drops `por_verificar` en el PDF sin su aviso.

### Curaduría (mismo patrón que `prive_import_batch`)
`node scripts/prive/load_value_curation.mjs --month 2026-10 [--today AAAA-MM-DD] [--emit-migration <archivo>]` valida (`scripts/prive/value-lib.mjs`,
espejo de la base), deja `report.json` y `import_dry_run.sql` en `data/prive/valor/_reportes/<mes>/` (ignorado por git) y, con
`--emit-migration`, genera la migración de siembra. En la base: `prive_drops_import_batch(filas, lote, dry_run = true)` y
`prive_insider_import_batch(…)` — solo servidor, **ensayo por omisión**, upsert por slug, rechazo por fila con motivo. Ronda mensual:
re-verificar cada fila en su página oficial, actualizar `last_verified_at` / `source_checked_at`, retirar lo que ya no exista.

### Founding Member — criterio explícito
"Founding Member" = membresía Privé **activada en o antes** de la fecha de corte que fija el dueño en
`app_flags.prive_founding_cutoff` (JSON `"AAAA-MM-DD"`). Hoy vale `null` → **nadie** es fundador. La tarjeta explica el criterio
cuando aplica. Ningún nivel depende de gasto, consumo o patrimonio.

### Interfaz con la Bóveda (equipo `boveda`)
Su rama (`claude/wc-boveda`) no está en mi base (sin commits). Definí una interfaz estrecha: `prive_vault_programs(uid) → (kind, label, tier, norm)`.
Lee `user_vault_benefits` (existe hoy: `credit_cards[bank, card_name, card_tier, network]`, `hotel_loyalty[chain_name, status_tier]`,
`airline_alliances[airline, alliance_name, tier_status]`, `car_rentals[company_name]`) y, **si existe** `vault_items`, sus filas de
`section IN ('membresia','tarjeta')` con `title, issuer, tier, program_id`. **Nunca** lee `member_id`, `membership_number`,
`customer_id` ni `number`. **Para el líder:** al integrar `boveda`, confirmar que `vault_items` conserva esas columnas; si cambian,
solo se ajusta esta función.

## 3. Fuentes de la siembra (todas leídas en la página oficial el **22-oct-2026**)

| Contenido | Fuente oficial | Qué se verificó |
|---|---|---|
| Drop: Louvre gratis el primer viernes desde las 18:00 (excepto jul/ago) y 14 de julio | https://www.louvre.fr/en/visit/hours-admission | texto literal; reservación obligatoria 17-oct → 1-nov-2026 |
| Consejos París (cierra martes; horarios; €32 fuera del EEE / €22 EEE; menores de 18 gratis; reserva obligatoria hasta 1-nov-2026; salida definitiva) | misma | horarios, tarifas "applicable as of 14 January 2026" |
| Drop + consejos CDMX: domingos gratis para mexicanos y extranjeros residentes; abre mar–dom 9–18 h; general $210; 5,048,893 visitantes 2025 | INAH Boletín No. 6 (6-ene-2026) https://www.inah.gob.mx/images/boletines/2026/6/Boletin%206.pdf y ficha https://www.inah.gob.mx/museos/museo-nacional-de-antropologia | **Conflicto encontrado:** la ficha dice "50 % de descuento: $110" y el boletín "50 %" de $210 (= $105). Por eso el Drop **no** muestra porcentaje ni precio entre semana y dice "confírmalo en taquilla". |
| Drop: Casino de Monte-Carlo €20 desde las 14:00 con €10 incluidos (≥ €40 en Le Salon Rose) | https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry | precio, condiciones |
| Drop: My Monte-Carlo Silver/Gold/Platinum entran gratis cuando abren las mesas | misma | texto literal |
| Consejos Mónaco: 18+ con pasaporte físico (sin copias ni ID digital); código de vestimenta; visitas 10–13 h (€20 / €15 / gratis 6–12) | misma | texto literal |
| Drop + consejo: GP de Mónaco 2027 (4–6 jun) y GP Ciudad de México 2027 (29–31 oct), **editorial** | https://www.formula1.com/en/racing/2027 | calendario oficial |
| Drops: Marriott Bonvoy Nightly Upgrade Awards (Gold Elite y superiores); noches desde 12,000 puntos | https://www.marriott.com/loyalty/redeem.mi | texto literal |
| Drop + consejo Tokio: tarjetas IC; depósito de 500 yenes; Welcome Suica y TOURIST PASMO sin depósito | https://www.japan.travel/es/plan/ic-card/ y https://www.pasmo.co.jp/visitors/en/ | texto literal |
| Consejos Tokio: declaración de aduana en línea/QR; prohibido ingresar carne y plantas (multa hasta ¥3 millones o 3 años) | https://www.japan.travel/en/plan/customs-and-duty/ | texto literal |
| Consejos Los Cabos: oleaje/corrientes; bahías para nadar (Médano, Playa del Amor, Acapulquito, Chileno); banderas; ballenas dic–abr | https://www.visitloscabos.travel/things-to-do/beaches/swimming-and-safety/ · …/whale-watching/ | texto literal |
| Consejos Nueva York: taxi JFK–Manhattan $70 fijos + recargos; sin cargo por maletas ni tarjeta; "Rate #01" y recibo | https://www.nyc.gov/site/tlc/passengers/taxi-fare.page | tarifas TLC |
| Consejo Londres: ETA £20, hasta 6 meses, cada persona (incluidos niños), no garantiza entrada | https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta | texto literal |

**No sembré** (no verificable hoy): beneficios de tarjetas (la página de Amex Platinum México dio 404), Hilton/Hyatt/IHG (403),
Tokyo Subway Ticket (403; solo resúmenes de buscador), Paris Museum Pass (sitio oficial inalcanzable; fuentes de terceros con
precios contradictorios), requisitos de visa de Japón para mexicanos (MOFA y embajada: 403). **Ningún beneficio IATOS** (no hay convenios).
Destinos con cuaderno: París, Mónaco, Ciudad de México, Los Cabos, Nueva York, Tokio y Londres — los más probables del piloto
(destinos destacados del Doc A); no tengo acceso a los viajes reales de Carlo, Rodrigo y Sophia (sin consola de producción), así
que **no** afirmo que sean "sus" destinos.

## 4. Pruebas
- **SQL** `supabase/tests/privevalor/run.sh` (Postgres 16 local, base `pval_*`): acceso (cuenta gratis, PRO < 90 días, anon, token ajeno), lecturas/escrituras directas negadas en todas las tablas y vistas, importadores solo del servidor, todas las reglas de honestidad de Drops, estados calculados, beneficio IATOS con acuerdo en borrador (no se publica), ensayo del importador, alias de destino, relevancia por viaje/Bóveda, filtros de la API de edition, radar (sin números, sugerencias, transiciones, tarjeta en texto, viaje ajeno), fugas entre cuentas (radar, valor, pasaporte, guardados, viaje) + RLS con permiso concedido a propósito, valor (cada regla por tipo, ahorro calculado, totales por tipo y moneda), Insider (fuentes, vencidos, alias, Before You Go del viaje real, agregar a notas sin duplicar, viaje ajeno), Passport (tarjeta, fundador con y sin fecha de corte, fechas, privacidad), métricas sin datos personales, idempotencia de las 6 migraciones y borrado de cuenta.
- **Vitest:** `src/test/priveValueModel.test.ts` (vigencia/vencimiento, ningún descuento sin comparación, estados del radar, separación del valor, Before You Go, Passport), `src/test/priveValueCuration.test.ts` (lote verificado, siembra sincronizada, validador, rutas lazy), `src/test/priveValueUi.test.tsx` (Drops, filtros en URL, candado PRIVE_*, teaser, radar, valor, pasaporte, Insider + agregar a viaje, idioma inglés, vista previa).
- **Playwright** `scripts/prive/value_evidence.mjs` (390×844 y 1440×900, Chromium emulado, Supabase simulado con la curaduría verificada; nada externo salvo Google Fonts): capturas en `docs/iatos/evidencia/privevalor/`.

### Resultados (22-oct-2026, esta rama)
| Suite | Resultado |
|---|---|
| `supabase/tests/privevalor/run.sh` (base `pval_suite`) | **144 OK, 0 FALLA** (6 de idempotencia + 138 casos). Único error: la migración de pg_cron (esperado en local). |
| `supabase/tests/prive/run.sh` (base `pval_prive`) | **89 OK, 0 FALLA**. Extendí la lista blanca de P54 con las RPC de privevalor (mismo mecanismo que el contrato del catálogo, nombre por nombre) y quité EXECUTE de `prive_has_card_number` a anon/authenticated (P53 lo detectó). |
| `supabase/tests/security/run.sh` (base `pval_sec`) | **95 OK, 0 FALLA**; los "permission denied" de `rls_attacks.sql`/`profiles_tier.sql` son los ataques esperados (igual que en la base). |
| Vitest privevalor (`priveValueModel`, `priveValueCuration`, `priveValueUi`) | **52/52** |
| Vitest completo (corrida final, tras todos los cambios) | **164/164 archivos, 1,552/1,552 pruebas**. Los 7 "unhandled errors" que reporta vitest vienen de `tripSelectionsPersist` y `godtierTripDetail` (preexistentes, no de privevalor). En una corrida anterior con la máquina saturada (load ≈ 24) fallaron por timeout 4 pruebas ajenas (`dashboardActiveTrip`, `godtierHome`, `priveHub`, `priveInvitation`); `godtierHome` y `priveHub` fallaban igual en la base intacta en ese momento. |
| `tsc --noEmit -p tsconfig.app.json` | 0 errores |
| `npm run build` | OK (`PriveDropsPage` 16.8 KB, `PriveInsiderPage` 4.7 KB, chunks bajo demanda; el arnés de evidencia no entra al build) |
| ESLint (archivos de privevalor) | 0 errores, 0 avisos |
| Playwright `value_evidence.mjs` | 16 capturas (8 escenas × 390/1440), 0 hosts externos, 0 problemas (sin scroll horizontal) |

Capturas: `docs/iatos/evidencia/privevalor/` — `drops`, `drops-radar`, `insider` (Before You Go del viaje a París), `insider-monaco`,
`insider-en` (inglés), `my-prive-slots` (Passport), `my-prive-value` (Value), `preview-dia-47` (vista previa), cada una `__390x844` y `__1440x900`.
Las capturas me llevaron a corregir: filtros que ocupaban la primera pantalla en móvil (ahora una fila deslizable) y sin estado activo
visible; chip de estado del radar fuera de su tarjeta; número de miembro truncado; "$" ambiguo (ahora código ISO: "MXN 1,100", "EUR 64");
"Sin registros" junto a "3 beneficios"; cuaderno de escritorio con una tarjeta por sección (ahora una rejilla con filtro de categorías).

## 5. Para desplegar (requiere autorización del dueño)
Migraciones, en este orden: `20261024100000` → `100100` → `100200` → `100300` → `100400` (siembra) → `100500`. Ninguna función
Edge nueva. Antes, en una réplica: `supabase/tests/privevalor/run.sh`. La siembra queda "por verificar" sola el 6-dic-2026 si nadie
la re-verifica. Para mostrar las ranuras: prive-ux monta `DropsTeaser`, `PassportCard`, `ValueOfYourPrive` (y opcionalmente
`PrivePreview`, `BeforeYouGo onlyWhenNear`, `PrivilegeRadar`).

## 6. Costos (§17)
privevalor **no** llama IA, mapas, fotos, correo ni servicios externos: todo es SQL sobre la base existente.
- Por visita a Drops: 1 `prive_drops` + 1 `prive_radar` + 1–2 `prive_value_track` (≈ 3–4 RPC, < 20 ms c/u en local). Insider: 1–2 RPC + Before You Go. MY PRIVÉ: `prive_passport` + `prive_value_summary`. Con 1,000 miembros activos y 10 visitas/mes ≈ 40,000 RPC/mes: dentro del plan actual de Supabase, **costo marginal ≈ $0 MXN por miembro**.
- Almacenamiento: filas pequeñas (Drops/consejos: decenas; por miembro: decenas de filas de radar/valor/pasaporte; eventos ≈ 40 por miembro/mes, ~100 bytes c/u).
- Límites: `prive_value_track` 120 eventos/min por persona (rate limit atómico existente), pasaporte 500 entradas, notas del viaje 60.
- **El costo real es humano:** re-verificar mensualmente ~30 filas ≈ 1.5 h/mes de curaduría (3 min por fila). Con más destinos crece lineal; el importador con ensayo evita errores caros.
- No hay trabajos en segundo plano ni planes costosos. El costo de IA de THE PRIVÉ KEY y de THE PRIVATE EDITION lo miden sus equipos.

## 7. Métricas (§18)
Eventos `prive_value_events` (solo código de evento, id interno de la cosa, destino, estado y superficie; **nunca** texto libre, montos, nombres, correos ni ubicaciones; `user_id` interno para contar retorno, se borra con la cuenta): `drops_view`, `drop_open` (reservado para una ficha de Drop; hoy no se emite), `drop_link_open`, `radar_view`, `radar_state_change` (servidor), `value_view`, `value_entry_added` (servidor), `insider_view`, `tip_saved` (servidor), `tip_added_to_trip` (servidor), `before_you_go_view`, `passport_view`, `passport_entry_added` (servidor), `preview_view`, `preview_pro_click`, `edition_teaser_click`.
Panel `admin_prive_product_metrics(días)` (solo admins): % de activación y mediana de días a activar, guardados, planes integrados a viajes, consejos a viajes, enlaces de reserva y de Drops abiertos, solicitudes, reservas verificadas con evidencia, radar por estado y beneficios utilizados, valor por tipo, Drops por estado/vistas, Insider, Passport, vista previa, **retorno** (miembros activos con actividad en ≥ 2 días) y **retención descriptiva** Privé vs suscriptores sin Privé (con la nota "no causal; en el piloto de 3 personas no es estadística"). "Primera experiencia con The Key" y "tiempo a la primera opción útil": `null` + "pendiente: lo instrumenta privekey".
Piloto (Carlo, Rodrigo, Sophia, cuando esté autorizado): para privevalor preguntar "¿alguna oportunidad o consejo les sirvió de verdad?", "¿el radar les dijo algo que no sabían?", "¿qué se sintió genérico?". Opiniones individuales, no validación estadística.

## 8. Hallazgos para el líder
- **Benefits.tsx (Bóveda, equipo `boveda`)** en la base muestra afirmaciones sin fuente ni fecha, al menos una probablemente **obsoleta**: "Hoteles.com Rewards · 1 noche gratis cada 10 reservadas" (Hotels.com Rewards fue reemplazado por One Key en 2023; no lo verifiqué en el sitio oficial), "Priority Pass · 30 días gratis con American Express Platinum" y "Wise · hasta $700 USD/mes sin comisión en cajeros". No las toqué (archivo de otro equipo); el radar/Drops ya cubren beneficios con fuente. Recomiendo que `boveda` las quite o las convierta en Drops verificados.
- INAH publica dos precios distintos para nacionales/residentes del Museo Nacional de Antropología (ficha: $110; boletín: 50 % de $210). Documentado; la app no muestra ninguno.
- `priveI18n.ts` (prive-ux) y `priveValueI18n.ts` (privevalor) detectan idioma igual; conviene unificar al integrar.

## 9. Mejoras adicionales (instrucción "GOD TIER")
- Validación de curaduría **en JS antes de tocar la base** (`value-lib.mjs`) con el mismo reporte de rechazos que la base, y migración de siembra **generada** desde los JSON (una sola fuente; prueba de sincronía).
- Segunda línea de defensa en el cliente: un Drop vencido que llegue de caché, o con un porcentaje no verificable, no se pinta (pruebas).
- `prive_trip_destination` resuelve destinos libres de viaje ("París, Francia") que `prive_resolve_destination` no resolvía; lo usan relevancia y Before You Go.
- Prueba de borrado de cuenta para las tablas nuevas (AGENTS.md). Esa prueba encontró un defecto propio antes de entregar: quitar un
  beneficio del radar con un "ahorro potencial" ligado rompía el CHECK (y con él `purge_account_data`). Corregido: la regla de vínculo
  vive en `prive_value_save` y un trigger borra el potencial huérfano (prueba V17 + Z01).
- Montos con código ISO de moneda (sin "$" ambiguo entre pesos y dólares) y filtros móviles en una fila deslizable con estado activo visible.

## 10. Riesgo residual
- Las fuentes cambian: sin la ronda mensual, los Drops pasan a "por verificar" a los 45 días (visible) y los consejos con `valid_until` vencen solos; los consejos sin fecha muestran "fuente revisada hace más de 6 meses" a los 180 días y salen de Before You Go.
- Coincidencia de programas por nombre (normalizado): un nombre ambiguo en la Bóveda puede producir una sugerencia "posible" de más (nunca una afirmación de elegibilidad).
- `tips_personalizados` puede ser reescrito por un re-análisis del viaje; el consejo queda guardado y se puede volver a agregar.
- Capturas en Chromium emulado, no en dispositivos reales.
