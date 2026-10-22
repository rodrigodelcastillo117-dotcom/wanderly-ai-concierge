# Tareas de operación que hace una persona

El agente de Lovable tiene prohibido por política tocar secretos y programar
tareas, así que estos pasos los hace el dueño del proyecto.

## Programar tareas automáticas y activar el panel de métricas

Activa **tres** revisiones automáticas y te da acceso a `/dashboard/admin`:

| Tarea | Cuándo | Qué hace |
|---|---|---|
| `flight-watch-every-15-min` | cada 15 min | Revisa los vuelos rastreados y avisa cambios (cancelación, retraso, puerta, hora). |
| `price-watch-twice-daily` | 03:17 y 15:17 UTC (21:17 y 09:17 CDMX) | Revisa las alertas de baja de precio. |
| `health-check-daily` | 13:07 UTC (07:07 CDMX) | Revisa los servicios externos y que las otras tareas sí corran; avisa por correo. |

### Antes: migraciones que deben estar aplicadas

Lovable normalmente las aplica sola. Si alguna falta, pégala completa en el SQL editor y presiona
**Run** (todas se pueden repetir sin riesgo):

- `20261017170000_price_watches.sql` y `20261018090000_price_watch_baseline_source.sql` (alertas de precio)
- `20261018120000_admin_metrics_and_referrals.sql` (panel de métricas y administradores)
- `20261022090000_health_checks.sql` (resultados del chequeo diario)
- `20261022120000_security_p0_fixes.sql` (seguridad de vuelos rastreados)
- `20261022132000_ops_flight_watch_reliability.sql` (reparto de vuelos entre corridas, errores del proveedor)
- `20261022132100_ops_notifications_dedup.sql` (avisos sin duplicados)
- `20261022132200_ops_price_watch_original_currency.sql` (precios comparados en dólares)
- `20261022132300_ops_health_check_jobs_and_email.sql` (revisión de tareas y resultado del correo)

Sin las cuatro últimas, la versión nueva de `flight-watch-cron`, `price-watch-cron` y
`price-watch` falla (no encuentra `claim_tracked_flights`, `notify_once` o las columnas nuevas).
Aplícalas **antes** de publicar las funciones.

### Pasos

1. Abre el proyecto en Lovable → pestaña **Cloud** → **SQL editor**.
2. Copia todo el contenido de [`programar-tareas.sql`](./programar-tareas.sql).
3. En la sección 4, cambia `TU-CORREO@ejemplo.com` por el correo con el que
   inicias sesión en IATOS.
4. Pega en el editor y presiona **Run**.
5. Al final verás dos tablas: los **3** trabajos programados
   (`flight-watch-every-15-min`, `health-check-daily`, `price-watch-twice-daily`) y tu correo
   como administrador. Si ves eso, quedó listo.

Es seguro correrlo más de una vez. No contiene ninguna llave: el secreto se
genera dentro de la base de datos (Supabase Vault) y nadie lo ve.

Para comprobar después que las tareas corren (lo mismo que revisa el chequeo diario):

```sql
SELECT j.jobname, j.schedule, d.status, d.start_time
FROM cron.job j
LEFT JOIN LATERAL (SELECT status, start_time FROM cron.job_run_details r
                   WHERE r.jobid = j.jobid ORDER BY start_time DESC LIMIT 1) d ON true
ORDER BY j.jobname;
```

### Correo de alertas del chequeo diario

- Necesita los secretos `LOVABLE_API_KEY` y `RESEND_API_KEY` en las funciones.
- Mientras el dominio `traveliatos.life` **no esté verificado en Resend**, Resend solo entrega
  correo a la dirección dueña de la cuenta de Resend. Pon esa dirección en el secreto
  `HEALTH_ALERT_EMAIL` (puedes poner varias separadas por coma cuando el dominio ya esté
  verificado). Si no existe, se manda a cada administrador por separado.
- Solo se manda correo cuando cambia lo que falla o necesita atención; si sigue igual, se repite
  como recordatorio una vez por semana. El panel muestra si el último correo se mandó o falló,
  y avisa si el último chequeo tiene más de 26 horas (la tarea dejó de correr).

### Costo de la vigilancia de vuelos (SerpApi)

Cada revisión de un vuelo es una búsqueda de SerpApi. Un vuelo se revisa cada 15 min solo del día
anterior al siguiente de su fecha; a 2–3 días, cada 3 h; a más de 3 días, cada 6 h. Deja de
revisarse cuando aterriza, se cancela o pasa su fecha. Máximo por corrida: secreto
`FLIGHT_WATCH_MAX_CHECKS` (por defecto 50). Si se acaban las búsquedas, la corrida se detiene y
el chequeo diario lo reporta.

### Administradores

Para dar acceso de administrador a otra persona, corre solo la sección 4 con su correo. Ojo: los
administradores también reciben el correo de alertas si no configuraste `HEALTH_ALERT_EMAIL`, y
mientras el dominio no esté verificado su envío falla (el tuyo no se bloquea: va por separado).
Para quitárselo:

```sql
DELETE FROM public.admins
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('correo@ejemplo.com'));
```

## Regalar IATOS PRO a alguien

La migración `20261021090000_comp_grants.sql` crea la lista `comp_grants`: quien
esté en ella queda PRO de cortesía (sin cobro ni vencimiento) al confirmar su
correo, o al instante si ya tiene cuenta. Para agregar a alguien:

```sql
INSERT INTO public.comp_grants (email) VALUES (lower('correo@ejemplo.com'))
ON CONFLICT (email) DO NOTHING;

-- Aplica la lista a cuentas que ya existen y dice a quién NO se le aplicó.
SELECT * FROM public.apply_comp_grants_now();
```

Reglas (migración `20261022130000_pay_stripe_sync_and_atomic_quota.sql`):
- Solo cuentan correos **confirmados** (registrarse con un correo ajeno no da PRO).
- Si la persona **ya paga** una suscripción viva en Stripe, la cortesía no la pisa
  (`apply_comp_grants_now` responde "NO aplicado"). Para dejar de cobrarle, cancela su
  suscripción en el dashboard de Stripe; cuando termine, el webhook la deja como cortesía.
- Stripe nunca le quita la cortesía a una fila `comped`.
