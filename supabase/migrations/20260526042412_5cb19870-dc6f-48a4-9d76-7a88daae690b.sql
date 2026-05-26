
-- Permitir ver perfil de amigos aceptados
create policy "profiles_select_friends" on public.profiles for select
using (
  exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = auth.uid() and f.addressee_id = profiles.id)
        or (f.addressee_id = auth.uid() and f.requester_id = profiles.id)
      )
  )
);

-- Permitir leer profiles por invite_code (necesario para conectar)
-- Lo manejamos vía RPC SECURITY DEFINER en vez de policy abierta.

-- Generador de invite_code
create or replace function public.gen_invite_code()
returns text language plpgsql as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
  exists_count int;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, 1 + floor(random()*length(chars))::int, 1);
    end loop;
    select count(*) into exists_count from public.profiles where invite_code = code;
    exit when exists_count = 0;
  end loop;
  return code;
end; $$;

-- Trigger para asignar invite_code en INSERT
create or replace function public.set_invite_code_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.invite_code is null then
    new.invite_code := public.gen_invite_code();
  end if;
  return new;
end; $$;

drop trigger if exists trg_set_invite_code on public.profiles;
create trigger trg_set_invite_code before insert on public.profiles
for each row execute function public.set_invite_code_default();

-- Rellenar invite_code faltantes
update public.profiles set invite_code = public.gen_invite_code()
where invite_code is null;

-- RPC: agregar amigo por código
create or replace function public.agregar_amigo_por_codigo(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_otro uuid;
  v_existing int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'no_autenticado');
  end if;

  select id into v_otro from public.profiles where invite_code = upper(trim(p_codigo));
  if v_otro is null then
    return jsonb_build_object('ok', false, 'error', 'codigo_invalido');
  end if;
  if v_otro = v_me then
    return jsonb_build_object('ok', false, 'error', 'es_tu_propio_codigo');
  end if;

  select count(*) into v_existing from public.friendships
  where (requester_id = v_me and addressee_id = v_otro)
     or (requester_id = v_otro and addressee_id = v_me);

  if v_existing > 0 then
    update public.friendships
       set status = 'accepted', updated_at = now()
     where (requester_id = v_me and addressee_id = v_otro)
        or (requester_id = v_otro and addressee_id = v_me);
  else
    insert into public.friendships (requester_id, addressee_id, status)
    values (v_me, v_otro, 'accepted');
  end if;

  return jsonb_build_object('ok', true, 'amigo_id', v_otro);
end; $$;

-- RPC: compatibilidad de viaje
create or replace function public.compatibilidad_viaje(p_otro uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  a record;
  b record;
  v_es_amigo int;
  v_comida int := 0;
  v_interes int := 0;
  v_estilo int := 0;
  v_score int := 0;
  v_detalles text[] := '{}';
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'no_autenticado');
  end if;

  select count(*) into v_es_amigo from public.friendships
  where status = 'accepted'
    and ((requester_id = v_me and addressee_id = p_otro)
      or (requester_id = p_otro and addressee_id = v_me));
  if v_es_amigo = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_son_amigos');
  end if;

  select estilo_comida, actividades_tarde, ritmo_viaje, nivel_presupuesto, hospedaje_preferencias
    into a from public.ai_user_preferences where user_id = v_me;
  select estilo_comida, actividades_tarde, ritmo_viaje, nivel_presupuesto, hospedaje_preferencias
    into b from public.ai_user_preferences where user_id = p_otro;

  if a is null or b is null then
    return jsonb_build_object('ok', true, 'score', 0,
      'coincidencias_comida', 0, 'coincidencias_interes', 0, 'coincidencias_estilo', 0,
      'detalles', array['Aún faltan datos de perfil para calcular compatibilidad']);
  end if;

  -- coincidencias
  select count(*) into v_comida from (
    select unnest(coalesce(a.estilo_comida,'{}')) intersect
    select unnest(coalesce(b.estilo_comida,'{}'))) s;
  select count(*) into v_interes from (
    select unnest(coalesce(a.actividades_tarde,'{}')) intersect
    select unnest(coalesce(b.actividades_tarde,'{}'))) s;

  v_estilo := 0;
  if a.ritmo_viaje is not null and a.ritmo_viaje = b.ritmo_viaje then v_estilo := v_estilo + 1; end if;
  if a.nivel_presupuesto is not null and a.nivel_presupuesto = b.nivel_presupuesto then v_estilo := v_estilo + 1; end if;

  -- score: comida 35 + interes 35 + estilo 30
  v_score := least(100,
      v_comida * 12
    + v_interes * 12
    + v_estilo * 15);

  if v_comida > 0 then v_detalles := array_append(v_detalles, 'Comparten ' || v_comida || ' gustos gastronómicos'); end if;
  if v_interes > 0 then v_detalles := array_append(v_detalles, 'Comparten ' || v_interes || ' intereses'); end if;
  if a.ritmo_viaje = b.ritmo_viaje and a.ritmo_viaje is not null then
    v_detalles := array_append(v_detalles, 'Mismo ritmo de viaje');
  end if;
  if a.nivel_presupuesto = b.nivel_presupuesto and a.nivel_presupuesto is not null then
    v_detalles := array_append(v_detalles, 'Mismo nivel de presupuesto');
  end if;
  if array_length(v_detalles,1) is null then
    v_detalles := array_append(v_detalles, 'Aún no hay coincidencias evidentes');
  end if;

  return jsonb_build_object(
    'ok', true,
    'score', v_score,
    'coincidencias_comida', v_comida,
    'coincidencias_interes', v_interes,
    'coincidencias_estilo', v_estilo,
    'detalles', v_detalles
  );
end; $$;

grant execute on function public.agregar_amigo_por_codigo(text) to authenticated;
grant execute on function public.compatibilidad_viaje(uuid) to authenticated;
