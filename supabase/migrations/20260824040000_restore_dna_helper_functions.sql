-- Retroactive: Travel DNA helpers that exist live but were never versioned. Must
-- precede 20260824040643, which revokes/grants on them. Each is created only if
-- missing, so the live definitions (authoritative) are never replaced. Bodies are
-- reconstructed from usage; the triggers that call the two trigger functions are
-- not recreated here because their live names/tables aren't versioned.

DO $do$
BEGIN
  IF to_regprocedure('public.ensure_ai_prefs(uuid)') IS NULL THEN
    -- Live definition is authoritative; reconstructed from usage.
    EXECUTE $fn$
      CREATE FUNCTION public.ensure_ai_prefs(p_user uuid)
      RETURNS void
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      BEGIN
        IF p_user IS NULL THEN RETURN; END IF;
        INSERT INTO public.ai_user_preferences (user_id)
        VALUES (p_user)
        ON CONFLICT (user_id) DO NOTHING;
      END;
      $body$
    $fn$;
  END IF;

  IF to_regprocedure('public.on_trip_insert_dna()') IS NULL THEN
    -- Live definition is authoritative; reconstructed from usage.
    EXECUTE $fn$
      CREATE FUNCTION public.on_trip_insert_dna()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      BEGIN
        PERFORM public.ensure_ai_prefs(NEW.user_id);
        UPDATE public.ai_user_preferences
           SET trip_count = coalesce(trip_count, 0) + 1
         WHERE user_id = NEW.user_id;
        RETURN NEW;
      END;
      $body$
    $fn$;
  END IF;

  IF to_regprocedure('public.on_visit_insert_dna()') IS NULL THEN
    -- Live definition is authoritative; reconstructed from usage.
    EXECUTE $fn$
      CREATE FUNCTION public.on_visit_insert_dna()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      BEGIN
        PERFORM public.ensure_ai_prefs(NEW.user_id);
        UPDATE public.ai_user_preferences
           SET visit_count = coalesce(visit_count, 0) + 1
         WHERE user_id = NEW.user_id;
        RETURN NEW;
      END;
      $body$
    $fn$;
  END IF;
END
$do$;
