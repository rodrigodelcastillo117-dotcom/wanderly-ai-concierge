// Envío de emails transaccionales vía el gateway de Resend de Lovable.
// Uso server-side (edge functions): no requiere JWT de usuario.

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM_DEFAULT = "IATOS AI <hola@traveliatos.life>";

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
    console.warn("sendEmail: faltan LOVABLE_API_KEY o RESEND_API_KEY");
    return { ok: false, error: "email_not_configured" };
  }
  try {
    const r = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: opts.from ?? FROM_DEFAULT,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("sendEmail error", r.status, data);
      return { ok: false, error: data?.message ?? `resend_${r.status}` };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    console.error("sendEmail exception", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

const money = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n || 0);

export function layout(title: string, inner: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#0b0b0c;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#eae6df">
  <div style="max-width:600px;margin:0 auto;padding:32px 20px">
    <div style="font-size:13px;letter-spacing:.28em;color:#c9a227;text-transform:uppercase;margin-bottom:24px">IATOS AI</div>
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 16px;color:#fff">${title}</h1>
    ${inner}
    <p style="margin-top:32px;font-size:12px;color:#8a8578">
      IATOS AI · <a href="https://traveliatos.life" style="color:#c9a227">traveliatos.life</a><br/>
      Recibes este correo porque tienes una cuenta en IATOS AI.
    </p>
  </div></body></html>`;
}

export function tripQuoteEmail(opts: {
  nombre?: string | null;
  destino: string;
  fechaSalida?: string | null;
  fechaRegreso?: string | null;
  total: number;
  desglose?: Record<string, unknown> | null;
  tripId: string;
}) {
  const rows = Object.entries(opts.desglose ?? {})
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) =>
      `<tr><td style="padding:8px 0;color:#b8b2a6;text-transform:capitalize">${k.replace(/_/g, " ")}</td>
       <td style="padding:8px 0;text-align:right;color:#fff">${money(Number(v))}</td></tr>`)
    .join("");

  const inner = `
  <p style="font-size:15px;line-height:1.6;color:#cfc9bd">
    ${opts.nombre ? `${opts.nombre}, t` : "T"}u cotización para <strong style="color:#fff">${opts.destino}</strong> está lista.
    ${opts.fechaSalida ? `Fechas: ${opts.fechaSalida}${opts.fechaRegreso ? ` → ${opts.fechaRegreso}` : ""}.` : ""}
  </p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
    ${rows}
    <tr><td style="padding:12px 0;border-top:1px solid #2a2823;color:#c9a227;font-weight:600">Total estimado</td>
        <td style="padding:12px 0;border-top:1px solid #2a2823;text-align:right;color:#c9a227;font-weight:600">${money(opts.total)}</td></tr>
  </table>
  <a href="https://traveliatos.life/dashboard/trips/${opts.tripId}"
     style="display:inline-block;background:#c9a227;color:#141310;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">
    Ver mi cotización completa
  </a>
  <p style="font-size:12px;color:#8a8578;margin-top:18px">
    Precios estimados con datos en vivo de aerolíneas y hoteles al momento de la cotización; pueden variar hasta la reserva.
  </p>`;
  return { subject: `Tu cotización a ${opts.destino} está lista`, html: layout("Tu viaje está cotizado", inner) };
}

export function welcomeEmail(nombre?: string | null) {
  const inner = `
  <p style="font-size:15px;line-height:1.6;color:#cfc9bd">
    ${nombre ? `${nombre}, b` : "B"}ienvenido a IATOS AI. Soy <strong style="color:#fff">Iato</strong>, tu concierge de viajes.
  </p>
  <ul style="font-size:14px;line-height:1.9;color:#cfc9bd;padding-left:18px">
    <li>Cotiza un viaje completo con vuelos y hoteles reales.</li>
    <li>Pídeme transfers, restaurantes y experiencias 24/7.</li>
    <li>Guarda tus tarjetas y programas de lealtad en la Bóveda para exprimir beneficios.</li>
  </ul>
  <a href="https://traveliatos.life/dashboard"
     style="display:inline-block;background:#c9a227;color:#141310;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">
    Entrar a mi dashboard
  </a>`;
  return { subject: "Bienvenido a IATOS AI", html: layout("Tu concierge ya está listo", inner) };
}
