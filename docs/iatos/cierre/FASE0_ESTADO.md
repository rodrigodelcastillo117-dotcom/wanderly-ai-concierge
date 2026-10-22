# Fase 0 — Estado real antes de corregir (2026-10-22, ~13:45 UTC)

Fuente: git del repositorio, consultas de solo lectura a la base de producción (proyecto Supabase `uhkdewinscffhdonhhmt`) y el HTML público de https://traveliatos.life. Nada se modificó en producción para producir este documento.

## Código

| Concepto | Valor |
|---|---|
| ZIP auditado (`iatos_auditoria_2026-10-22.zip`) | commit `06865cb` |
| `main` (fuente de Lovable) | `f62466e` |
| Rama de cierre (esta) | `claude/cierre-auditoria`, creada desde `f62466e` |
| Frontend publicado | `index-DOKp3dhS.js` = build de `f62466e` (contiene "Hay una versión nueva de IATOS") |

### Diferencia ZIP auditado → HEAD (`06865cb..f62466e`, 17 archivos, +330/−34)
| Cambio | Archivos | Relación con la auditoría |
|---|---|---|
| Sesión Privé en `localStorage` (compartida entre pestañas) + campo oculto de usuario para gestores de contraseñas + pista de autollenado | `src/lib/priveSession.ts`, `LockScreen.tsx`, `PasswordCreator.tsx`, `PriveUsernameField.tsx` | Toca la superficie de AUD-01; el grupo Privé evalúa el riesgo |
| Regreso a la invitación Privé después de iniciar sesión | `src/pages/Auth.tsx` | — |
| Enlaces externos siempre en pestaña nueva (`rel=noopener noreferrer`) | `src/lib/externalLinks.ts`, `src/main.tsx` | Superficie de AUD-04 (salidas a proveedores) |
| Chequeo de IA en palabras; Gemini saturado = aviso | `supabase/functions/health-check/checks.ts` | Operación |
| Aviso de versión nueva | `src/lib/versionCheck.ts` | — |

Ningún hallazgo AUD-01…AUD-08 se corrigió entre el ZIP y HEAD: todos siguen abiertos para investigación.

## Producción (lectura, 13:30–13:45 UTC)

| Concepto | Estado |
|---|---|
| Migraciones registradas | 90; la última `20261023180000_booking_bridge` |
| Migraciones del repo sin aplicar | 0 |
| Funciones Edge | 63 desplegadas desde `main` (`ca44e48` todas; después `concierge-chat`, `place-photo`, `analizar-viaje`, `booking-*`, `health-check` desde commits posteriores hasta `f62466e`) |
| Tareas programadas (pg_cron) | `account-deletion-retry-hourly`, `booking-links-cron-hourly`, `flight-watch-every-15-min`, `health-check-daily`, `price-watch-twice-daily` (todas activas). `prive-cron` y `ai-reservations-cron` **no** programadas (a propósito) |
| Interruptores | `ai_reservations_enabled=false`, `trial_no_card_enabled=false`, `pro_limits_enforced=false`, `members_requires_prive=false` |
| Stripe | **Modo prueba** (reportado por `health-check`: "Stripe está en modo de prueba"). No hay cobros reales |
| Resend | Dominio `traveliatos.life` verificado (DKIM/SPF/DMARC); invitaciones Privé enviadas con `email_status=sent` (aceptadas por Resend; la entrega en bandeja no se puede comprobar desde aquí) |

### Privé en producción
| Usuario (prefijo) | Concesión | Membresía | Invitación |
|---|---|---|---|
| 82c06fbd (Rodrigo, vonhaucke.mx) | vigente, sin vencimiento | active | enviada, aceptada 13:04 UTC |
| 999f1e1a (Sofía) | vigente, sin vencimiento | invited | enviada, sin aceptar |
| f98a7188 (Carlo) | vigente, sin vencimiento | invited | enviada, sin aceptar |
| 7bb02b06 (sintética del ensayo) | revocada | active (sin PRO → `prive_require` niega con `PRIVE_NOT_PRO`, probado) | aceptada |
| 2097e1e0 (Gmail del dueño, concedida y revocada hoy por instrucción del dueño) | revocada | **invited** | **enviada, sin revocar** → hallazgo nuevo NEW-01 |

## Nota de proceso
Desde la instrucción "OPERACIÓN CIERRE TOTAL" no se ha pedido ningún despliegue, migración, correo ni cambio en producción. Dos acciones ya solicitadas antes de esa instrucción terminaron después: el despliegue de `health-check` y la publicación del frontend de `f62466e`.
