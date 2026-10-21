# Tareas de operación que hace una persona

El agente de Lovable tiene prohibido por política tocar secretos y programar
tareas, así que estos pasos los hace el dueño del proyecto.

## Programar tareas automáticas y activar el panel de métricas

Activa dos revisiones automáticas, alertas de baja de precio (2 veces al día) y
avisos de cambios en vuelos rastreados (cada 15 min), y te da acceso a
`/dashboard/admin`.

1. Abre el proyecto en Lovable → pestaña **Cloud** → **SQL editor**.
   - Si Lovable no ha aplicado aún la migración
     `supabase/migrations/20261018120000_admin_metrics_and_referrals.sql`, pega
     primero ese archivo completo y presiona **Run** (es seguro repetirlo).
2. Copia todo el contenido de [`programar-tareas.sql`](./programar-tareas.sql).
3. En la sección 4, cambia `TU-CORREO@ejemplo.com` por el correo con el que
   inicias sesión en IATOS.
4. Pega en el editor y presiona **Run**.
5. Al final verás dos tablas: los 2 trabajos programados
   (`price-watch-twice-daily`, `flight-watch-every-15-min`) y tu correo como
   administrador. Si ves eso, quedó listo.

Es seguro correrlo más de una vez. No contiene ninguna llave: el secreto se
genera dentro de la base de datos (Supabase Vault) y nadie lo ve.

Para dar acceso de administrador a otra persona (por ejemplo, alguien del
comprador durante la revisión), corre solo la sección 4 con su correo. Para
quitárselo:

```sql
DELETE FROM public.admins
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('correo@ejemplo.com'));
```

## Regalar IATOS PRO a alguien

La migración `20261021090000_comp_grants.sql` crea la lista `comp_grants`: quien
esté en ella queda PRO de cortesía (sin cobro ni vencimiento) al registrarse, o
al instante si ya tiene cuenta. Para agregar a alguien:

```sql
INSERT INTO public.comp_grants (email) VALUES (lower('correo@ejemplo.com'))
ON CONFLICT (email) DO NOTHING;

INSERT INTO public.subscriptions (user_id, status, plan)
SELECT u.id, 'comped', 'pro' FROM auth.users u
JOIN public.comp_grants g ON g.email = lower(u.email)
ON CONFLICT (user_id) DO UPDATE
  SET status = 'comped', plan = 'pro', current_period_end = NULL,
      cancel_at_period_end = false, updated_at = now();
```
