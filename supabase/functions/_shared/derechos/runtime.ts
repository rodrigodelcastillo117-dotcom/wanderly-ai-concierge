// Conexión real (Deno) del motor de reclamos: base con service_role (solo RPC del servidor), correo
// (sendEmail de _shared/email.ts por Resend), Claude (_shared/claude.ts) y Resend Receiving. La lógica vive
// en servicio.ts. Lo importan reclamos, reclamos-inbound, reclamos-cron y concierge-chat.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { callClaudeWithFallback } from "../claude.ts";
import { sendEmail } from "../email.ts";
import { redactPii } from "../redact.ts";
import type { ModelCall } from "../ai-reservations/classifier.ts";
import type { NucleoIncidentes } from "./nucleo.ts";
import { DOMINIO_RESPUESTA } from "./rutas.ts";
import type { CorreoRecibido, ReclamosDeps } from "./servicio.ts";

const env = (k: string) => Deno.env.get(k) ?? undefined;
const GATEWAY = "https://connector-gateway.lovable.dev";

async function receivedEmail(emailId: string): Promise<CorreoRecibido | null> {
  if (!/^[A-Za-z0-9-]{8,100}$/.test(emailId)) return null;
  const direct = env("RESEND_RECEIVING_API_KEY");
  const url = direct ? `https://api.resend.com/emails/receiving/${emailId}` : `${GATEWAY}/resend/emails/receiving/${emailId}`;
  const headers: Record<string, string> = direct
    ? { Authorization: `Bearer ${direct}` }
    : { Authorization: `Bearer ${env("LOVABLE_API_KEY") ?? ""}`, "X-Connection-Api-Key": env("RESEND_API_KEY") ?? "" };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res || !res.ok) return null;
  return await res.json().catch(() => null);
}

/**
 * ═══ PUNTO DE CONEXIÓN DEL NÚCLEO DE INCIDENTES ═══
 * Hoy devuelve undefined (→ nucleoNulo: no se crea incidente). El coordinador lo reemplaza por el
 * adaptador real sobre _shared/incidents.ts (ver nucleo.ts). Nada más cambia.
 */
export function nucleoDesdeEntorno(_db: unknown): NucleoIncidentes | undefined {
  return undefined;
}

export function buildReclamosDeps(): ReclamosDeps {
  const db = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
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
  return {
    db: {
      rpc: async (fn, args) => {
        const { data, error } = await db.rpc(fn, args ?? {});
        return { data: data as never, error: error ? { message: redactPii(error.message) ?? "db_error" } : null };
      },
    },
    sendEmail: (m) => sendEmail(m),
    callModel,
    receivedEmail,
    profile: async (userId) => {
      const [{ data: u }, { data: p }] = await Promise.all([
        db.auth.admin.getUserById(userId),
        db.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      ]);
      return { name: (p as { full_name?: string } | null)?.full_name ?? null, email: u?.user?.email ?? null };
    },
    nucleo: nucleoDesdeEntorno(db),
    config: {
      replyDomain: env("RECLAMOS_REPLY_DOMAIN") ?? env("AI_RESERVATIONS_REPLY_DOMAIN") ?? DOMINIO_RESPUESTA,
      fromAddress: env("RECLAMOS_FROM_ADDRESS"),
      inboundSecret: env("RECLAMOS_INBOUND_SECRET"),
      appUrl: `${siteUrl}/dashboard`,
    },
    warn: (...a) => console.warn(...a.map((x) => redactPii(x) ?? "")),
  };
}
