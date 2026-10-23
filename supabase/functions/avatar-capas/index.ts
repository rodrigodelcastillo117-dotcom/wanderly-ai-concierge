// supabase/functions/avatar-capas/index.ts
// Avatar por capas: cambiar el fondo o los recuerdos visibles SIN IA y sin costo (grupo avatar-inventario).
//
//   {action:"estado"}  → país del fondo (confirmado o sugerido por el perfil), fondo y objetos elegidos,
//                        recuerdos ganados, y un enlace firmado (15 min) de la persona recortada para la
//                        vista previa instantánea del cliente (la base vive en el bucket PRIVADO).
//   {action:"guardar", pais?, fondo_id?, objetos?}
//                      → valida contra el catálogo (fondo de SU país; objetos de SU inventario, máx. 3),
//                        guarda y, si su avatar es por capas, compone y publica el PNG de cuerpo completo
//                        y el recorte de la cara (profiles.avatar_url). Sin LOVABLE_API_KEY: no hay IA aquí.
// Solo con la bandera app_flags.avatar_capas_enabled encendida para la persona (true o "founders").
// Solo el servidor escribe avatar_profiles y profiles.avatar_url (N-L1).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { admin, capasHabilitado, composeAndPublish, paisDeFondo, PRIVATE_BUCKET, setVisibleKeys } from "../_shared/avatar-runtime.ts";
import { fondosDePais, paisValido, recuerdosDeObjetos, resolverFondo, validarObjetos } from "../_shared/avatar-inventory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

type Db = ReturnType<typeof admin>;

/** Recuerdos ganados (colección), del más viejo al más nuevo. */
async function recuerdos(db: Db, uid: string): Promise<string[]> {
  const { data } = await db.from("avatar_souvenirs").select("souvenir_key, status, trip_end, unlocked_at")
    .eq("user_id", uid).in("status", ["aplicado", "sin_avatar"]);
  return ((data ?? []) as Array<{ souvenir_key: string; trip_end: string | null; unlocked_at: string }>)
    .sort((a, b) => String(a.trip_end ?? a.unlocked_at).localeCompare(String(b.trip_end ?? b.unlocked_at)))
    .map((r) => r.souvenir_key);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "Sesión inválida" }, 401);
    const uid = u.user.id;
    const rl = await enforceRateLimit(req, "avatar-capas", uid, { perMinute: 12, perHour: 120, ipPerMinute: 30 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const body = await req.json().catch(() => ({}));
    const db = admin();
    // Bandera avatar_capas_enabled (false | true | "founders"): apagada = no hay panel ni cambios.
    if (!(await capasHabilitado(db, uid))) {
      return body?.action === "estado" ? json({ ok: true, habilitado: false }) : json({ ok: false, error: "No disponible" }, 403);
    }
    const { data: ap } = await db.from("avatar_profiles")
      .select("capas, base_path, pais_fondo, fondo_id, objetos, cara, mano, cuerpo_url").eq("user_id", uid).maybeSingle();
    const ganados = await recuerdos(db, uid);

    if (body?.action === "estado") {
      const sugerido = await paisDeFondo(db, uid, null);
      let persona: string | null = null;
      if (ap?.capas && ap.base_path) {
        const { data: s } = await db.storage.from(PRIVATE_BUCKET).createSignedUrl(ap.base_path, 15 * 60);
        persona = s?.signedUrl ?? null;
      }
      const pais = ap?.pais_fondo ?? null;
      return json({
        ok: true,
        habilitado: true,
        capas: !!(ap?.capas && ap.base_path),
        pais, pais_sugerido: sugerido,
        fondo_id: resolverFondo(pais ?? sugerido, ap?.fondo_id ?? null)?.id ?? null,
        objetos: (ap?.objetos as string[] | null) ?? [],
        recuerdos: ganados,
        persona_url: persona,
        cara: ap?.cara ?? null, mano: ap?.mano ?? null,
        cuerpo_url: ap?.cuerpo_url ?? null,
      });
    }

    if (body?.action !== "guardar") return json({ ok: false, error: "Acción inválida" }, 400);

    // País de origen: solo un código del catálogo (se pregunta una vez; se puede cambiar).
    let pais: string | null | undefined;
    if (body.pais !== undefined) {
      const p = String(body.pais ?? "").toUpperCase();
      if (!paisValido(p)) return json({ ok: false, error: "País inválido" }, 400);
      pais = p;
    }
    const paisFinal = pais ?? ap?.pais_fondo ?? null;
    // El fondo siempre es de su país (si aún no confirma país, el del perfil, sin guardarlo).
    let fondoId: string | null | undefined;
    if (body.fondo_id !== undefined && body.fondo_id !== null) {
      const id = String(body.fondo_id);
      const lista = fondosDePais(paisFinal ?? (await paisDeFondo(db, uid, null)));
      if (!lista.some((f) => f.id === id)) return json({ ok: false, error: "Ese fondo no es de tu país" }, 400);
      fondoId = id;
    } else if (pais !== undefined && pais !== ap?.pais_fondo) {
      fondoId = null; // cambió de país: el primer fondo del país nuevo
    }
    const objetos = body.objetos !== undefined ? validarObjetos(body.objetos, ganados) : undefined;

    if (ap?.capas && ap.base_path) {
      const url = await composeAndPublish(db, uid, { pais, fondoId, objetos });
      if (objetos) await setVisibleKeys(db, uid, recuerdosDeObjetos(objetos));
      const { data: after } = await db.from("avatar_profiles").select("cuerpo_url, fondo_id, objetos, pais_fondo").eq("user_id", uid).maybeSingle();
      return json({ ok: true, url, cuerpo_url: after?.cuerpo_url ?? null, fondo_id: after?.fondo_id ?? null, objetos: after?.objetos ?? [], pais: after?.pais_fondo ?? null, costo_usd: 0 });
    }

    // Aún sin avatar por capas: solo se guardan las preferencias (se usan al crear el avatar).
    const patch: Record<string, unknown> = { user_id: uid, updated_at: new Date().toISOString() };
    if (pais !== undefined) patch.pais_fondo = pais;
    if (paisFinal && fondoId !== undefined) patch.fondo_id = fondoId;
    if (objetos !== undefined) patch.objetos = objetos;
    const { error } = await db.from("avatar_profiles").upsert(patch, { onConflict: "user_id" });
    if (error) return json({ ok: false, error: "No pudimos guardar tu elección" }, 500);
    return json({ ok: true, url: null, pais: paisFinal, costo_usd: 0 });
  } catch (e) {
    console.error("avatar-capas error:", e);
    return json({ ok: false, error: "No pudimos actualizar tu avatar. Intenta de nuevo." }, 500);
  }
});
