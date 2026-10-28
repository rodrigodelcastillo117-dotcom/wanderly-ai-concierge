// Conexión real (Deno) de Reservas IA: base de datos con service_role, correo (sendEmail de
// _shared/email.ts), Claude (_shared/claude.ts), Google Places y Resend Receiving. La lógica vive en
// service.ts; aquí solo se arman las dependencias. Lo importan ai-reservations, reservations-inbound,
// ai-reservations-cron y, desde el servidor, el Booking Bridge.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { callClaudeWithFallback } from "../claude.ts";
import { sendEmail } from "../email.ts";
import { redactPii } from "../redact.ts";
import type { ModelCall } from "./classifier.ts";
import { type GooglePlace, type PriveExperience, safeFetchPage } from "./contact.ts";
import { DEFAULT_REPLY_DOMAIN } from "./core.ts";
import type { ReceivedEmail, ServiceDeps } from "./service.ts";

const env = (k: string) => Deno.env.get(k) ?? undefined;
const GATEWAY = "https://connector-gateway.lovable.dev";

export function adminDb() {
  return createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const PLACE_FIELDS = [
  "id", "displayName", "formattedAddress", "internationalPhoneNumber", "nationalPhoneNumber", "websiteUri",
  "googleMapsUri", "timeZone", "addressComponents", "businessStatus",
].join(",");

async function googlePlace(placeId: string): Promise<GooglePlace | null> {
  const key = env("GOOGLE_MAPS_API_KEY");
  const lovable = env("LOVABLE_API_KEY");
  if (!key || !lovable || !/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return null;
  const res = await fetch(`${GATEWAY}/google_maps/places/v1/places/${encodeURIComponent(placeId)}?languageCode=es`, {
    headers: { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": key, "X-Goog-FieldMask": PLACE_FIELDS },
  });
  if (!res.ok) return null;
  return await res.json().catch(() => null);
}

/** Contenido de un correo recibido. Resend lo sirve en GET /emails/receiving/{id}. */
async function receivedEmail(emailId: string): Promise<ReceivedEmail | null> {
  if (!/^[A-Za-z0-9-]{8,100}$/.test(emailId)) return null;
  // Por defecto, el mismo gateway de Lovable que usa sendEmail. Si ese gateway no expone Receiving,
  // el dueño define RESEND_RECEIVING_API_KEY (llave re_… de Resend) y se llama directo a api.resend.com.
  const direct = env("RESEND_RECEIVING_API_KEY");
  const url = direct ? `https://api.resend.com/emails/receiving/${emailId}` : `${GATEWAY}/resend/emails/receiving/${emailId}`;
  const headers: Record<string, string> = direct
    ? { Authorization: `Bearer ${direct}` }
    : { Authorization: `Bearer ${env("LOVABLE_API_KEY") ?? ""}`, "X-Connection-Api-Key": env("RESEND_API_KEY") ?? "" };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.warn("reservations: receiving fetch", res.status);
    return null;
  }
  return await res.json().catch(() => null);
}

/**
 * .eml original de un correo recibido (raw.download_url firmado de Resend), solo para calcular su
 * SHA-256 como evidencia (AUD-06). https, 10 s y 5 MB como máximo; si falla, la evidencia queda sin
 * esa huella (el resto sigue: cuerpo, Message-ID, autenticación).
 */
async function fetchRaw(url: string): Promise<ArrayBuffer | null> {
  if (!/^https:\/\//.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" }).catch(() => null);
  if (!res || !res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > 5_000_000) return null;
  const buf = await res.arrayBuffer().catch(() => null);
  return buf && buf.byteLength <= 5_000_000 ? buf : null;
}

export function buildServiceDeps(): ServiceDeps {
  const db = adminDb();
  const callModel: ModelCall | null = env("ANTHROPIC_API_KEY")
    ? async (payload) => {
      try {
        const res = await callClaudeWithFallback(payload, { signal: AbortSignal.timeout(45_000) });
        return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
      } catch {
        return { ok: false, status: 0, data: null };
      }
    }
    : null;
  const siteUrl = env("SITE_URL") ?? "https://traveliatos.life";
  const supabaseUrl = env("SUPABASE_URL");
  return {
    db: {
      rpc: async (fn, args) => {
        const { data, error } = await db.rpc(fn, args ?? {});
        return { data: data as never, error: error ? { message: redactPii(error.message) ?? "db_error" } : null };
      },
    },
    sendEmail: (m) => sendEmail(m),
    callModel,
    contact: {
      googlePlace,
      priveExperience: async (id): Promise<PriveExperience | null> => {
        const { data } = await db.from("prive_experiences")
          .select("id,name,address,website,booking_url,google_place_id,destination:prive_destinations!prive_experiences_destination_id_fkey(name_es,iso_country,timezone)")
          .eq("id", id).maybeSingle();
        if (!data) return null;
        const d = (data as Record<string, any>).destination ?? {};
        return {
          id: data.id, name: data.name, address: data.address, website: data.website, booking_url: data.booking_url,
          google_place_id: data.google_place_id, city: d.name_es ?? null, country: d.iso_country ?? null, timezone: d.timezone ?? null,
        };
      },
      fetchPage: (url) => safeFetchPage(fetch, url),
    },
    profile: async (userId) => {
      const [{ data: u }, { data: p }] = await Promise.all([
        db.auth.admin.getUserById(userId),
        db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      ]);
      return { name: (p as { full_name?: string } | null)?.full_name ?? null, email: u?.user?.email ?? null };
    },
    receivedEmail,
    fetchRaw,
    config: {
      replyDomain: env("AI_RESERVATIONS_REPLY_DOMAIN") ?? DEFAULT_REPLY_DOMAIN,
      fromAddress: env("AI_RESERVATIONS_FROM_ADDRESS"),
      appUrl: `${siteUrl}/dashboard/reservas#reservas-ia`,
      functionUrl: supabaseUrl ? `${supabaseUrl}/functions/v1/ai-reservations` : null,
      linkSecret: env("AI_RESERVATIONS_LINK_SECRET") ?? env("SUPABASE_SERVICE_ROLE_KEY") ?? null,
      inboundSecret: env("RESEND_INBOUND_SECRET"),
      pilotUsers: (env("AI_RESERVATIONS_PILOT_USERS") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)),
      testVenueEmail: env("AI_RESERVATIONS_TEST_VENUE_EMAIL") ?? null,
    },
    warn: (...a) => console.warn(...a.map((x) => redactPii(x) ?? "")),
  };
}
