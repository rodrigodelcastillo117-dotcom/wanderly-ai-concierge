// enviar-seleccion — "Enviarme mi selección por correo" desde la página del viaje (pestaña Comprar).
// Manda SOLO lo que la persona eligió (vuelo, hotel de cada ciudad, experiencias, restaurantes y auto
// que marcó) con sus precios, su estado y sus botones de compra precargados. Solo al usuario
// autenticado o, si lo elige, a los miembros del viaje que marque. Límite por persona y por viaje.
// La lógica vive en handler.ts (sin Deno) y _shared/selection-email.ts.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser } from "../_shared/verify-auth.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { sendEmail } from "../_shared/email.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import type { HitFn } from "../_shared/rate-limit-core.ts";
import { isConfirmedBooking } from "../_shared/bookingState.ts";
import { handleSelectionEmail, type Member } from "./handler.ts";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...headers } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, code: "metodo" });
  const user = await getAuthUser(req);
  const admin = adminClient();

  const hit: HitFn = async (subject, bucket, rule) => {
    try {
      const { data, error } = await admin.rpc("check_rate_limit", { _subject: subject, _bucket: bucket, _limit: rule.limit, _window_seconds: rule.windowSeconds });
      if (error) { console.error("enviar-seleccion: check_rate_limit", error.message); return null; }
      const allowed = (data as { allowed?: unknown } | null)?.allowed;
      return typeof allowed === "boolean" ? allowed : null;
    } catch (e) {
      console.error("enviar-seleccion: check_rate_limit", (e as Error).message);
      return null;
    }
  };

  try {
    const body = await req.json().catch(() => ({}));
    const result = await handleSelectionEmail(body, {
      user: user ? { id: user.id, email: user.email ?? null } : null,
      rateLimitUser: () => enforceRateLimit(req, "enviar-seleccion", user!.id, { perMinute: 3, perHour: 12, ipPerMinute: 10 }),
      hit,
      loadTrip: async (id) => {
        const { data } = await admin.from("trips").select("*").eq("id", id).maybeSingle();
        return data ?? null;
      },
      members: async (trip) => {
        const { data: collabs } = await admin.from("trip_collaborators").select("user_id").eq("trip_id", trip.id).eq("status", "accepted");
        const ids = [trip.user_id, ...((collabs ?? []) as Array<{ user_id: string }>).map((c) => c.user_id)].filter((x, i, a) => x && a.indexOf(x) === i);
        const { data: profs } = await admin.from("profiles").select("id, full_name").in("id", ids);
        const name = (id: string) => ((profs ?? []) as Array<{ id: string; full_name: string | null }>).find((p) => p.id === id)?.full_name ?? null;
        return ids.map((id): Member => ({ id, name: name(id) }));
      },
      emailOf: async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        return data?.user?.email ?? null;
      },
      marks: async (tripId) => {
        const keys = new Set<string>();
        const confirmed: Array<{ category: string; text: string }> = [];
        const { data: group, error } = await admin.from("trip_purchase_marks").select("item_key").eq("trip_id", tripId);
        if (!error) for (const m of (group ?? []) as Array<{ item_key: string }>) if (m.item_key) keys.add(m.item_key);
        const { data: rows } = await admin.from("bookings").select("category, status, title, subtitle, confirmation_code, partner_reference, raw_payload").eq("trip_id", tripId);
        for (const r of (rows ?? []) as Array<{ category: string | null; status: string | null; title: string | null; subtitle: string | null; confirmation_code: string | null; partner_reference: string | null; raw_payload: any }>) {
          if (r.status === "cancelled") continue;
          const k = r.raw_payload?.compra_item;
          if (typeof k === "string") keys.add(k);
          // Confirmada (mismo criterio que "Comprar": isConfirmedBooking).
          if (r.category && isConfirmedBooking(r)) confirmed.push({ category: r.category, text: `${r.title ?? ""} ${r.subtitle ?? ""}` });
        }
        return { keys, confirmed };
      },
      send: (o) => sendEmail({ to: o.to, subject: o.subject, html: o.html, text: o.text }),
      siteUrl: Deno.env.get("SITE_URL"),
    });
    return json(result.status, result.body, result.body.retry_after ? { "Retry-After": String(result.body.retry_after) } : {});
  } catch (e) {
    console.error("enviar-seleccion error", (e as Error).message);
    return json(500, { ok: false, code: "error", message: "No pudimos enviar el correo. Intenta de nuevo." });
  }
});
