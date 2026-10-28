// Envía el correo de bienvenida al usuario autenticado (solo a su propio email).
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sendEmail } from "../_shared/email.ts";
import { welcomeEmail, welcomeFirstName } from "../_shared/email-templates.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { heroPhoto } from "../_shared/hero-photo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Nombre del perfil y del registro, con la llave de servicio (solo de la propia cuenta). Nunca lanza. */
async function accountNames(userId: string): Promise<{ profileName: string | null; metaName: string | null }> {
  try {
    const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return { profileName: null, metaName: null };
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: prof }, { data: au }] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      admin.auth.admin.getUserById(userId),
    ]);
    const meta = (au?.user?.user_metadata ?? {}) as Record<string, unknown>;
    const metaName = typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null;
    return { profileName: (prof as { full_name?: string | null } | null)?.full_name ?? null, metaName };
  } catch {
    return { profileName: null, metaName: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  const rl = await enforceRateLimit(req, "email-bienvenida", user.id, {
    perMinute: 1, perHour: 3, ipPerMinute: 5,
  });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const body = await req.json().catch(() => ({}));
  const bodyName = typeof body?.nombre === "string" ? body.nombre.slice(0, 80) : null;
  // El saludo usa el nombre que ya tenemos (perfil o registro), no solo lo que mande la app: antes la app
  // llamaba con body {} y la bienvenida nunca decía el nombre (auditoría de cuenta #25).
  const nombre = welcomeFirstName({ ...(await accountNames(user.id)), bodyName });

  // Solo se puede enviar al email del propio usuario autenticado.
  const to = user.email;
  if (!to) {
    return new Response(JSON.stringify({ ok: false, error: "sin_email" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Portada editorial (Pexels, con crédito); sin foto el correo usa su portada tipográfica.
  const hero = await heroPhoto(Deno.env.get("WELCOME_HERO_QUERY") ?? "aerial coastline sunset travel", { fn: "email-bienvenida", userId: user.id });
  const { subject, html, text } = welcomeEmail({ firstName: nombre, hero, siteUrl: Deno.env.get("SITE_URL") });
  const res = await sendEmail({ to, subject, html, text });

  return new Response(JSON.stringify(res), {
    status: res.ok ? 200 : 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
