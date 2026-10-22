# IATOS: compuerta de liberación (GO / NO-GO)

Fecha: 2026-10-22. Rama `claude/iatos-world-class`. Este documento decide **qué se puede llevar a producción y con qué condiciones**. El paso a paso técnico está en `IATOS_PLAN_MEJORAS.md` §1 (compuertas, migraciones, funciones, frontend, verificación V1–V21 y rollback); aquí no se repite. IATOS Privé tiene su propia compuerta: `IATOS_PRIVE_RELEASE_GATE.md`.

## Resumen para fundadores

- **Hoy en producción ya está cerrado lo más grave**: los 4 huecos P0 de seguridad (F-01, F-02, F-03, F-05 y la parte de base de datos de F-06) y el envío libre de correos (F-04) están corregidos **y verificados en producción**.
- **Todo lo demás está corregido en la rama, con pruebas, pero no desplegado**: 94 hallazgos en estado FIXED_UNVERIFIED. Ninguno de los P0 o P1 está abierto. Para que sirvan a los usuarios hay que desplegarlos (35 migraciones, 50 funciones y el frontend), con tu GO.
- **Veredicto: GO para desplegar la rama**, en el orden del plan y con los interruptores comerciales apagados. **NO-GO** todavía para tres cosas que dependen de ti: la prueba de 30 días sin tarjeta, aplicar los límites de PRO y procesar reembolsos/disputas en modo real.
- **¿Vender PRO a $99 MXN?** **GO condicionado**: técnicamente sí después del despliegue y de las verificaciones V1–V21, siempre que se cumplan las 4 condiciones de la sección 4. Antes del despliegue, NO-GO (lo que hoy está en producción todavía tiene errores de cuotas, cotizaciones y cobros que ya están corregidos en la rama).

## 1. Estado de los hallazgos (conciliado contra el código)

Fuente: `IATOS_HALLAZGOS_PRIORIZADOS.md` §0 (cada hallazgo con commit y prueba).

| Severidad | VERIFIED | FIXED_UNVERIFIED | BLOCKED | OPEN | REGRESSED | Total |
|---|---|---|---|---|---|---|
| P0 | 4 | 6 | 0 | 0 | 0 | 10 |
| P1 | 1 | 29 | 6 | 0 | 0 | 36 |
| P2 | 0 | 42 | 5 | 2 | 0 | 49 |
| P3 | 0 | 17 | 1 | 1 | 0 | 19 |
| **Total** | **5** | **94** | **12** | **3** | **0** | **114** |

- **Regla de aceptación del prompt maestro: "P0 abierto = NO-GO".** No hay P0 abiertos. Los 6 P0 FIXED_UNVERIFIED pasan a VERIFIED con el despliegue y las verificaciones V1–V21.
- **OPEN (ninguno P0/P1):** IATOS-062 (restaurantes sugeridos por la IA guardados como del viaje), IATOS-064 (`parsear-viaje` y `parse-trip-file` sin validar el JSON), IATOS-110 (`evaluar-logros`).
- **Restos menores documentados** dentro de hallazgos ya corregidos: 081 (el usuario aún puede escribir `price_amount`/`commission_amount` de sus reservas), 082 (falta `CHECK (amount > 0)` en `expenses`; hoy lo valida la pantalla — pendiente revisar si la división de gastos usa negativos antes de ponerlo), 096 (CORS `*` en `stripe-checkout` y `delete-account`: riesgo bajo, porque la autenticación es por token y no por cookie), 074 (tasas fijas en el prompt de `parsear-viaje`), 071 (redirección `/dashboard/trips`).
- **Corregido hoy:** IATOS-114 (un usuario podía marcar como confirmada su propia solicitud al concierge) — `0825360`, prueba CR1–CR4. La promesa "te contactará por email o WhatsApp en minutos" del Fixer — `63b873a`.

## 2. Pruebas que respaldan el veredicto (corridas en la rama)

| Suite | Resultado |
|---|---|
| Vitest | **737/737** en 106 archivos |
| TypeScript (`tsc`) | sin errores |
| Build de producción | correcto |
| `deno check` de las funciones cambiadas | correcto (lo reporta cada grupo) |
| SQL seguridad (`supabase/tests/security/run.sh`) | 91 líneas OK, ataques A1–A5 rechazados, flujos L1–L7 bien, `round_b`, `profiles_tier` T1–T7 y `concierge_requests` CR1–CR4 OK |
| SQL pagos | 63 OK |
| SQL costo | 16 OK |
| SQL operación | T1–T9 y C1 OK (incluye concurrencia) |

**Lo que NO está probado de punta a punta:** el despliegue mismo, los correos reales (Resend sin dominio verificado), Stripe en modo prueba contra el webhook nuevo, PostHog real, y los dispositivos físicos iOS/Android. Por eso todo sigue FIXED_UNVERIFIED hasta V1–V21.

## 3. Veredicto por componente

| Componente | Veredicto | Condición |
|---|---|---|
| 35 migraciones (`20261022130000` … `20261022146300`) | **GO con tu autorización** | G-0 (respaldo) primero. Aplicar en el orden de `IATOS_PLAN_MEJORAS.md` §1a, verificando cada una. **Ojo:** `141300` quita la política con la que la página Social actual lee los perfiles de amigos; aplicarla junto con la publicación del frontend nuevo (paso c) para que no desaparezcan los nombres. Antes de `146000` ya corrí la consulta de "quién perdería Members": 0 personas. |
| 50 funciones (un despliegue con Lovable, ~2–4 créditos) | **GO con tu autorización** | Después de las migraciones (varias funciones fallan cerrado sin ellas, p. ej. las cuotas). |
| Frontend (138 archivos) | **GO con tu autorización** | Después de las funciones. G-1 resuelto: los textos de la prueba leen `public_plan_config()` y dicen la verdad con el interruptor apagado o encendido. G-2 (N-09) resuelto y probado. |
| Prueba 30 días sin tarjeta (`trial_no_card_enabled`) | **NO-GO** | Requiere: confirmación de correo obligatoria en Supabase Auth (G-3), dominio de Resend verificado y tu GO. Con la configuración actual, cualquier correo inventado recibiría 30 días de PRO. |
| Límites de PRO (`pro_limits_enforced`) | **NO-GO hasta tu aprobación** | Aprobar los valores de `plan_limits` (DEC-01). Los textos ya no prometen "ilimitado". |
| Reembolsos y disputas en modo real | **NO-GO** | Activar `charge.refunded`, `charge.dispute.created/closed` e `invoice.paid` en el webhook, confirmar la versión de API y correr `docs/ops/stripe-modo-prueba.md` en modo prueba. |
| Borrado de cuenta | **GO** | El paso de PostHog queda `pending_key` hasta que pongas `POSTHOG_PERSONAL_API_KEY` y `POSTHOG_PROJECT_ID`; programar `account-deletion-retry`. |
| Members Only = PRO | **GO** | La contraseña compartida queda retirada; 0 usuarios pierden acceso. |
| Corrección de `profiles.tier` (DEC-05) | **GO solo en modo prueba** | `sync_profile_tier(true)` (simulación) primero; el modo real requiere tu autorización. No otorga ni quita PRO. |

## 4. ¿Se puede vender PRO a $99 MXN?

**GO condicionado.** Después del despliegue y de V1–V21, el producto cumple lo que promete la página PRO: cuotas que no castigan los fallos técnicos, cotizaciones con fuente y vigencia, cobro y cancelación consistentes con Stripe, privacidad entre cuentas y un Concierge que no inventa. Condiciones:

1. Desplegar la rama (secciones 1a–1c del plan) y pasar V1–V21 sin fallas de seguridad (V2, V18).
2. Stripe: precio con IVA incluido, eventos del webhook activados y una compra real reembolsada para verificar el flujo completo (IATOS-011, 045, 049).
3. Resend con dominio verificado (bienvenida, alertas, Fixer) — IATOS-034.
4. Plan de SerpApi contratado para que las búsquedas en vivo no se corten a mitad de mes — IATOS-015 (con 216 búsquedas restantes no alcanza para usuarios de pago).

Sin esas cuatro: **NO-GO** para cobrar a personas que no conocemos.

## 5. Resumen pedido en el Addendum

1. **Defectos anteriores ya verificados en producción:** F-01, F-02, F-03, F-04, F-05 y la parte de BD de F-06 (IATOS-001 a 004 y 016).
2. **Correcciones existentes pendientes de prueba en producción:** 94 (FIXED_UNVERIFIED), entre ellas FREE-01, FREE-02 y AVATAR-01 del Addendum, con sus pruebas obligatorias en la rama.
3. **Nuevos problemas de Lovable:** los tres del Addendum (FREE-01, FREE-02, AVATAR-01) y los de la conciliación de hoy: 166 lugares de Members Only insertados directo en producción sin migración (IATOS-072, deriva repo/producción) e IATOS-114.
4. **Correcciones realizadas en desarrollo:** ver `IATOS_HALLAZGOS_PRIORIZADOS.md` §3 (commit y prueba por hallazgo).
5. **Pruebas ejecutadas:** sección 2.
6. **Riesgos abiertos:** el despliegue grande (mitigado con orden, verificación y rollback), `141300` y la página Social, el dominio de correo, el volumen de SerpApi, la dependencia de Lovable para desplegar funciones, y que no hubo pruebas en dispositivos físicos.
7. **Decisiones que requieren tu autorización:** sección 6.
8. **Estado GO/NO-GO:** secciones 3 y 4.

> Nota honesta: el prompt maestro pedía responder "10 preguntas finales". Su texto exacto se perdió cuando se compactó esta conversación; este documento responde los 8 puntos del Addendum y el GO/NO-GO de PRO a $99. Si me los vuelves a pegar, los contesto uno por uno.

## 6. Lo que necesito de ti, en orden

1. **G-0:** confirmar que existe un respaldo (o PITR) de la base antes del paso a).
2. **GO para el despliegue** (migraciones → funciones → frontend → V1–V21).
3. En Stripe: activar los eventos y confirmar la versión de API; correr el runbook de modo prueba.
4. En Resend: verificar el dominio. En Lovable → Secrets: `HEALTH_ALERT_EMAIL`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`.
5. Decidir: valores de `plan_limits` (DEC-01), prueba sin tarjeta (DEC-02, requiere confirmación de correo en Auth), plan de SerpApi, teléfono/horario del Fixer, `sync_profile_tier` en modo real (DEC-05), registrar migraciones en `schema_migrations` (IATOS-072).
