// THE PRIVATE EDITION · edition-link-check: un admin pide comprobar los enlaces de las fuentes registradas.
// Verifica que quien llama sea admin (RPC edition_is_admin con SU sesión) y registra cada resultado con el
// rol de servicio (edition_record_link_check). Sin secretos en la respuesta; máximo 60 enlaces por llamada.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { checkLink } from "./check.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  const rl = await enforceRateLimit(req, "edition-link-check", user.id, { perMinute: 2, perHour: 20, ipPerMinute: 5 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await asUser.rpc("edition_is_admin");
  if (adminErr || isAdmin !== true) return json({ code: "EDITION_NOT_ADMIN" }, 403);

  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: rows, error } = await svc.rpc("edition_sources_to_check", { _limit: 60 });
  if (error) return json({ code: "SERVICE_UNAVAILABLE" }, 503);
  const list = (rows ?? []) as { key: string; url: string }[];
  let broken = 0, blocked = 0, ok = 0;
  // Pocas a la vez: cortesía con los sitios de las fuentes.
  for (let i = 0; i < list.length; i += 4) {
    const batch = list.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (s) => ({ s, r: await checkLink(s.url) })));
    for (const { s, r } of results) {
      if (r.status === "broken") broken++; else if (r.status === "blocked") blocked++; else ok++;
      await svc.rpc("edition_record_link_check", { _key: s.key, _status: r.status, _http: r.http });
    }
  }
  return json({ ok: true, checked: list.length, ok_count: ok, broken, blocked });
});
