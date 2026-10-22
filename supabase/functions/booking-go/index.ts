// booking-go — salida al proveedor con token firmado (ver go.ts). verify_jwt = false: el navegador
// llega aquí con un enlace normal (<a target="_blank">) sin encabezado de sesión; la autorización es
// la firma HMAC del token, atada al usuario y con caducidad de 30 minutos.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { resolveGo } from "./go.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Método no permitido", { status: 405 });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await resolveGo(req.url, {
    secret: SERVICE_KEY,
    markRedirected: async (i, u) => {
      // HEAD (previsualizadores de enlaces, antivirus) no cuenta como salida.
      if (req.method === "HEAD") return { ok: false, code: "HEAD" };
      const { data, error } = await admin.rpc("booking_intent_mark_redirected", { _id: i, _user: u });
      if (error) console.error("booking-go:", error.message);
      return (data as any) ?? null;
    },
  });
  return new Response(null, {
    status: r.status,
    headers: {
      Location: r.location,
      "Cache-Control": "no-store",
      // El token viaja en la URL de esta función: que no llegue al proveedor como referer.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
});
