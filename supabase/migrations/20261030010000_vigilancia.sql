-- Vigilancia proactiva (30-oct-2026). Pedido del dueño: que IATOS se adelante a los problemas en vez de esperar a
-- que el viajero se queje; mejor que una agencia de primer nivel.
--
-- El cerebro vive en _shared/vigilancia/ (reglas puras probadas con Vitest) y la función vigilancia-cron. Esta
-- migración le da lo que NO puede depender del código:
--
--   vigilancia_config         topes: búsquedas de SerpApi al día para vigilar vuelos, avisos al día por viajero,
--                             horario "decente" del viajero, umbrales de retraso y de confirmaciones.
--   vigilancia_vuelos         cada vuelo identificado (número + fecha) de un viaje o del seguimiento de vuelos:
--                             cuándo toca revisarlo (nunca antes de 48 h), último estado visto y su incidente.
--   vigilancia_eventos        BITÁCORA de la vigilancia (por viaje): qué se detectó, qué se avisó, qué se mandó.
--                             Clave única: un mismo hallazgo nunca se procesa dos veces.
--   vigilancia_avisos         avisos al viajero (push, app, su canal): UNA sola vez por clave, a buena hora local
--                             y con tope diario por viajero (los urgentes del vuelo no esperan ni cuentan).
--   vigilancia_confirmaciones confirmación previa con el proveedor (mesa, traslado, tour) 24–48 h antes: correo
--                             SIEMPRE con fuente verificada, en el horario local del proveedor, y SOLO si el viajero
--                             dio su consentimiento general (vigilancia_preferencias, apagado por omisión).
--   vigilancia_preferencias   "IATOS puede contactar a mis proveedores en mi nombre" (apagado por omisión).
--
-- Reglas que hace cumplir la base:
--   * app_flags.vigilancia_enabled apaga TODO (la función no revisa ni avisa nada).
--   * El cupo diario de SerpApi de la vigilancia se cuenta en ai_usage_log (función vigilancia-cron): al llegar, no
--     se reclama ningún vuelo más ese día (UTC).
--   * Un correo a proveedor sin fuente no se guarda (CHECK) y no sale sin consentimiento (vigilancia_confirmacion_enviar).
--   * Todo lo ejecuta service_role; el viajero solo ve sus avisos/eventos visibles y cambia su preferencia; la Mesa
--     (admins) ve el resumen.
-- Idempotente. NO envía nada.

INSERT INTO public.app_flags (key, value, note) VALUES
  ('vigilancia_enabled', 'true'::jsonb,
   'Vigilancia proactiva: vuelos (cancelación, retraso, puerta, desvío), confirmaciones previas y avisos de viaje')
ON CONFLICT (key) DO NOTHING;

-- ───────────────────────────── 1. Configuración ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.vigilancia_config (
  id                        boolean PRIMARY KEY DEFAULT true CHECK (id),
  serp_tope_diario          int NOT NULL DEFAULT 30 CHECK (serp_tope_diario BETWEEN 0 AND 1000),
  avisos_tope_diario        int NOT NULL DEFAULT 3 CHECK (avisos_tope_diario BETWEEN 1 AND 10),
  hora_desde                int NOT NULL DEFAULT 8 CHECK (hora_desde BETWEEN 0 AND 23),
  hora_hasta                int NOT NULL DEFAULT 21 CHECK (hora_hasta BETWEEN 1 AND 24),
  retraso_aviso_min         int NOT NULL DEFAULT 60 CHECK (retraso_aviso_min BETWEEN 15 AND 600),
  retraso_incidente_min     int NOT NULL DEFAULT 120 CHECK (retraso_incidente_min BETWEEN 30 AND 900),
  incidente_por_puerta      boolean NOT NULL DEFAULT false,
  confirmar_desde_horas     int NOT NULL DEFAULT 48 CHECK (confirmar_desde_horas BETWEEN 12 AND 96),
  confirmacion_limite_horas int NOT NULL DEFAULT 8 CHECK (confirmacion_limite_horas BETWEEN 1 AND 48),
  sin_respuesta_horas       int NOT NULL DEFAULT 12 CHECK (sin_respuesta_horas BETWEEN 1 AND 72),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (hora_desde < hora_hasta),
  CHECK (retraso_incidente_min >= retraso_aviso_min)
);
INSERT INTO public.vigilancia_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.vigilancia_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.vigilancia_cfg()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(c) || jsonb_build_object('enabled', coalesce(public.app_flag('vigilancia_enabled'), false))
    FROM public.vigilancia_config c WHERE c.id;
$$;

-- ───────────────────────────── 2. Preferencia del viajero ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.vigilancia_preferencias (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  contactar_proveedores boolean NOT NULL DEFAULT false,
  texto_aceptado        text CHECK (texto_aceptado IS NULL OR length(texto_aceptado) <= 600),
  actualizado_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vigilancia_preferencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigilancia_preferencias_own ON public.vigilancia_preferencias;
CREATE POLICY vigilancia_preferencias_own ON public.vigilancia_preferencias FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.vigilancia_preferencias TO authenticated;

-- ───────────────────────────── 3. Vuelos vigilados ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.vigilancia_vuelos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id             uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  vuelo               text NOT NULL CHECK (vuelo ~ '^[A-Z0-9]{2}[A-Z]?[0-9]{1,4}[A-Z]?$'),
  fecha               date NOT NULL,
  origen              text CHECK (origen IS NULL OR origen ~ '^[A-Z]{3}$'),
  destino             text CHECK (destino IS NULL OR destino ~ '^[A-Z]{3}$'),
  fuente              text NOT NULL CHECK (fuente IN ('seguimiento','viaje')),
  zona_origen         text CHECK (zona_origen IS NULL OR zona_origen ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  -- Salida: exacta si la dio la fuente con zona horaria o el itinerario con hora y ciudad conocida; si no, el
  -- peor caso (fin del día) para no empezar a revisar ANTES de 48 h.
  salida_at           timestamptz,
  salida_exacta       boolean NOT NULL DEFAULT false,
  llegada_at          timestamptz,
  activo              boolean NOT NULL DEFAULT true,
  fin_motivo          text CHECK (fin_motivo IS NULL OR length(fin_motivo) <= 120),
  proxima_revision_at timestamptz,
  claimed_at          timestamptz,
  ultima_revision_at  timestamptz,
  ultimo_ok_at        timestamptz,
  ultimo_resultado    text CHECK (ultimo_resultado IS NULL OR ultimo_resultado IN ('ok','no_data','date_mismatch','provider_error','quota')),
  fallas_seguidas     int NOT NULL DEFAULT 0 CHECK (fallas_seguidas >= 0),
  revisiones          int NOT NULL DEFAULT 0 CHECK (revisiones >= 0),
  estado              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estado) = 'object' AND length(estado::text) <= 4000),
  incidente_id        uuid REFERENCES public.concierge_requests(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, vuelo, fecha)
);
CREATE INDEX IF NOT EXISTS vigilancia_vuelos_due ON public.vigilancia_vuelos (proxima_revision_at) WHERE activo;
CREATE INDEX IF NOT EXISTS vigilancia_vuelos_trip ON public.vigilancia_vuelos (trip_id);
ALTER TABLE public.vigilancia_vuelos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigilancia_vuelos_own ON public.vigilancia_vuelos;
CREATE POLICY vigilancia_vuelos_own ON public.vigilancia_vuelos FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.vigilancia_vuelos TO authenticated;

-- ───────────────────────────── 4. Bitácora ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.vigilancia_eventos (
  id               bigserial PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id          uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  ambito           text NOT NULL CHECK (ambito IN ('vuelo','confirmacion','aviso','sistema')),
  tipo             text NOT NULL CHECK (tipo ~ '^[a-z_]{3,60}$'),
  clave            text NOT NULL UNIQUE CHECK (length(clave) BETWEEN 8 AND 240),
  resumen          text NOT NULL CHECK (length(resumen) BETWEEN 3 AND 1000),
  datos            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(datos) = 'object' AND length(datos::text) <= 8000),
  ref_id           uuid,
  incidente_id     uuid REFERENCES public.concierge_requests(id) ON DELETE SET NULL,
  visible_viajero  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vigilancia_eventos_trip ON public.vigilancia_eventos (trip_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vigilancia_eventos_recientes ON public.vigilancia_eventos (created_at DESC);
ALTER TABLE public.vigilancia_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigilancia_eventos_own ON public.vigilancia_eventos;
CREATE POLICY vigilancia_eventos_own ON public.vigilancia_eventos FOR SELECT TO authenticated USING (user_id = auth.uid() AND visible_viajero);
GRANT SELECT ON public.vigilancia_eventos TO authenticated;

-- ───────────────────────────── 5. Avisos al viajero ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.vigilancia_avisos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id          uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  clave            text NOT NULL UNIQUE CHECK (length(clave) BETWEEN 8 AND 240),
  tipo             text NOT NULL CHECK (tipo IN ('vuelo','fuente','checkin','documentos','clima','seguridad','confirmacion')),
  titulo           text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 140),
  cuerpo           text NOT NULL CHECK (length(cuerpo) BETWEEN 3 AND 2000),
  url              text NOT NULL DEFAULT '/dashboard' CHECK (url ~ '^/[A-Za-z0-9/_?&=#.-]*$' AND length(url) <= 300),
  urgente          boolean NOT NULL DEFAULT false,
  zona_horaria     text CHECK (zona_horaria IS NULL OR zona_horaria ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  programado_para  timestamptz NOT NULL DEFAULT now(),
  expira_at        timestamptz,
  estado           text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviando','enviado','vencido','sin_canal')),
  intentos         int NOT NULL DEFAULT 0,
  claimed_at       timestamptz,
  enviado_at       timestamptz,
  canales          jsonb CHECK (canales IS NULL OR length(canales::text) <= 4000),
  incidente_id     uuid REFERENCES public.concierge_requests(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vigilancia_avisos_due ON public.vigilancia_avisos (programado_para) WHERE estado IN ('pendiente','enviando');
CREATE INDEX IF NOT EXISTS vigilancia_avisos_user ON public.vigilancia_avisos (user_id, enviado_at) WHERE estado = 'enviado';
ALTER TABLE public.vigilancia_avisos ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────── 6. Confirmaciones previas con proveedores ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.vigilancia_confirmaciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trip_id             uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  origen              text NOT NULL CHECK (origen IN ('ai_reservation','booking')),
  origen_id           text NOT NULL CHECK (length(origen_id) BETWEEN 1 AND 80),
  tipo                text NOT NULL CHECK (tipo IN ('traslado','tour','restaurante','actividad')),
  proveedor           text NOT NULL CHECK (length(proveedor) BETWEEN 2 AND 200),
  correo              text NOT NULL CHECK (correo ~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' AND length(correo) <= 200),
  -- Fuente obligatoria del correo (misma regla que operator_outbox): nunca un correo adivinado.
  fuente              jsonb NOT NULL CHECK (
                        jsonb_typeof(fuente) = 'object'
                        AND fuente->>'kind' IN ('sitio_oficial','directorio','reserva','correo_del_proveedor')
                        AND (coalesce(fuente->>'url', '') <> '' OR coalesce(fuente->>'booking', '') <> '')),
  zona_horaria        text CHECK (zona_horaria IS NULL OR zona_horaria ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'),
  idioma              text NOT NULL DEFAULT 'es' CHECK (idioma IN ('es','en','fr','pt','it','de')),
  servicio_at         timestamptz NOT NULL,
  servicio_local      text CHECK (servicio_local IS NULL OR length(servicio_local) <= 40),
  personas            int CHECK (personas IS NULL OR personas BETWEEN 1 AND 50),
  referencia          text CHECK (referencia IS NULL OR length(referencia) <= 80),
  titular             text CHECK (titular IS NULL OR length(titular) <= 120),
  estado              text NOT NULL DEFAULT 'pendiente' CHECK (estado IN (
                        'pendiente','sin_consentimiento','programada','enviando','enviada','confirmada','problema','sin_respuesta',
                        'cancelada','vencida')),
  enviar_desde        timestamptz,
  enviada_at          timestamptz,
  intentos            int NOT NULL DEFAULT 0,
  claimed_at          timestamptz,
  provider_message_id text CHECK (provider_message_id IS NULL OR length(provider_message_id) <= 200),
  error               text CHECK (error IS NULL OR length(error) <= 300),
  reply_token         text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(12), 'hex') CHECK (reply_token ~ '^[0-9a-f]{24}$'),
  respuesta_at        timestamptz,
  respuesta_resultado text CHECK (respuesta_resultado IS NULL OR respuesta_resultado IN ('confirma','problema','ambigua')),
  respuesta_extracto  text CHECK (respuesta_extracto IS NULL OR length(respuesta_extracto) <= 600),
  remitente_verificado boolean,
  incidente_id        uuid REFERENCES public.concierge_requests(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origen, origen_id)
);
CREATE INDEX IF NOT EXISTS vigilancia_confirmaciones_abiertas ON public.vigilancia_confirmaciones (servicio_at)
  WHERE estado IN ('pendiente','programada','enviando','enviada');
ALTER TABLE public.vigilancia_confirmaciones ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────── 7. Funciones (service_role) ─────────────────────────────

-- Vuelos candidatos: los del seguimiento (tracked_flights activos) y los del itinerario de un viaje que vienen de
-- una reserva leída (vuelos_json con desde_pdf) con número y fecha. Solo dentro de [_desde, _hasta].
CREATE OR REPLACE FUNCTION public.vigilancia_candidatos_vuelo(_desde date, _hasta date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('fuente', 'seguimiento', 'user_id', t.user_id, 'trip_id', t.trip_id, 'vuelo', t.flight,
             'fecha', t.flight_date, 'ruta', t.route, 'ciudad_origen', coalesce(tr.ciudad_origen, p.ciudad_origen)) AS x
      FROM public.tracked_flights t
      LEFT JOIN public.trips tr ON tr.id = t.trip_id
      LEFT JOIN public.profiles p ON p.id = t.user_id
     WHERE t.active AND t.flight_date BETWEEN _desde AND _hasta
    UNION ALL
    SELECT jsonb_build_object('fuente', 'viaje', 'user_id', tr.user_id, 'trip_id', tr.id, 'vuelo', v->>'numero_vuelo',
             'fecha', v->>'fecha', 'hora_salida', v->>'hora_salida', 'origen', v->>'from_iata', 'destino', v->>'to_iata',
             'ciudad_salida', v->>'from', 'aerolinea', v->>'aerolinea', 'ciudad_origen', coalesce(tr.ciudad_origen, p.ciudad_origen))
      FROM public.trips tr
      LEFT JOIN public.profiles p ON p.id = tr.user_id
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tr.vuelos_json) = 'array' THEN tr.vuelos_json ELSE '[]'::jsonb END) v
     WHERE coalesce(tr.status, '') !~* 'cancel'
       AND tr.fecha_salida IS NOT NULL AND tr.fecha_salida <= _hasta AND coalesce(tr.fecha_regreso, tr.fecha_salida) >= _desde
       AND jsonb_typeof(v) = 'object' AND coalesce(v->>'desde_pdf', '') = 'true'
       AND coalesce(v->>'numero_vuelo', '') <> '' AND coalesce(v->>'fecha', '') ~ '^\d{4}-\d{2}-\d{2}$'
       AND (v->>'fecha')::date BETWEEN _desde AND _hasta
  ) s;
$$;

-- Alta/actualización de vuelos vigilados (lo normaliza el código; aquí se valida con los CHECK). No pisa lo que
-- ya aprendió de la fuente (salida exacta, estado, incidente).
CREATE OR REPLACE FUNCTION public.vigilancia_vuelo_upsert(_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb; n int := 0;
BEGIN
  IF jsonb_typeof(_rows) <> 'array' THEN RETURN 0; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    BEGIN
      INSERT INTO public.vigilancia_vuelos AS w (user_id, trip_id, vuelo, fecha, origen, destino, fuente, zona_origen, salida_at,
        salida_exacta, proxima_revision_at)
      VALUES ((r->>'user_id')::uuid, nullif(r->>'trip_id', '')::uuid, r->>'vuelo', (r->>'fecha')::date, nullif(r->>'origen', ''),
        nullif(r->>'destino', ''), r->>'fuente', nullif(r->>'zona_origen', ''), nullif(r->>'salida_at', '')::timestamptz,
        coalesce((r->>'salida_exacta')::boolean, false), nullif(r->>'proxima_revision_at', '')::timestamptz)
      ON CONFLICT (user_id, vuelo, fecha) DO UPDATE SET
        trip_id = coalesce(w.trip_id, EXCLUDED.trip_id),
        origen = coalesce(w.origen, EXCLUDED.origen),
        destino = coalesce(w.destino, EXCLUDED.destino),
        zona_origen = coalesce(w.zona_origen, EXCLUDED.zona_origen),
        fuente = CASE WHEN w.fuente = 'viaje' OR EXCLUDED.fuente = 'viaje' THEN 'viaje' ELSE 'seguimiento' END,
        salida_at = CASE WHEN w.salida_exacta THEN w.salida_at ELSE coalesce(EXCLUDED.salida_at, w.salida_at) END,
        salida_exacta = w.salida_exacta OR EXCLUDED.salida_exacta,
        proxima_revision_at = CASE WHEN w.revisiones = 0 AND w.activo THEN coalesce(EXCLUDED.proxima_revision_at, w.proxima_revision_at)
                                   ELSE w.proxima_revision_at END,
        updated_at = now();
      n := n + 1;
    EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR datetime_field_overflow THEN
      CONTINUE;
    END;
  END LOOP;
  RETURN n;
END $$;

-- Reclama los vuelos que toca revisar, respetando el cupo diario de SerpApi de la vigilancia (ai_usage_log,
-- función 'vigilancia-cron'). FOR UPDATE SKIP LOCKED: dos corridas nunca revisan el mismo vuelo. Primero los que
-- salen antes. Devuelve también el cupo (usados, tope, restantes) para la bitácora.
CREATE OR REPLACE FUNCTION public.vigilancia_vuelos_reclamar(_limit int DEFAULT 20, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cfg public.vigilancia_config; v_usados int; v_rest int; v_lim int; v_items jsonb; v_pend int;
BEGIN
  SELECT * INTO cfg FROM public.vigilancia_config WHERE id;
  IF NOT coalesce(public.app_flag('vigilancia_enabled'), false) THEN
    RETURN jsonb_build_object('ok', true, 'apagado', true, 'items', '[]'::jsonb);
  END IF;
  SELECT coalesce(sum(searches), 0)::int INTO v_usados FROM public.ai_usage_log
   WHERE provider = 'serpapi' AND function = 'vigilancia-cron'
     AND created_at >= date_trunc('day', _now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_rest := greatest(cfg.serp_tope_diario - v_usados, 0);
  v_lim := least(greatest(coalesce(_limit, 0), 0), 100, v_rest);

  -- Lo que ya no tiene caso vigilar (más de 2 días después de su fecha).
  UPDATE public.vigilancia_vuelos SET activo = false, fin_motivo = coalesce(fin_motivo, 'fecha pasada'), updated_at = now()
   WHERE activo AND fecha < (_now AT TIME ZONE 'UTC')::date - 2;

  SELECT count(*) INTO v_pend FROM public.vigilancia_vuelos
   WHERE activo AND proxima_revision_at IS NOT NULL AND proxima_revision_at <= _now
     AND (claimed_at IS NULL OR claimed_at < _now - interval '5 minutes');

  IF v_lim = 0 THEN
    RETURN jsonb_build_object('ok', true, 'items', '[]'::jsonb, 'usados', v_usados, 'tope', cfg.serp_tope_diario, 'restantes', v_rest,
      'pendientes', v_pend, 'sin_cupo', v_rest = 0 AND v_pend > 0);
  END IF;

  WITH due AS (
    SELECT x.id FROM public.vigilancia_vuelos x
     WHERE x.activo AND x.proxima_revision_at IS NOT NULL AND x.proxima_revision_at <= _now
       AND (x.claimed_at IS NULL OR x.claimed_at < _now - interval '5 minutes')
     ORDER BY x.salida_at NULLS LAST, x.proxima_revision_at
     LIMIT v_lim
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.vigilancia_vuelos w SET claimed_at = _now FROM due WHERE w.id = due.id RETURNING w.*
  )
  SELECT coalesce(jsonb_agg(to_jsonb(upd) ORDER BY upd.salida_at NULLS LAST), '[]'::jsonb) INTO v_items FROM upd;

  RETURN jsonb_build_object('ok', true, 'items', v_items, 'usados', v_usados, 'tope', cfg.serp_tope_diario, 'restantes', v_rest,
    'pendientes', v_pend, 'sin_cupo', false);
END $$;

-- Guarda el resultado de una revisión (solo columnas permitidas) y suelta el reclamo.
CREATE OR REPLACE FUNCTION public.vigilancia_vuelo_guardar(_id uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.vigilancia_vuelos SET
    estado = CASE WHEN jsonb_typeof(_p->'estado') = 'object' THEN _p->'estado' ELSE estado END,
    ultimo_resultado = coalesce(_p->>'ultimo_resultado', ultimo_resultado),
    ultima_revision_at = coalesce(nullif(_p->>'ultima_revision_at', '')::timestamptz, ultima_revision_at),
    ultimo_ok_at = coalesce(nullif(_p->>'ultimo_ok_at', '')::timestamptz, ultimo_ok_at),
    fallas_seguidas = coalesce((_p->>'fallas_seguidas')::int, fallas_seguidas),
    revisiones = revisiones + CASE WHEN coalesce((_p->>'contar')::boolean, false) THEN 1 ELSE 0 END,
    salida_at = CASE WHEN coalesce((_p->>'salida_exacta')::boolean, false) AND nullif(_p->>'salida_at', '') IS NOT NULL
                     THEN (_p->>'salida_at')::timestamptz ELSE salida_at END,
    salida_exacta = salida_exacta OR coalesce((_p->>'salida_exacta')::boolean, false),
    llegada_at = coalesce(nullif(_p->>'llegada_at', '')::timestamptz, llegada_at),
    origen = coalesce(origen, CASE WHEN coalesce(_p->>'origen', '') ~ '^[A-Z]{3}$' THEN _p->>'origen' END),
    destino = coalesce(destino, CASE WHEN coalesce(_p->>'destino', '') ~ '^[A-Z]{3}$' THEN _p->>'destino' END),
    proxima_revision_at = CASE WHEN _p ? 'proxima_revision_at' THEN nullif(_p->>'proxima_revision_at', '')::timestamptz ELSE proxima_revision_at END,
    activo = CASE WHEN _p ? 'activo' THEN (_p->>'activo')::boolean ELSE activo END,
    fin_motivo = coalesce(nullif(left(_p->>'fin_motivo', 120), ''), fin_motivo),
    incidente_id = coalesce(nullif(_p->>'incidente_id', '')::uuid, incidente_id),
    claimed_at = NULL,
    updated_at = now()
  WHERE id = _id;
  RETURN jsonb_build_object('ok', FOUND);
EXCEPTION WHEN check_violation OR invalid_text_representation OR foreign_key_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
END $$;

-- Bitácora: idempotente por clave (created=false si ya estaba).
CREATE OR REPLACE FUNCTION public.vigilancia_evento(_e jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO public.vigilancia_eventos (user_id, trip_id, ambito, tipo, clave, resumen, datos, ref_id, incidente_id, visible_viajero)
  VALUES ((_e->>'user_id')::uuid, nullif(_e->>'trip_id', '')::uuid, _e->>'ambito', _e->>'tipo', _e->>'clave', left(_e->>'resumen', 1000),
    CASE WHEN jsonb_typeof(_e->'datos') = 'object' THEN _e->'datos' ELSE '{}'::jsonb END, nullif(_e->>'ref_id', '')::uuid,
    nullif(_e->>'incidente_id', '')::uuid, coalesce((_e->>'visible_viajero')::boolean, false))
  ON CONFLICT (clave) DO NOTHING
  RETURNING id INTO v;
  RETURN jsonb_build_object('ok', true, 'created', v IS NOT NULL, 'id', v);
EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation OR foreign_key_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
END $$;

-- Avisos al viajero: una sola vez por clave.
CREATE OR REPLACE FUNCTION public.vigilancia_aviso_encolar(_a jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.vigilancia_avisos (user_id, trip_id, clave, tipo, titulo, cuerpo, url, urgente, zona_horaria, programado_para, expira_at, incidente_id)
  VALUES ((_a->>'user_id')::uuid, nullif(_a->>'trip_id', '')::uuid, _a->>'clave', _a->>'tipo', left(_a->>'titulo', 140), left(_a->>'cuerpo', 2000),
    coalesce(nullif(_a->>'url', ''), '/dashboard'), coalesce((_a->>'urgente')::boolean, false), nullif(_a->>'zona_horaria', ''),
    coalesce(nullif(_a->>'programado_para', '')::timestamptz, now()), nullif(_a->>'expira_at', '')::timestamptz, nullif(_a->>'incidente_id', '')::uuid)
  ON CONFLICT (clave) DO NOTHING
  RETURNING id INTO v;
  RETURN jsonb_build_object('ok', true, 'created', v IS NOT NULL, 'id', v);
EXCEPTION WHEN check_violation OR invalid_text_representation OR not_null_violation OR foreign_key_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
END $$;

-- Reclama avisos listos (los urgentes primero) con cuántos avisos NO urgentes recibió ya cada viajero en 24 h
-- (el código decide: enviar, esperar a buena hora o al día siguiente, o vencer).
CREATE OR REPLACE FUNCTION public.vigilancia_avisos_reclamar(_limit int DEFAULT 50, _now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  WITH due AS (
    SELECT a.id FROM public.vigilancia_avisos a
     WHERE (a.estado = 'pendiente' OR (a.estado = 'enviando' AND a.claimed_at < _now - interval '10 minutes'))
       AND a.programado_para <= _now
     ORDER BY a.urgente DESC, a.programado_para
     LIMIT least(greatest(coalesce(_limit, 0), 0), 200)
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.vigilancia_avisos a SET estado = 'enviando', claimed_at = _now, intentos = a.intentos + 1
      FROM due WHERE a.id = due.id RETURNING a.*
  )
  SELECT coalesce(jsonb_agg(to_jsonb(upd) || jsonb_build_object('enviados_24h', (
      SELECT count(*) FROM public.vigilancia_avisos s WHERE s.user_id = upd.user_id AND s.estado = 'enviado' AND NOT s.urgente
         AND s.enviado_at > _now - interval '24 hours')) ORDER BY upd.urgente DESC, upd.programado_para), '[]'::jsonb)
    INTO v FROM upd;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.vigilancia_aviso_cerrar(_id uuid, _estado text, _canales jsonb DEFAULT NULL, _reprogramar timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF _reprogramar IS NOT NULL THEN
    UPDATE public.vigilancia_avisos SET estado = 'pendiente', programado_para = _reprogramar, claimed_at = NULL WHERE id = _id;
  ELSIF _estado IN ('enviado','vencido','sin_canal') THEN
    UPDATE public.vigilancia_avisos SET estado = _estado, canales = _canales, claimed_at = NULL,
      enviado_at = CASE WHEN _estado = 'enviado' THEN now() ELSE enviado_at END WHERE id = _id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
  END IF;
  RETURN jsonb_build_object('ok', FOUND);
END $$;

-- Viajes en la ventana de avisos (salen en ≤ 14 días o están en curso), con lo que hace falta para decidir avisos:
-- destino, fechas, ciudad de origen, vuelos vigilados y documentos de la Bóveda (sin números: solo tipo, país y
-- vigencias).
CREATE OR REPLACE FUNCTION public.vigilancia_viajes_ventana(_now timestamptz DEFAULT now(), _limit int DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id', t.id, 'user_id', t.user_id, 'destino', t.destino, 'pais_destino', t.pais_destino, 'fecha_salida', t.fecha_salida,
      'fecha_regreso', t.fecha_regreso, 'status', t.status, 'ciudad_origen', coalesce(t.ciudad_origen, p.ciudad_origen),
      'vuelos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'vuelo', w.vuelo, 'fecha', w.fecha, 'origen', w.origen,
                    'destino', w.destino, 'salida_at', w.salida_at, 'salida_exacta', w.salida_exacta, 'zona_origen', w.zona_origen,
                    'activo', w.activo, 'estado', w.estado) ORDER BY w.salida_at NULLS LAST), '[]'::jsonb)
                   FROM public.vigilancia_vuelos w WHERE w.trip_id = t.id AND w.user_id = t.user_id),
      'documentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'title', v.title, 'country_code', v.country_code,
                    'expires_on', v.expires_on, 'valid_from', v.valid_from, 'section', v.section)), '[]'::jsonb)
                   FROM public.vault_items v WHERE v.user_id = t.user_id AND v.section <> 'tarjeta')) AS x
      FROM public.trips t
      LEFT JOIN public.profiles p ON p.id = t.user_id
     WHERE coalesce(t.status, '') !~* 'cancel'
       AND t.fecha_salida IS NOT NULL
       AND t.fecha_salida <= (_now AT TIME ZONE 'UTC')::date + 14
       AND coalesce(t.fecha_regreso, t.fecha_salida) >= (_now AT TIME ZONE 'UTC')::date - 1
     ORDER BY t.fecha_salida
     LIMIT least(greatest(coalesce(_limit, 0), 0), 1000)
  ) s;
$$;

-- Confirmaciones: nacen de lo que tiene un proveedor CONOCIDO con correo verificado y hora del servicio:
--   * Reservas IA confirmadas (mesa o experiencia): correo del lugar con su fuente (venue_email_source.url).
--   * bookings con raw_payload.contacto_proveedor {correo, fuente{kind,url|booking}, zona_horaria} (traslado/tour).
-- Solo servicios que empiezan dentro de las próximas confirmar_desde_horas.
CREATE OR REPLACE FUNCTION public.vigilancia_confirmaciones_sync(_now timestamptz DEFAULT now())
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE cfg public.vigilancia_config; n1 int := 0; n2 int := 0;
BEGIN
  SELECT * INTO cfg FROM public.vigilancia_config WHERE id;
  IF NOT coalesce(public.app_flag('vigilancia_enabled'), false) THEN RETURN 0; END IF;
  INSERT INTO public.vigilancia_confirmaciones (user_id, trip_id, origen, origen_id, tipo, proveedor, correo, fuente, zona_horaria, idioma,
    servicio_at, servicio_local, personas, referencia, titular)
  SELECT r.user_id, r.trip_id, 'ai_reservation', r.id::text, CASE WHEN r.venue_experience_id IS NOT NULL THEN 'actividad' ELSE 'restaurante' END,
         left(r.venue_name, 200), r.venue_email,
         jsonb_build_object('kind', 'reserva', 'booking', 'ai_reservation:' || r.id, 'url', r.venue_email_source->>'url'),
         r.venue_timezone, CASE WHEN r.venue_language IN ('es','en','fr','pt','it','de') THEN r.venue_language ELSE 'en' END,
         r.requested_for, left(r.requested_local, 40), r.party_size, left(coalesce(r.confirmation_code, r.ref_code), 80), left(r.customer_name, 120)
    FROM public.ai_reservations r
   WHERE r.status = 'confirmed' AND r.venue_email IS NOT NULL AND coalesce(r.venue_email_source->>'url', '') <> ''
     AND r.requested_for > _now AND r.requested_for <= _now + make_interval(hours => cfg.confirmar_desde_horas)
  ON CONFLICT (origen, origen_id) DO NOTHING;
  GET DIAGNOSTICS n1 = ROW_COUNT;

  BEGIN
    INSERT INTO public.vigilancia_confirmaciones (user_id, trip_id, origen, origen_id, tipo, proveedor, correo, fuente, zona_horaria, idioma,
      servicio_at, personas, referencia)
    SELECT b.user_id, b.trip_id, 'booking', b.id::text,
           CASE WHEN b.category ~* 'transfer|traslado|transport' THEN 'traslado' WHEN b.category ~* 'restaur' THEN 'restaurante'
                WHEN b.category ~* 'tour' THEN 'tour' ELSE 'actividad' END,
           left(coalesce(b.raw_payload->'contacto_proveedor'->>'nombre', b.provider), 200),
           b.raw_payload->'contacto_proveedor'->>'correo', b.raw_payload->'contacto_proveedor'->'fuente',
           nullif(b.raw_payload->'contacto_proveedor'->>'zona_horaria', ''),
           coalesce(nullif(b.raw_payload->'contacto_proveedor'->>'idioma', ''), 'en'),
           b.start_at, nullif(b.raw_payload->>'personas', '')::int, left(coalesce(b.confirmation_code, b.partner_reference), 80)
      FROM public.bookings b
     WHERE b.category ~* 'transfer|traslado|transport|tour|actividad|activity|experien|restaur'
       AND coalesce(b.status, '') !~* 'cancel'
       AND jsonb_typeof(b.raw_payload->'contacto_proveedor') = 'object'
       AND coalesce(b.raw_payload->'contacto_proveedor'->>'correo', '') <> ''
       AND b.start_at > _now AND b.start_at <= _now + make_interval(hours => cfg.confirmar_desde_horas)
    ON CONFLICT (origen, origen_id) DO NOTHING;
    GET DIAGNOSTICS n2 = ROW_COUNT;
  EXCEPTION WHEN check_violation OR invalid_text_representation THEN
    n2 := 0; -- una reserva con contacto mal formado no detiene las demás (se reintenta la próxima corrida)
  END;
  RETURN n1 + n2;
END $$;

-- Confirmaciones que necesitan algo: por mandar (pendiente/programada), enviadas sin respuesta (revisar plazo).
-- Incluye el consentimiento del viajero y el perfil mínimo para el correo.
CREATE OR REPLACE FUNCTION public.vigilancia_confirmaciones_pendientes(_now timestamptz DEFAULT now(), _limit int DEFAULT 50)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(c) - 'reply_token' || jsonb_build_object(
      'reply_token', c.reply_token,
      'consentimiento', coalesce((SELECT pr.contactar_proveedores FROM public.vigilancia_preferencias pr WHERE pr.user_id = c.user_id), false),
      'viajero', (SELECT p.full_name FROM public.profiles p WHERE p.id = c.user_id)) ORDER BY c.servicio_at), '[]'::jsonb)
    FROM (SELECT * FROM public.vigilancia_confirmaciones
           WHERE estado IN ('pendiente','sin_consentimiento','programada','enviando','enviada')
             AND servicio_at > _now - interval '2 hours'
           ORDER BY servicio_at LIMIT least(greatest(coalesce(_limit, 0), 0), 200)) c;
$$;

-- Cambios de estado de una confirmación. El envío pasa por aquí con 'enviando': la base vuelve a comprobar el
-- consentimiento del viajero en ese instante (si lo apagó, no sale).
CREATE OR REPLACE FUNCTION public.vigilancia_confirmacion_actualizar(_id uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.vigilancia_confirmaciones; v_estado text := _p->>'estado';
BEGIN
  SELECT * INTO c FROM public.vigilancia_confirmaciones WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;
  IF v_estado = 'enviando' THEN
    IF NOT coalesce((SELECT contactar_proveedores FROM public.vigilancia_preferencias WHERE user_id = c.user_id), false) THEN
      UPDATE public.vigilancia_confirmaciones SET estado = 'sin_consentimiento', updated_at = now() WHERE id = _id;
      RETURN jsonb_build_object('ok', false, 'code', 'SIN_CONSENTIMIENTO');
    END IF;
    IF c.estado NOT IN ('pendiente','programada') AND NOT (c.estado = 'enviando' AND c.claimed_at < now() - interval '10 minutes') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ESTADO', 'estado', c.estado);
    END IF;
    UPDATE public.vigilancia_confirmaciones SET estado = 'enviando', claimed_at = now(), intentos = intentos + 1, updated_at = now() WHERE id = _id;
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF v_estado IS NOT NULL AND v_estado NOT IN ('pendiente','sin_consentimiento','programada','enviada','confirmada','problema','sin_respuesta','cancelada','vencida') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_STATUS');
  END IF;
  -- Una confirmación ya respondida no vuelve atrás.
  IF c.estado IN ('confirmada','problema') AND v_estado IN ('pendiente','programada','enviada','sin_respuesta') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ESTADO', 'estado', c.estado);
  END IF;
  UPDATE public.vigilancia_confirmaciones SET
    estado = coalesce(v_estado, estado),
    enviar_desde = CASE WHEN _p ? 'enviar_desde' THEN nullif(_p->>'enviar_desde', '')::timestamptz ELSE enviar_desde END,
    enviada_at = CASE WHEN v_estado = 'enviada' THEN now() ELSE enviada_at END,
    provider_message_id = coalesce(nullif(left(_p->>'provider_message_id', 200), ''), provider_message_id),
    error = CASE WHEN _p ? 'error' THEN left(_p->>'error', 300) ELSE error END,
    respuesta_at = CASE WHEN _p ? 'respuesta_resultado' THEN now() ELSE respuesta_at END,
    respuesta_resultado = coalesce(_p->>'respuesta_resultado', respuesta_resultado),
    respuesta_extracto = coalesce(left(_p->>'respuesta_extracto', 600), respuesta_extracto),
    remitente_verificado = coalesce((_p->>'remitente_verificado')::boolean, remitente_verificado),
    incidente_id = coalesce(nullif(_p->>'incidente_id', '')::uuid, incidente_id),
    claimed_at = NULL,
    updated_at = now()
  WHERE id = _id;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN check_violation OR invalid_text_representation OR foreign_key_violation THEN
  RETURN jsonb_build_object('ok', false, 'code', 'INVALID', 'detail', left(SQLERRM, 200));
END $$;

CREATE OR REPLACE FUNCTION public.vigilancia_confirmacion_por_token(_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(c) - 'reply_token' FROM public.vigilancia_confirmaciones c WHERE c.reply_token = lower(_token) AND _token ~ '^[0-9a-fA-F]{24}$';
$$;

-- ───────────────────────────── 8. Funciones del viajero y de la Mesa ─────────────────────────────
CREATE OR REPLACE FUNCTION public.my_vigilancia_prefs()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('contactar_proveedores', coalesce(
    (SELECT contactar_proveedores FROM public.vigilancia_preferencias WHERE user_id = auth.uid()), false),
    'actualizado_at', (SELECT actualizado_at FROM public.vigilancia_preferencias WHERE user_id = auth.uid()))
   WHERE auth.uid() IS NOT NULL;
$$;

-- Solo la persona con sesión cambia SU preferencia; se guarda el texto exacto que aceptó.
CREATE OR REPLACE FUNCTION public.my_vigilancia_prefs_set(_contactar boolean, _texto text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v uuid := auth.uid();
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'sin sesión' USING ERRCODE = '42501'; END IF;
  IF _contactar IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID'); END IF;
  INSERT INTO public.vigilancia_preferencias (user_id, contactar_proveedores, texto_aceptado, actualizado_at)
  VALUES (v, _contactar, CASE WHEN _contactar THEN left(_texto, 600) END, now())
  ON CONFLICT (user_id) DO UPDATE SET contactar_proveedores = EXCLUDED.contactar_proveedores,
    texto_aceptado = CASE WHEN EXCLUDED.contactar_proveedores THEN EXCLUDED.texto_aceptado ELSE NULL END, actualizado_at = now();
  -- Si lo apaga, nada que esté programado sale.
  IF NOT _contactar THEN
    UPDATE public.vigilancia_confirmaciones SET estado = 'sin_consentimiento', updated_at = now()
     WHERE user_id = v AND estado IN ('pendiente','programada');
  END IF;
  RETURN jsonb_build_object('ok', true, 'contactar_proveedores', _contactar);
END $$;

-- Mesa de operaciones › Vigilancia: qué viajes se vigilan y qué se detectó (solo administradores).
CREATE OR REPLACE FUNCTION public.admin_vigilancia_resumen()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public._ops_require_admin();
  SELECT jsonb_build_object(
    'generated_at', now(),
    'enabled', coalesce(public.app_flag('vigilancia_enabled'), false),
    'cupo', (SELECT jsonb_build_object('tope', c.serp_tope_diario, 'usados', (
        SELECT coalesce(sum(searches), 0) FROM public.ai_usage_log WHERE provider = 'serpapi' AND function = 'vigilancia-cron'
           AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) FROM public.vigilancia_config c WHERE c.id),
    'vuelos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'vuelo', w.vuelo, 'fecha', w.fecha, 'ruta',
                  nullif(concat_ws('→', w.origen, w.destino), ''), 'viajero', coalesce(p.full_name, 'Sin nombre'), 'destino', t.destino,
                  'trip_id', w.trip_id, 'estado', w.estado->>'status', 'ultimo_resultado', w.ultimo_resultado, 'ultima_revision_at', w.ultima_revision_at,
                  'proxima_revision_at', w.proxima_revision_at, 'salida_at', w.salida_at, 'activo', w.activo, 'incidente_id', w.incidente_id)
                  ORDER BY w.salida_at NULLS LAST), '[]'::jsonb)
                 FROM (SELECT * FROM public.vigilancia_vuelos WHERE activo OR updated_at > now() - interval '2 days'
                        ORDER BY salida_at NULLS LAST LIMIT 60) w
                 LEFT JOIN public.profiles p ON p.id = w.user_id LEFT JOIN public.trips t ON t.id = w.trip_id),
    'confirmaciones', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'proveedor', c.proveedor, 'servicio_at', c.servicio_at,
                  'estado', c.estado, 'viajero', coalesce(p.full_name, 'Sin nombre'), 'incidente_id', c.incidente_id) ORDER BY c.servicio_at), '[]'::jsonb)
                 FROM (SELECT * FROM public.vigilancia_confirmaciones WHERE servicio_at > now() - interval '1 day' ORDER BY servicio_at LIMIT 40) c
                 LEFT JOIN public.profiles p ON p.id = c.user_id),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'ambito', e.ambito, 'tipo', e.tipo, 'resumen', e.resumen, 'at', e.created_at,
                  'trip_id', e.trip_id, 'incidente_id', e.incidente_id, 'viajero', coalesce(p.full_name, 'Sin nombre')) ORDER BY e.created_at DESC), '[]'::jsonb)
                 FROM (SELECT * FROM public.vigilancia_eventos ORDER BY created_at DESC LIMIT 40) e
                 LEFT JOIN public.profiles p ON p.id = e.user_id)
  ) INTO v;
  RETURN v;
END $$;

-- ───────────────────────────── 9. Permisos ─────────────────────────────
REVOKE ALL ON public.vigilancia_config, public.vigilancia_avisos, public.vigilancia_confirmaciones FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.vigilancia_preferencias, public.vigilancia_vuelos, public.vigilancia_eventos FROM anon, authenticated;
REVOKE ALL ON public.vigilancia_preferencias, public.vigilancia_vuelos, public.vigilancia_eventos FROM anon;
GRANT ALL ON public.vigilancia_config, public.vigilancia_preferencias, public.vigilancia_vuelos, public.vigilancia_eventos,
  public.vigilancia_avisos, public.vigilancia_confirmaciones TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vigilancia_eventos_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.vigilancia_cfg(), public.vigilancia_candidatos_vuelo(date, date), public.vigilancia_vuelo_upsert(jsonb),
  public.vigilancia_vuelos_reclamar(int, timestamptz), public.vigilancia_vuelo_guardar(uuid, jsonb), public.vigilancia_evento(jsonb),
  public.vigilancia_aviso_encolar(jsonb), public.vigilancia_avisos_reclamar(int, timestamptz),
  public.vigilancia_aviso_cerrar(uuid, text, jsonb, timestamptz), public.vigilancia_viajes_ventana(timestamptz, int),
  public.vigilancia_confirmaciones_sync(timestamptz), public.vigilancia_confirmaciones_pendientes(timestamptz, int),
  public.vigilancia_confirmacion_actualizar(uuid, jsonb), public.vigilancia_confirmacion_por_token(text),
  public.my_vigilancia_prefs(), public.my_vigilancia_prefs_set(boolean, text), public.admin_vigilancia_resumen()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vigilancia_cfg(), public.vigilancia_candidatos_vuelo(date, date), public.vigilancia_vuelo_upsert(jsonb),
  public.vigilancia_vuelos_reclamar(int, timestamptz), public.vigilancia_vuelo_guardar(uuid, jsonb), public.vigilancia_evento(jsonb),
  public.vigilancia_aviso_encolar(jsonb), public.vigilancia_avisos_reclamar(int, timestamptz),
  public.vigilancia_aviso_cerrar(uuid, text, jsonb, timestamptz), public.vigilancia_viajes_ventana(timestamptz, int),
  public.vigilancia_confirmaciones_sync(timestamptz), public.vigilancia_confirmaciones_pendientes(timestamptz, int),
  public.vigilancia_confirmacion_actualizar(uuid, jsonb), public.vigilancia_confirmacion_por_token(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_vigilancia_prefs(), public.my_vigilancia_prefs_set(boolean, text), public.admin_vigilancia_resumen() TO authenticated;
