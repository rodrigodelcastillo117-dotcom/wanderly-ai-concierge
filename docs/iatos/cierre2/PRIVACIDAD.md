# Cierre 2 · Grupo `privacidad` (rama `claude/r2-privacidad`)

Ronda de corrección posterior a la segunda auditoría (22-oct-2026). Base: `origin/main` = `3db952a`.
Hallazgos: T-P2-1, T-P2-2 (con JR2/JR2b), T-P2-3, T-P2-4, T-P2-5 + N-L1, D1, SEG-N4 (P3-6), P3-7 y la
caché de viajes del Service Worker (transversal §4.8). Fuentes: `INFORME_transversal.md`,
`INFORME_produccion.md`, `/home/user/audit2/transversal/work/t_trans.sql` y
`a2trans_adversarial.test.ts`.

Nada de esto se aplicó en producción. Todo se probó en Postgres 16 local (`/tmp/pgsec:55440`, bases
`r2privacidad_*`, ya borradas) y con Vitest.

## Tabla de hallazgos

| ID | Sev | Prueba (falla antes / pasa después) | Corrección (archivo:línea, commit) | Mutación | Estado |
|---|---|---|---|---|---|
| T-P2-1 | P2 | `supabase/tests/social/consent.sql` SC1–SC19: antes 24 FALLA (SC1 `{"ok":true,"amigo_id":…}` = amistad aceptada; SC17 = 25 avisos); después 29/29 OK. `src/test/r2privacidadSocialConsent.test.tsx` 6/6 (antes 5 fallan) y `referral.test.ts` 8/8 (antes 1 falla) | `20261026110000_r2_privacidad_social_consent.sql:66` (`agregar_amigo_por_codigo` → solicitud), `:310` (`regenerar_codigo_invitacion`), `:337` (`invitar_amigo_viaje`); RPC de responder, cancelar, quitar, bloquear, desbloquear y listar; `src/pages/Social.tsx`, `src/components/NotificationBell.tsx`, `src/pages/FriendProfile.tsx`, `src/lib/referral.ts`, `src/lib/friendRequests.ts`. Commit `d4496bb` | Insertar `'accepted'` en vez de `'pending'` → FALLA SC1, SC3, SC5–SC11. Quitar "solo invitación nueva" y la ventana de 7 días → FALLA SC17, SC18 | CORREGIDO Y VERIFICADO |
| T-P2-2 | P2 | `supabase/tests/security/r2_privacidad_fotos.sql` PF1–PF8b: antes 8 FALLA (PF1 bucket público, PF3 = JR2, PF4 = JR2b); después 17/17. `src/test/r2privacidadFotos.test.tsx` 7/7 (antes 6 fallan): GPS fuera de los bytes subidos, ruta en vez de URL pública, borrado de la foto antes de la fila | `20261026120000_r2_privacidad_fotos_privadas.sql:23` (journal-photos privado), `:71` (`journal_photo_visible`), `:97` (INSERT exige acceso al viaje); `src/lib/photoUpload.ts` (reutiliza `prepareVaultFile` de la Bóveda); `src/pages/TripJournal.tsx:63,90`; `src/components/lux/BestMomentsPanel.tsx:147`; `supabase/functions/tag-moment/*`. Commit `f1e39c2` | Quitar `has_trip_access` del INSERT → FALLA PF3. Subir el `File` original en TripJournal → falla la prueba de GPS | CORREGIDO Y VERIFICADO. Fotos viejas: PENDIENTE (script, ver abajo) |
| T-P2-3 | P2 | `r2_privacidad_documentos.sql` DV0, DV5–DV6c: antes FALLA (no existe la cola; TRD2 = 0); después OK (DV5 = 5 archivos en cola, DV6 = TRD2 1). `r2privacidadDocumentos.test.tsx` (deleteOwnedTrip llama la purga; `drainQueue`) | `20261026130000_r2_privacidad_documentos.sql:115` (trigger `trips_queue_storage_purge`), `:148` (`account_deletion_files` + cola), `purge_account_data` sin el id en la cola; función nueva `supabase/functions/trip-files-purge/`; `src/lib/tripMembership.ts`. Commit `18c4fae` | Quitar el trigger → FALLA DV5, DV5b, DV6 | CORREGIDO Y VERIFICADO en local; la función y su tarea programada requieren autorización |
| T-P2-4 | P2 | `r2_privacidad_documentos.sql` DV1–DV4d: antes FALLA (no existe `visibility` ni `visa`; Caro lee el pasaporte); después OK (DV0–DV6c: antes 10 FALLA, después 18/18). `r2privacidadDocumentos.test.tsx` 5 de UI (antes fallan) | `20261026130000_r2_privacidad_documentos.sql:49` (política SELECT de la fila), política de `storage.objects` con `trip_document_object_visible`, `set_trip_document_visibility`; `src/components/TripDocuments.tsx`, `src/lib/tripDocuments.ts`. Commit `18c4fae` | Quitar `visibility = 'viaje' OR uploaded_by = auth.uid()` de la política → FALLA DV3, DV3d | CORREGIDO Y VERIFICADO |
| T-P2-5 | P2 | `src/test/r2privacidadAvatar.test.ts` 7/7 (antes 3 fallan: no existe la acción `eliminar` ni el botón) | `supabase/functions/_shared/avatar-delete.ts`; `supabase/functions/generate-avatar/index.ts:121` (`{action:"eliminar"}`, antes de exigir `LOVABLE_API_KEY`); `src/pages/Profile.tsx:45,172` ("Borrar mi avatar" con confirmación). Commit `2992048` | Pruebas unitarias de `deleteAvatar` con falla de storage (no limpia filas) | CORREGIDO Y VERIFICADO (la llamada real a Storage no se probó contra un proyecto) |
| N-L1 | P3 (P2 por rastreo) | `r2_privacidad_avatar.sql` AVP0–AVP4b: antes FALLA AVP1, AVP2, AVP3 y AVP3b (el cliente pone `https://rastreador.example/p.gif`; el alta copia el metadato); después 11/11. `hardening.sql` P1b nuevo | `20261026140000_r2_privacidad_avatar.sql:38` (guard de `avatar_url`), `:49` (`handle_new_user` sin avatar) y limpieza de URL ajenas; `Profile.tsx` y `OnboardingDeep.tsx` ya no escriben `avatar_url`. Commit `2992048` | Quitar la línea del guard → FALLA AVP3, AVP3b | CORREGIDO Y VERIFICADO |
| D1 | P3 | `r2_privacidad_d1_politicas.sql`: con la deriva recreada, D1-0/0b = el extraño registra gasto y visita en un viaje ajeno; sin la migración FALLA D1-1..D1-5; con ella 9/9 | `20261026150000_r2_privacidad_d1_politicas_produccion.sql` (4 `DROP POLICY IF EXISTS`). Commit `ee1903e` | No quitar `user_visits_insert_own` → FALLA D1-1, D1-3 | CORREGIDO Y VERIFICADO en local; en producción requiere autorización |
| SEG-N4 (P3-6) | P3 | `r2_privacidad_photo_url.sql` PU1–PU4: antes FALLA PU1, PU2, PU2b, PU2c, PU4 (JR4); después 7/7 | `20261026160000_r2_privacidad_photo_url.sql` (limpieza + CHECK `trip_journal_photo_url_storage`). Commit `8a1c0d7` | Sin el CHECK → FALLA PU2, PU2b, PU2c, PU4 | CORREGIDO Y VERIFICADO |
| P3-7 | P3 | `r2_privacidad_tier_audit.sql`: antes FALLA TA1 y TA3 (`profiles_tier_audit=1`, igual que DEL2); después 3/3 | `20261026170000_r2_privacidad_tier_audit.sql` (`DELETE FROM profiles_tier_audit WHERE profile_id = p_user_id`). Commit `9b611b4` | La versión sin el DELETE (la de `20261026130000`) → FALLA TA1, TA3 | CORREGIDO Y VERIFICADO |
| SW (transversal §4.8) | P3 | `src/test/serviceWorker.test.ts`: 2 pruebas nuevas (dos cuentas en el mismo teléfono sin red; sesión anónima) fallan con el `sw.js` anterior y pasan después; 7/7 | `public/sw.js:68` (`sessionSub`), `:135` (llave con `__u=<sub>`; sin sesión no se guarda). Commit `c6acbdb` | El `sw.js` anterior = mutación (fallan las 2) | CORREGIDO Y VERIFICADO en Vitest; en iPhone real BLOQUEADO (no hay dispositivo) |

Las observaciones del auditor (`t_trans.sql`) corridas sobre la rama, en una base nueva con todas las
migraciones: SOC1 `{"ok": true, "estado": "pendiente"}` y SOC1b `pending` (antes `accepted`); SOC2
sin perfil; SOC3b solo vuelve a crear una solicitud; SOC4b `regenerar_codigo_invitacion`; SOC5 sin
avisos (no son amigos); DOC1 y DOC1b vacíos; DOC1c `visibility`; JR1 solo `travel-moments` (avatar);
JR2 rechazado por RLS; JR2b 0; JR4 rechazado por el CHECK; DEL2 `<ninguno>`; TRD2 1; TRD4 0. TRD1
sigue en 2 a propósito: en SQL los objetos solo quedan en la cola; los borra `trip-files-purge` con la
API de Storage (en producción, borrar desde SQL no borra el archivo).

## Qué cambia para los usuarios

- **Amigos.** Usar el código o el enlace de alguien ya no te hace su amigo: le llega una *solicitud* (en
  la campana y en Social) que acepta o rechaza. Mientras no la acepte, no ve tu Travel DNA, tus lugares
  ni tu sello Privé. Si la rechaza, no puedes volver a pedirla en 30 días; si te bloquea, nunca (y no te
  enteras). Quitar a un amigo no lo deja volver con tu código: a lo más te llega otra solicitud, y puedes
  elegir "Quitar y bloquear". En Social puedes **cambiar tu código** (el enlace anterior deja de
  funcionar), ver solicitudes recibidas y enviadas, cancelar las tuyas y desbloquear.
- **Invitaciones a viajes.** Llega un solo aviso por viaje (aunque te inviten varias veces) y dice
  "<Nombre> te invitó a planear un viaje juntos", sin copiar el destino ni textos con enlaces.
- **Fotos del diario y de "Mejores momentos".** Antes de subirse se les quitan los datos ocultos
  (ubicación GPS, modelo del teléfono), igual que en la Bóveda. Ya no tienen enlace público: solo las
  ven quienes están en el viaje (diario) o tú (momentos), con enlaces que caducan en una hora. Borrar
  una entrada del diario borra también su foto, y el dueño del viaje puede borrar la de otra persona.
- **Documentos del viaje.** Cada documento dice quién lo ve: "Solo yo" o "Todo el viaje". Pasaporte y
  visa (tipo nuevo) quedan en "Solo yo" por omisión; los pasaportes que ya estaban subidos pasan a "Solo
  yo" (quien lo subió puede compartirlo con un toque). Al borrar un viaje se borran también sus
  documentos y fotos, de cualquiera que los haya subido.
- **Avatar.** Nadie puede poner una imagen ajena (o un rastreador) como su avatar: solo lo guarda IATOS
  al crearlo o evolucionarlo. Elegir una de las 2 versiones sigue guardándolo igual. Hay un botón
  **"Borrar mi avatar"** en el perfil que borra la imagen que ven tus amigos, la imagen base, las
  versiones guardadas y los recuerdos dibujados (lo que promete el Aviso de Privacidad). Quien tuviera
  como avatar una URL que no es de IATOS verá su inicial hasta crear uno.
- **Gastos y visitas.** Ya no se pueden colgar de un viaje al que no perteneces (en producción esta
  regla estaba anulada por políticas viejas).
- **Borrar la cuenta** ya no deja el historial de cambios de plan.
- **Sin conexión.** Si en el mismo teléfono entra otra cuenta sin cerrar sesión, ya no ve sin red los
  viajes guardados de la cuenta anterior.

## Requiere autorización para producción

**Migraciones** (todas idempotentes, en este orden):
1. `20261026110000_r2_privacidad_social_consent.sql`
2. `20261026120000_r2_privacidad_fotos_privadas.sql`: pone `journal-photos` en privado. Debe salir junto con el frontend: las URL públicas viejas dejan de abrir y la app nueva usa `photo_path` y enlaces firmados.
3. `20261026130000_r2_privacidad_documentos.sql`: anota en la cola los huérfanos que ya existan.
4. `20261026140000_r2_privacidad_avatar.sql`: borra las `avatar_url` que no son de `uhkdewinscffhdonhhmt.supabase.co/.../travel-moments/avatars/<id>/` ni el `current_url` de `avatar_profiles`.
5. `20261026150000_r2_privacidad_d1_politicas_produccion.sql`
6. `20261026160000_r2_privacidad_photo_url.sql`: el CHECK lleva fijo el project_id de `supabase/config.toml`.
7. `20261026170000_r2_privacidad_tier_audit.sql`

**Funciones Edge**:
- Desplegar `trip-files-purge` (nueva; `verify_jwt = false`, ya está en `config.toml`) y programarla como tarea periódica con `x-cron-secret`, por ejemplo cada hora, para vaciar la cola, los huérfanos y lo que quede de cuentas borradas.
- Desplegar también `generate-avatar` (acción `eliminar`) y `tag-moment` (bucket privado).

**Frontend**:
- Social, campana, perfil del amigo, referidos, diario, momentos, documentos, perfil, onboarding y `public/sw.js`.
- Va junto con la migración 2: si la migración sale antes, la app vieja sube fotos que no podrá mostrar.

**Script de una sola vez**: `scripts/privacidad/migrar_fotos_privadas.ts`, con la llave de servicio. Sin `--apply` solo cuenta. Mueve los "Mejores momentos" viejos (públicos y con EXIF) al bucket privado ya limpios y limpia los JPEG viejos del diario. No se ejecutó. Lo que no sea JPEG queda contado para revisión manual.

## Decisiones y límites

- **travel-moments sigue público.** Ahí vive el avatar que ven los amigos (`profiles.avatar_url` →
  `<img>`), y la bandera de bucket es todo o nada. Los momentos nuevos van a `travel-moments-private`;
  los viejos, con el script.
- **`handle_new_user`.** `INFORME_produccion.md` describe la versión de producción (D2), pero no trae su
  texto exacto. La migración conserva lo que describe: id, email, full_name de `full_name` o `name`, y
  `ON CONFLICT DO NOTHING`. Solo quita `avatar_url`.
- **Políticas `*_own` de D1.** Solo se quitan `expenses_insert_own`, `expenses_update_own`,
  `user_visits_insert_own` y `user_visits_update_own`.
  - Las demás `*_own` de producción, según `INFORME_produccion.md`, son equivalentes al repositorio o no
    tienen GRANT que las active. No se tocan.
  - Están en: ai_user_preferences, behavioral_insights, concierge_requests, notifications, profiles,
    recomendaciones, travel_profiles, trips, user_vault_benefits, las SELECT/DELETE de expenses y
    user_visits, y `storage.objects` `recibos_*`.
  - El informe no da los 50 nombres: hay que confirmarlos con `pg_policies` en producción.
- **Amistades ya aceptadas.** Se conservan, porque no se puede saber cuáles se crearon sin
  consentimiento. Cualquiera puede quitarlas o bloquear.
- **`saludar_amigo`.** Sigue usando el nombre de pila con su propia limpieza (sin `<>`). Solo llega a
  amigos aceptados y una vez cada 24 h. No se cambió.
- **Archivos de otros grupos.**
  - `public/sw.js`: cambio mínimo, solo en la caché de viajes; no toca `EDITION_CACHE` ni
    `priveEditionOffline.ts`.
  - `purge_account_data` y `account_deletion_files`: se redefinen (versión del repositorio más los
    cambios de este grupo). Si otro grupo también las toca, hay que fusionar a mano.
  - `profiles_guard_sensitive`: lo mismo.
- **Pruebas que reaplican su migración** (`\ir`, para probar el relleno de datos viejos). En la
  rama, `security/run.sh` volvía a aplicar en orden todas las `r2_privacidad` después de cada una. En
  la integración (`claude/r2-integ`, formato de `r2-pruebas`) ya no se reaplica nada sobre la base de
  las pruebas: las `r2_privacidad_*.sql` corren en una copia de la base y cada `\ir <migración N>` se
  sustituye por N y todas las posteriores en orden (Q-L1). Las migraciones se renumeraron a
  `20261026110000`…`20261026170000` porque chocaban con las de `reservas`.

## Resultados de las suites (bases nuevas, rama final)

| Suite | Base (`3db952a`) | Rama |
|---|---|---|
| security | 156 OK, 0 FALLA | 222 OK, 0 FALLA |
| social | 70 OK, 0 FALLA | 99 OK, 0 FALLA |
| boveda | 50 OK, 0 FALLA | 50 OK, 0 FALLA |
| avatar | 41 OK, 0 FALLA | 41 OK, 0 FALLA |
| members_more | 30 OK, 0 FALLA | 30 OK, 0 FALLA |

El único error de migración es el esperado (`pg_cron` no existe en local).
- `deno check --no-lock` (Deno 2.1 no lee el `deno.lock` v5): exit 0 en tag-moment, trip-files-purge, generate-avatar, avatar-evolve, delete-account y account-deletion-retry.
- `npx tsc --noEmit -p tsconfig.app.json`: sin errores.
- Vitest completo (`npx vitest run --testTimeout=60000`): 208 archivos, 2292 pruebas, 2291 pasan y 1 falla.
  - La que falla es `src/test/priveUx.test.tsx` › "sin texto en inglés para quien usa español". También falla en la base `3db952a`, sin los cambios de esta rama (verificado en un worktree aparte).
  - Es de Privé, fuera del alcance de este grupo.
- `npm run build`: OK.
