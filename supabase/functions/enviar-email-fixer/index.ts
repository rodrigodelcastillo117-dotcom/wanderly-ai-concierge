// Edge function: enviar-email-fixer
// Envía un email al Fixer humano vía Resend cuando un usuario escala desde el Concierge.
// Si RESEND_API_KEY no está configurada, el cliente hace fallback a mailto:.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FIXER_EMAIL = Deno.env.get("FIXER_EMAIL") || "rodrigo@traveliatos.life";
const FROM_ADDRESS =
  Deno.env.get("FIXER_FROM_ADDRESS") ||
  "IATOS Fixer <onboarding@resend.dev>";

interface FixerPayload {
  user_name: string;
  user_email: string;
  user_phone?: string;
  trip?: {
    titulo?: string;
    destinos?: string;
    fecha_salida?: string;
    fecha_regreso?: string;
  };
  urgencia: "critica" | "alta" | "media" | "baja";
  motivo: string;
  contexto_chat?: Array<{ role: string; content: string }>;
}

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function construirHtmlEmail(p: FixerPayload): string {
  const color =
    ({
      critica: "#dc2626",
      alta: "#ea580c",
      media: "#ca8a04",
      baja: "#65a30d",
    } as const)[p.urgencia] || "#65a30d";

  const trip = p.trip
    ? `<h3 style="margin:18px 0 4px;color:#111">Viaje activo</h3>
       <p style="margin:2px 0"><b>Título:</b> ${esc(p.trip.titulo || "Sin título")}</p>
       <p style="margin:2px 0"><b>Destinos:</b> ${esc(p.trip.destinos || "N/A")}</p>
       <p style="margin:2px 0"><b>Fechas:</b> ${esc(p.trip.fecha_salida || "?")} al ${esc(p.trip.fecha_regreso || "?")}</p>`
    : "";

  const chat =
    p.contexto_chat && p.contexto_chat.length
      ? `<h3 style="margin:18px 0 4px;color:#111">Contexto chat con Iato</h3>
         <div style="background:#f5f5f5;padding:12px;border-radius:8px;font-size:13px">
           ${p.contexto_chat
             .slice(-3)
             .map(
               (t) =>
                 `<p style="margin:6px 0"><b>${t.role === "user" ? "Cliente" : "Iato"}:</b> ${esc(
                   (t.content || "").slice(0, 300),
                 )}</p>`,
             )
             .join("")}
         </div>`
      : "";

  return `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#111;padding:20px;max-width:640px;margin:0 auto">
  <h2 style="color:${color};margin:0 0 12px">Solicitud Fixer IATOS — ${p.urgencia.toUpperCase()}</h2>
  <h3 style="margin:18px 0 4px;color:#111">Cliente</h3>
  <p style="margin:2px 0"><b>Nombre:</b> ${esc(p.user_name)}</p>
  <p style="margin:2px 0"><b>Email:</b> ${esc(p.user_email)}</p>
  ${p.user_phone ? `<p style="margin:2px 0"><b>Teléfono:</b> ${esc(p.user_phone)}</p>` : ""}
  ${trip}
  <h3 style="margin:18px 0 4px;color:#111">Motivo</h3>
  <div style="background:#fffbea;padding:12px;border-left:3px solid ${color};border-radius:4px;white-space:pre-wrap">${esc(p.motivo)}</div>
  ${chat}
  <hr style="margin:24px 0;border:none;border-top:1px solid #e5e5e5"/>
  <p style="color:#888;font-size:12px">IATOS AI · ${new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</p>
  <p style="font-size:13px"><a href="mailto:${esc(p.user_email)}" style="color:${color}">Responder al cliente directo</a></p>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({
        error: "Resend not configured",
        hint: "Configurar RESEND_API_KEY en secrets",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const payload = (await req.json()) as FixerPayload;

    if (!payload.user_name || !payload.motivo || !payload.urgencia) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const subject = `[IATOS Fixer · ${payload.urgencia.toUpperCase()}] ${payload.user_name} — ${payload.motivo.slice(0, 60)}`;
    const html = construirHtmlEmail(payload);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [FIXER_EMAIL],
        reply_to: payload.user_email,
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("Resend error:", errorText);
      return new Response(
        JSON.stringify({ error: "Email send failed", details: errorText }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const data = await resp.json();
    return new Response(JSON.stringify({ success: true, email_id: data.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error in enviar-email-fixer:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
