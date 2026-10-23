-- Ediciones especiales de la tarjeta de rango (pedido del dueño, 23-oct-2026):
--   * 'rose_gold' → "Platinum Rose Gold": la tarjeta platino en tonos oro rosa.
--   * 'special'   → "Platinum II Special Edition": una versión aún más especial de la Platinum II.
-- Solo se tienen si el dueño las otorga a mano (columna member_card_grants.edition); nunca se ganan
-- solas. Una edición es SOLO el acabado de la tarjeta: nunca cambia el rango ni los beneficios.
--
-- Reglas (las aplica el servidor en member_card_for; el navegador solo pinta):
--   * 'edition' aparece en el JSON solo cuando la fila de member_card_grants del usuario tiene edición
--     Y el rango final es platinum_1 o platinum_2. Si no, la llave no viene (= sin edición, null).
--     Así la respuesta sin edición es idéntica a la de 20261027070000_tarjetas_rango.sql.
--   * founder_black nunca lleva edición (no es platinum).
--   * Clientes (anon/authenticated) no leen ni escriben member_card_grants: RLS sin políticas y sin
--     GRANT, como en 20261027070000. Solo service_role y migraciones escriben.
--   * Esta migración NO trae ningún user_id: las ediciones las asigna el coordinador al desplegar.
-- member_card_for se redefine partiendo EXACTAMENTE de la versión de 20261027070000_tarjetas_rango.sql;
-- lo único nuevo es leer g.edition y agregar la llave 'edition' al final.
-- Idempotente.

ALTER TABLE public.member_card_grants ADD COLUMN IF NOT EXISTS edition text;
ALTER TABLE public.member_card_grants DROP CONSTRAINT IF EXISTS member_card_grants_edition_check;
ALTER TABLE public.member_card_grants ADD CONSTRAINT member_card_grants_edition_check
  CHECK (edition IS NULL OR edition IN ('rose_gold', 'special'));
COMMENT ON COLUMN public.member_card_grants.edition IS
  'Edición especial de la tarjeta (rose_gold | special). Solo se muestra si el rango final es platinum_1 o platinum_2; nunca cambia el rango.';

-- Mismos permisos que antes: los clientes no tocan la tabla.
ALTER TABLE public.member_card_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_card_grants FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.member_card_grants TO service_role;

CREATE OR REPLACE FUNCTION public.member_card_for(_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m          public.prive_memberships;
  v_founder  boolean;
  v_prive    boolean;
  v_pdays    int;
  v_auto     text;
  v_grant    text;
  v_edition  text;
  v_tier     text;
  v_created  timestamptz;
  v_since    timestamptz;
  v_name     text;
BEGIN
  IF _user IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.prive_memberships WHERE user_id = _user;
  v_founder := EXISTS (SELECT 1 FROM public.founders f WHERE f.user_id = _user);
  v_prive := public.prive_entitled(_user);
  v_pdays := CASE WHEN v_prive AND m.activated_at IS NOT NULL
                  THEN greatest(0, (now() AT TIME ZONE 'America/Mexico_City')::date - (m.activated_at AT TIME ZONE 'America/Mexico_City')::date) END;
  v_auto := CASE
    WHEN v_founder THEN 'founder_black'
    WHEN v_prive AND coalesce(v_pdays, 0) >= 365 THEN 'platinum_2'
    WHEN v_prive THEN 'platinum_1'
    WHEN public.is_pro(_user) THEN 'gold'
    ELSE 'blue' END;
  SELECT g.tier, g.edition INTO v_grant, v_edition FROM public.member_card_grants g WHERE g.user_id = _user;
  v_tier := CASE WHEN v_grant IS NOT NULL AND public.member_card_rank(v_grant) > public.member_card_rank(v_auto)
                 THEN v_grant ELSE v_auto END;
  -- La edición es solo el acabado: nunca en la negra ni en rangos menores a Platinum.
  IF v_tier NOT IN ('platinum_1', 'platinum_2') OR v_edition NOT IN ('rose_gold', 'special') THEN
    v_edition := NULL;
  END IF;
  SELECT coalesce(u.created_at, p.created_at) INTO v_created
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = _user;
  -- "Miembro desde": en Platinum, la activación de Privé (como el Passport); si no, la cuenta.
  v_since := CASE WHEN v_tier IN ('platinum_1', 'platinum_2') AND m.activated_at IS NOT NULL THEN m.activated_at
                  ELSE v_created END;
  v_name := nullif(left(btrim(regexp_replace(coalesce(
              (SELECT nullif(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = _user),
              (SELECT nullif(btrim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')), '')
                 FROM auth.users u WHERE u.id = _user), ''), '\s+', ' ', 'g')), 40), '');
  RETURN jsonb_build_object(
    'tier', v_tier,
    'since', v_since,
    'number', coalesce(m.member_code, public.member_card_number(_user)),
    'tenure_days', CASE WHEN v_since IS NOT NULL
                        THEN greatest(0, (now() AT TIME ZONE 'America/Mexico_City')::date - (v_since AT TIME ZONE 'America/Mexico_City')::date) END,
    'prive_days', v_pdays,
    'granted', v_tier IS DISTINCT FROM v_auto,
    'name', v_name)
    || CASE WHEN v_edition IS NOT NULL THEN jsonb_build_object('edition', v_edition) ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION public.member_card_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_card_for(uuid) TO service_role;

-- my_member_card no cambia (sigue llamando a member_card_for con auth.uid()); se reafirman sus permisos.
REVOKE ALL ON FUNCTION public.my_member_card() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_member_card() TO authenticated, service_role;
