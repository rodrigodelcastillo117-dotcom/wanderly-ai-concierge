// scan-receipt — lee la foto de un ticket (comercio, fecha, total, moneda, propina, IVA y conceptos)
// con el modelo de visión que ya usa la app (Gemini vía _shared/ai.ts, como parse-trip-file y
// tag-moment). NO guarda nada: devuelve la lectura para llenar el formulario y la persona confirma.
// Reglas y validación en ./receipt.ts.
//
// POST { trip_id, path, currency_hint? } con la sesión de la persona. path es la foto que la app ya
// subió a trip-receipts/<trip_id>/<su id>/<archivo>.
//   200 { ok: true, receipt }   ·   422 { ok: false, code: "ilegible"|"sin_total"|"respuesta_invalida", message }
//   503 { ok: false, code: "sin_ia" } si no hay proveedor de IA configurado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { aiFetchDetailed } from "../_shared/ai.ts";
import { logUsage } from "../_shared/serpRuntime.ts";
import { usageFromChat } from "../_shared/usage.ts";
import { canalDeLlamada } from "../_shared/channels/modoCanal.ts";
import { MAX_RECEIPT_BYTES, mimeForReceipt, parseReceipt, RECEIPT_BUCKET, receiptBody, receiptContent, receiptPathOk, receiptTruncated, toBase64 } from "./receipt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function readReceipt(admin: any, path: string): Promise<Uint8Array | null> {
  const pdf = path.toLowerCase().endsWith(".pdf");
  // Primero una versión reducida (legible y más barata); si la transformación no está disponible, el original.
  const options = pdf ? [undefined] : [{ transform: { width: 1600, height: 1600, resize: "contain", quality: 80 } }, undefined];
  for (const opts of options) {
    try {
      const { data, error } = await admin.storage.from(RECEIPT_BUCKET).download(path, opts as any);
      if (error || !data) continue;
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength > 0 && bytes.byteLength <= MAX_RECEIPT_BYTES) return bytes;
    } catch { /* siguiente opción */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  // Foto mandada por Telegram/WhatsApp: misma sesión del viajero; la firma interna solo quita la cubeta por IP (la IP es
  // la de nuestro servidor). Firma presente pero inválida → fuera.
  const modo = await canalDeLlamada(req.headers, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", user.id);
  if (modo.invalido) return unauthorizedResponse(corsHeaders);
  const rl = await enforceRateLimit(req, "scan-receipt", user.id, { perMinute: 6, perHour: 40, ipPerMinute: 20, skipIp: !!modo.canal });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const body = await req.json().catch(() => ({}));
  const tripId = typeof body?.trip_id === "string" && UUID.test(body.trip_id) ? body.trip_id.toLowerCase() : null;
  const path = typeof body?.path === "string" ? body.path : null;
  if (!tripId || !path || !receiptPathOk(path, tripId, user.id)) return json({ ok: false, error: "Foto no válida" }, 400);

  // Miembro del viaje (dueño o colaborador aceptado), con la sesión de la persona.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: access } = await supabase.rpc("has_trip_access", { p_trip: tripId, p_user: user.id });
  if (access !== true) return json({ ok: false, error: "No tienes acceso a este viaje" }, 403);
  const { data: trip } = await supabase.from("trips").select("destino, pais_destino").eq("id", tripId).maybeSingle();

  const apiKey = Deno.env.get("LOVABLE_API_KEY") || Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return json({ ok: false, code: "sin_ia", message: "La lectura de tickets no está disponible por ahora. Captura el gasto a mano." }, 503);

  const bytes = await readReceipt(adminClient(), path);
  if (!bytes) return json({ ok: false, code: "ilegible", message: "No encontramos la foto o pesa demasiado. Súbela otra vez." }, 422);

  try {
    const hint = typeof body?.currency_hint === "string" && /^[A-Za-z]{3}$/.test(body.currency_hint) ? body.currency_hint : null;
    const { res, provider, model } = await aiFetchDetailed({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY") ?? ""}` },
      body: JSON.stringify(receiptBody(`data:${mimeForReceipt(path)};base64,${toBase64(bytes)}`, {
        currency: hint, destination: [trip?.destino, trip?.pais_destino].filter(Boolean).join(", ") || null,
      })),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      console.warn("scan-receipt: IA", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return json({ ok: false, code: "respuesta_invalida", message: "No pudimos leer el ticket ahora. Intenta de nuevo o captúralo a mano." }, 502);
    }
    const data = await res.json();
    await logUsage({ user_id: user.id, function: "scan-receipt", provider, model, ...(usageFromChat(data) ?? {}) });
    const choice = data?.choices?.[0];
    const result = parseReceipt(receiptContent(choice), new Date().toISOString().slice(0, 10));
    if (!result.ok && result.code === "respuesta_invalida") {
      // Respuesta cortada o rara: es un problema de la lectura, no de la foto. Se dice así (502, no 422).
      console.warn("scan-receipt: respuesta sin JSON válido", receiptTruncated(choice) ? "(cortada por tokens)" : "", String(choice?.finish_reason ?? ""));
      return json({ ok: false, code: "respuesta_invalida", message: "No pudimos terminar de leer el ticket. Intenta de nuevo o captúralo a mano." }, 502);
    }
    return json(result, result.ok ? 200 : 422);
  } catch (e) {
    console.warn("scan-receipt:", (e as Error)?.message);
    return json({ ok: false, code: "respuesta_invalida", message: "No pudimos leer el ticket ahora. Intenta de nuevo o captúralo a mano." }, 502);
  }
});
