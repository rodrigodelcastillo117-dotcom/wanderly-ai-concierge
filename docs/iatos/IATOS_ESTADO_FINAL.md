# IATOS: estado final, calificación y GO/NO-GO

Fecha: 2026-10-22 (cierre de la operación nocturna). Producción: https://traveliatos.life. Código: rama `claude/iatos-world-class` = `main` en `8b1ff07` o posterior.

Este es el documento único para el dueño, el auditor externo (ChatGPT) y la reunión del viernes. Cada calificación sale de pruebas con evidencia; lo que no se probó se dice. El detalle está en los documentos citados.

## 1. Veredicto

| Pregunta | Respuesta |
|---|---|
| ¿La app funciona de punta a punta en producción? | **Sí.** Registro, plan, cotización con fuentes, viaje, Iato, gastos, cercanos, reservas, Members Only, Privé y correos están desplegados y verificados en vivo con cuentas sintéticas. |
| ¿Hay problemas graves abiertos? | **No.** 0 P0 y 0 P1 abiertos en código. |
| ¿Vender PRO a $99 MXN a gente que conocemos (lanzamiento por invitación)? | **CONDICIONADO** (auditoría de cierre, AUD-08). Decía GO, pero Stripe sigue en modo prueba, no hay una compra real reembolsada y la confirmación de correo está apagada en Supabase Auth (`mailer_autoconfirm: true`, verificado el 2026-10-22). Pasa a GO solo al completar y firmar `cierre/STRIPE_CERTIFICACION.md` (Fases 0–3). |
| ¿Abrir ventas masivas con publicidad? | **NO-GO todavía.** Faltan 4 cosas que solo el dueño puede hacer (sección 5). Sin ellas, las búsquedas en vivo se acaban a mitad de mes y los reembolsos no están probados. |
| ¿Privé? | **GO como piloto**: 3 invitaciones enviadas (Rodrigo, Sofía, Carlo). Invitaciones automáticas generales siguen apagadas. |
| ¿Reservas hechas por la IA? | **Código listo y apagado.** Se enciende después de configurar la recepción de correos en Resend y una prueba con un restaurante de prueba. |

**Calificación global: 80/100** (79.7 → 80.1 con el pase de imágenes) (promedio ponderado de la sección 2). Para llegar a 90+: las 4 acciones del dueño, prueba en iPhone/Android físicos y velocidad de carga en redes lentas.

## 2. Calificación por área (0–100, con evidencia)

| Área | Peso | Nota | Evidencia | Qué falta para 90+ |
|---|---|---|---|---|
| Seguridad y privacidad | 15 | **90** | 70 ataques en producción, 0 fallas (`evidencia/release10/sec/`). 95 pruebas SQL de RLS/ataques. Estados de reservas y solicitudes solo los cambia el servidor. | Repo público → privado. Decidir si las fotos de diario/momentos siguen públicas por URL exacta. |
| Cotizaciones y datos reales | 15 | **78** | Restaurantes salen de Google Places (antes la IA los inventaba). Cada precio lleva fuente y fecha; Travelpayouts ya no se muestra como "en vivo". Freno de presupuesto de SerpApi. 1,101 pruebas (`IATOS_DATOS_REALES.md`). | Plan de SerpApi (quedan ~200 búsquedas). Habilitar Places (New) y Routes en Google Cloud y verificar con `health-check?action=google_apis`. |
| Iato (Concierge 2.0) | 15 | **78** | Evaluación en vivo: los 8 escenarios del dueño y el caso Centurion responden bien con herramientas reales. 2 respuestas se pasan de largo (8 líneas vs 6). Primer paso visible en ~2 s, primer texto 5–11 s. Modo exigente: cenas ya da más opciones; en vuelos queda limitado a lo que trae la búsqueda real (no inventa). | Bajar el primer texto a <4 s. Más resultados de vuelos por búsqueda. |
| Pagos y planes | 10 | **72** | Stripe en modo prueba: checkout, webhook, prueba gratis y cancelación en portal verificados. Cuotas que no castigan fallas técnicas (FREE-01/02 verificados). | Reembolsos y disputas (requieren el panel de Stripe). Una compra real reembolsada. Descripción del producto en Stripe dice "sin límites". |
| UX, móvil y accesibilidad | 10 | **80** | 57 rutas × 7 anchos sin desbordes ni imágenes rotas; 249 botones sin muertos. Corregidos y publicados: chat tapado por la barra (P1), diálogos accesibles, panel de notificaciones, textos técnicos. Smart Spend, Gastos y Cercanos verificados en vivo. Fotos en todas las tarjetas: foto real de Google del lugar (solo si el nombre coincide), logo oficial de la aerolínea, o foto de su tipo de comida/categoría marcada "ilustrativa"; en vivo, el detalle de un viaje mostró 16 imágenes (7 reales de Google, 3 logos, 4 ilustrativas), 0 rotas, 9 llamadas. | Carga en 3G lenta (LCP 12–15 s en frío). Prueba en dispositivos físicos. |
| IATOS Privé | 10 | **86** | Ensayo completo en producción: 50 PASS; el P1 y el P2 encontrados se corrigieron y desplegaron. Revocación probada: sin PRO el servidor niega con `PRIVE_NOT_PRO` y cierra sesiones. 1,097 experiencias curadas visibles. | 3 detalles P3 (aterrizaje tras primer login, `trip_id` en solicitudes desde detalle, enlace de restablecer en la misma pestaña). |
| Members Only | 5 | **86** | Duplicados de París y otros 17 ocultos; 382 lugares en 79 ciudades; acceso solo PRO verificado sin filtrar nombres a no-PRO. | Revisión humana de los 166 lugares heredados. |
| Reservas y Booking Bridge | 10 | **72** | Puente desplegado: cada botón dice quién procesa la compra, enlaces firmados de salida, seguimiento de estado, mensajes de un toque por WhatsApp/correo/teléfono. 47 páginas reales de proveedores verificadas. **Enlaces de partners arreglados:** el redirect de Travelpayouts respondía 400 y dejaba al usuario en una página de error; ahora abren el proveedor directo. Revisión horaria de enlaces programada (primera corrida: 12 OK, 1 roto, 1 bloqueado). | Comisiones: generar enlaces válidos desde el panel de Travelpayouts. Reservas por IA apagadas hasta configurar Resend Receiving. |
| Correos | 5 | **78** | Un solo sistema premium: cotización con viajeros, foto, vuelo, hotel y procedencia de cada línea; correos internos legibles (sin JSON). 29 pruebas. Invitaciones Privé enviadas y entregadas por Resend. | Pegar las plantillas de Supabase Auth. Probar en Gmail/Outlook/Apple Mail reales. |
| Operación y costos | 5 | **80** | 5 tareas programadas: reintento de borrado de cuentas, revisión de enlaces, vigilancia de precios y de vuelos, chequeo de salud diario. `prive-cron` se corre a mano mientras las invitaciones automáticas sigan apagadas (el acceso Privé se valida en vivo en cada petición). Migraciones con checksum y registro. Costo estimado de Iato ~USD 0.004 por mensaje (antes ~0.025). | Tablero de costos real con datos de una semana. |

## 3. Qué está en producción hoy (verificado)

- **Base de datos:** 90 migraciones registradas. Hoy se aplicaron, con checksum contra el commit fijado: borrado de viaje con conversación, configuración de Iato, freno global de SerpApi, Reservas IA y Booking Bridge.
- **Funciones:** las 63 desplegadas desde `main`, incluidas las nuevas `ai-reservations`, `reservations-inbound`, `ai-reservations-cron`, `booking-bridge`, `booking-go` y `booking-links-cron`. Todas fallan cerrado sin sesión o sin firma (comprobado).
- **Frontend:** publicado (`index-DeT1CS3P.js` o posterior). Contiene: Inicio como centro de mando con franja de primer viaje en video, Planear con frase natural, análisis honesto, viaje con "qué sigue", Concierge 2.0 con streaming y acciones confirmables, Gastos con 45 monedas y 15 categorías, Cercanos con fotos reales en lista y ficha, Booking Bridge.
- **Privé piloto:** 3 concesiones de por vida (hasta que el dueño diga), 3 correos enviados (`email_status = sent`).
- **Interruptores apagados a propósito:** `ai_reservations_enabled`, `ALERT_EMAILS_ENABLED`, `BOOKING_EXACT_FLIGHT_FORM`, `trial_no_card_enabled`, `pro_limits_enforced`, invitaciones Privé automáticas.

## 4. Cómo volver atrás (rollback)

| Pieza | Cómo |
|---|---|
| Frontend | Lovable → historial de publicaciones → volver a la publicación anterior. |
| Funciones | Pedir a Lovable que despliegue desde un commit anterior (`0e50f1e` = antes de hoy en la noche). |
| Migraciones | Todas son aditivas (tablas, funciones, triggers); no borran datos. Para desactivar una función nueva basta apagar su interruptor. |
| Reservas IA / alertas por correo / compra exacta de vuelos | Ya están apagadas. |
| Privé de una persona | `admin_revoke_prive_grant(<grant_id>, '<motivo>', '<quién>')`; cierra sus sesiones. |
| Respaldo | `respaldo_prod_2026-10-22.tar.gz` (entregado al dueño). |

## 5. Lo que solo el dueño puede hacer (ordenado por impacto)

1. **SerpApi:** contratar Developer (USD 75) o Production (USD 150). Sin esto, las búsquedas en vivo de vuelos y hoteles se acaban con ~15–20 usuarios activos.
2. **Google Cloud:** habilitar Places API (New), Routes API, Geocoding y Time Zone; cuotas diarias y alerta de presupuesto; restringir la llave.
3. **Stripe:** activar eventos `charge.refunded`, `charge.dispute.*`, `invoice.paid`; quitar "sin límites" de la descripción del producto; cobrar en MXN (hoy el precio adaptativo cobró en USD; desde la auditoría de cierre el checkout apaga Adaptive Pricing y no abre si el precio no es $99 MXN/mes IVA incluido); hacer una compra real y reembolsarla. Procedimiento completo y verificación automática (`health-check?action=stripe_config`): `cierre/STRIPE_CERTIFICACION.md`.
4. **Supabase Auth:** exigir confirmación de correo (requisito para la prueba gratis sin tarjeta) y pegar las plantillas de `docs/iatos/emails/auth/`.
5. **Travelpayouts:** generar enlaces de afiliado válidos desde su panel para volver a cobrar comisión (hoy abrimos el proveedor directo porque el redirect daba error).
6. **Resend Receiving** en `reply.traveliatos.life` + secreto `RESEND_INBOUND_SECRET`, para encender las reservas hechas por la IA.
7. **Repo a privado** en GitHub.
8. Decisiones menores: números de `plan_limits`, teléfono y horario del Fixer, tope diario de Modo exigente (sugerido 20), aviso de privacidad (reservas en nombre del usuario), fotos públicas por URL, titular de Privé en inglés o español.

## 6. Riesgos conocidos

- No hubo pruebas en iPhone ni Android físicos (solo navegador con tamaño de teléfono).
- Carga lenta en redes 3G (12–15 s la primera vez).
- La primera respuesta de texto de Iato tarda 5–11 s (el primer paso visible aparece en ~2 s).
- Lovable regenera `types.ts` en cada sincronización; se mezcla sin conflicto, pero hay una restricción en producción (`trips_status_chk`) que no está en las migraciones del repo.
- El conector de Google de Lovable tiene tope de 6,000 solicitudes al día (≈2,000 usuarios PRO).

## 7. Documentos de detalle

`IATOS_RELEASE_GATE.md` (compuerta anterior), `IATOS_HALLAZGOS_PRIORIZADOS.md`, `IATOS_TEST_MATRIX.md`, `IATOS_CONCIERGE_2.md`, `IATOS_DATOS_REALES.md`, `IATOS_RESERVAS_IA.md`, `IATOS_BOOKING_BRIDGE_GO_NO_GO.md`, `IATOS_PRIVE_*`, `IATOS_PLAN_COMERCIAL.md`, `IATOS_PITCH_10_SLIDES.md`, `IATOS_COSTOS_UNITARIOS.md`, evidencia en `docs/iatos/evidencia/`.
