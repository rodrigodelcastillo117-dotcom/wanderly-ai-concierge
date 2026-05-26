// 🎮 Motor de gamificación: revisa los datos reales del usuario y desbloquea
// medallas + avanza misiones. Determinista (puro conteo SQL), idempotente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const uid = u.user.id;

    const [
      { count: numViajes },
      { data: viajesPaises },
      { count: numRestaurantes },
      { data: visitas },
      { count: numAmigos },
      { data: prefs },
    ] = await Promise.all([
      supabase.from("trips").select("*", { count: "exact", head: true }).eq("user_id", uid),
      supabase.from("trips").select("pais_destino").eq("user_id", uid),
      supabase.from("recomendaciones").select("*", { count: "exact", head: true }).eq("user_id", uid).eq("tipo", "restaurante").eq("guardado", true),
      supabase.from("user_visits").select("place_name, category").eq("user_id", uid),
      supabase.from("friendships").select("*", { count: "exact", head: true }).or(`requester_id.eq.${uid},addressee_id.eq.${uid}`).eq("status", "accepted"),
      supabase.from("ai_user_preferences").select("dna_version").eq("user_id", uid).maybeSingle(),
    ]);

    const paisesDistintos = new Set((viajesPaises ?? []).map((t: any) => t.pais_destino).filter(Boolean)).size;
    const ciudadesDistintas = new Set((visitas ?? []).map((v: any) => v.place_name).filter(Boolean)).size;
    const dnaVersion = prefs?.dna_version ?? 1;

    const metricas: Record<string, number> = {
      viajes: numViajes ?? 0,
      paises: paisesDistintos,
      restaurantes: numRestaurantes ?? 0,
      ciudades: ciudadesDistintas,
      amigos: numAmigos ?? 0,
      dna_evolucionado: dnaVersion > 1 ? dnaVersion : 0,
    };

    const { data: badges } = await supabase.from("badges").select("*");
    const { data: yaTengo } = await supabase.from("user_badges").select("badge_id").eq("user_id", uid);
    const tengoSet = new Set((yaTengo ?? []).map((b: any) => b.badge_id));

    const nuevasMedallas: any[] = [];
    for (const b of badges ?? []) {
      if (tengoSet.has(b.id)) continue;
      let valorActual = 0;
      if (b.id === "dna_evolucionado") valorActual = (metricas.dna_evolucionado >= 1 ? 3 : 0);
      else valorActual = metricas[b.meta_tipo] ?? 0;

      if (valorActual >= (b.meta_valor ?? 999999)) {
        const { error } = await supabase.from("user_badges").insert({ user_id: uid, badge_id: b.id });
        if (!error) nuevasMedallas.push({ id: b.id, nombre: b.nombre, icono: b.icono, descripcion: b.descripcion });
      }
    }

    const { data: misiones } = await supabase.from("missions").select("*").eq("vigente", true);
    const { data: misProgreso } = await supabase.from("user_missions").select("*").eq("user_id", uid);
    const progresoMap = new Map((misProgreso ?? []).map((m: any) => [m.mission_id, m]));

    const misionesActualizadas: any[] = [];
    for (const m of misiones ?? []) {
      const actual = metricas[m.meta_tipo] ?? 0;
      const completada = actual >= m.meta_valor;
      const prev = progresoMap.get(m.id);

      const { error } = await supabase.from("user_missions").upsert({
        user_id: uid,
        mission_id: m.id,
        progreso: Math.min(actual, m.meta_valor),
        completada,
        completed_at: completada ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,mission_id" });

      if (!error) {
        const recienCompletada = completada && !(prev?.completada);
        misionesActualizadas.push({
          id: m.id, titulo: m.titulo, icono: m.icono,
          progreso: Math.min(actual, m.meta_valor), meta: m.meta_valor,
          completada, recien_completada: recienCompletada,
        });
        if (recienCompletada && m.recompensa_badge_id && !tengoSet.has(m.recompensa_badge_id)) {
          const { error: be } = await supabase.from("user_badges")
            .insert({ user_id: uid, badge_id: m.recompensa_badge_id });
          if (!be) {
            const bdef = (badges ?? []).find((x: any) => x.id === m.recompensa_badge_id);
            if (bdef) nuevasMedallas.push({ id: bdef.id, nombre: bdef.nombre, icono: bdef.icono, descripcion: bdef.descripcion });
          }
        }
      }
    }

    return new Response(JSON.stringify({
      metricas,
      nuevas_medallas: nuevasMedallas,
      misiones: misionesActualizadas,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("evaluar-logros error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
