-- F-07 (IATOS-014/048): límite de frecuencia atómico. Idempotente.
--
-- Antes check_rate_limit hacía SELECT count(*) y luego INSERT en dos sentencias sin candado: dos
-- peticiones simultáneas veían el mismo conteo y pasaban las dos (con N en paralelo se rebasaba el
-- límite N veces). Ahora:
--   1. un candado transaccional por (subject, bucket) serializa solo las llamadas del mismo sujeto
--      y la misma cubeta (las demás no esperan);
--   2. una sola sentencia cuenta la ventana e inserta el golpe solo si cabe.
-- Misma firma, mismo JSON de respuesta y mismos permisos (solo service_role), así que las edge
-- functions no cambian de contrato.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _subject text,
  _bucket text,
  _limit int,
  _window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_inserted boolean;
BEGIN
  IF _subject IS NULL OR _bucket IS NULL OR coalesce(_limit, 0) < 1 OR coalesce(_window_seconds, 0) < 1 THEN
    RAISE EXCEPTION 'check_rate_limit: argumentos inválidos';
  END IF;

  -- Llave de dos enteros: no choca con los candados de una llave bigint que usan otras funciones.
  PERFORM pg_advisory_xact_lock(hashtext('check_rate_limit'), hashtext(_subject || '|' || _bucket));

  WITH recent AS (
    SELECT count(*)::int AS c
      FROM public.rate_limits
     WHERE subject = _subject
       AND bucket = _bucket
       AND created_at > clock_timestamp() - make_interval(secs => _window_seconds)
  ), ins AS (
    INSERT INTO public.rate_limits (subject, bucket, created_at)
    SELECT _subject, _bucket, clock_timestamp() FROM recent WHERE c < _limit
    RETURNING 1
  )
  SELECT r.c, EXISTS (SELECT 1 FROM ins) INTO v_count, v_inserted FROM recent r;

  -- Limpieza ocasional (antes se hacía en cada llamada y competía por la tabla completa).
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE created_at < now() - interval '1 day';
  END IF;

  IF NOT v_inserted THEN
    RETURN jsonb_build_object('allowed', false, 'count', v_count, 'limit', _limit,
                              'retry_after', _window_seconds);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'count', v_count + 1, 'limit', _limit);
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, int, int) TO service_role;
