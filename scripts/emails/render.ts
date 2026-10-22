// Renderiza las muestras de todos los correos a docs/iatos/evidencia/emails/<nombre>.html y .txt.
// Uso: npx tsx scripts/emails/render.ts   (no envía nada: solo escribe archivos)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountDeletedEmail, flightUpdateEmail, priceDropEmail, tripInviteEmail, tripQuoteEmail, welcomeEmail,
} from "../../supabase/functions/_shared/email-templates";
import { conciergeRequestOpsEmail } from "../../supabase/functions/_shared/email-ops";
import { layout } from "../../supabase/functions/_shared/email";
import { escapeHtml } from "../../supabase/functions/_shared/email-format";
import { buildFixerEmail, parseFixerPayload } from "../../supabase/functions/enviar-email-fixer/template";
import { alertEmail } from "../../supabase/functions/health-check/alerts";
import { HOTEL_PHOTO, NOW, PHOTOS, SITE } from "./samples";

const OUT = join(process.cwd(), "docs/iatos/evidencia/emails");
mkdirSync(OUT, { recursive: true });
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

type Mail = { subject: string; preheader: string; html: string; text: string };
const samples: Record<string, Mail> = {};

// 1) Cotización mixta: los mismos renglones del correo que recibió el dueño, con su procedencia.
samples["cotizacion"] = tripQuoteEmail({
  firstName: "Rodrigo", tripId: "7d0c3f7e-1111-4a2b-9c3d-5e6f7a8b9c0d", quoteId: "8f3a2c1d-aaaa-4bbb-8ccc-123456789abc",
  destination: "Tokio", origin: "Ciudad de México", dateFrom: "2027-03-20", dateTo: "2027-03-25",
  travelers: 2, rooms: 1, nights: 5, currency: "MXN",
  lines: [
    { category: "vuelos", amount: 13380, state: "COTIZADO", source: "serpapi", consultedAt: minutesAgo(3), qtyBasis: "per_person" },
    { category: "hospedaje", amount: 106460, state: "COTIZADO", source: "serpapi", consultedAt: minutesAgo(3), qtyBasis: "per_room_night" },
    { category: "tours", amount: 6000, state: "ESTIMADO", source: "estimado", qtyBasis: "per_person" },
    { category: "comida", amount: 20000, state: "ESTIMADO", source: "estimado", qtyBasis: "per_trip" },
    { category: "transporte_local", amount: 4000, state: "ESTIMADO", source: "estimado", qtyBasis: "per_trip" },
    { category: "extras", amount: 5000, state: "ESTIMADO", source: "estimado", qtyBasis: "per_trip" },
  ],
  quotedAt: minutesAgo(3), validUntil: new Date(NOW.getTime() + 24 * 3600_000 - 3 * 60_000).toISOString(),
  flight: {
    airline: "ANA", tier: "equilibrio", duration: "13 h 50 min", stops: 0, pricePerPerson: 6690, source: "serpapi", live: true,
    consultedAt: minutesAgo(3), departure: { code: "MEX", time: "2027-03-20 01:20" }, arrival: { code: "NRT", time: "2027-03-21 06:10" },
  },
  hotel: {
    name: "Hotel de muestra Shibuya", type: "Hotel boutique", area: "Shibuya", rating: 4.6, stars: 4, pricePerNight: 21292,
    source: "serpapi", live: true, consultedAt: minutesAgo(3), photoUrl: HOTEL_PHOTO,
  },
  hero: PHOTOS.tokyo, siteUrl: SITE, now: NOW,
});

// 2) Cotización solo estimada, sin foto, con un renglón sin precio y datos viejos sin procedencia.
samples["cotizacion-estimada-sin-foto"] = tripQuoteEmail({
  firstName: null, tripId: "0b5e6f70-2222-4c3d-8e9f-a0b1c2d3e4f5", quoteId: null,
  destination: "San Miguel de Allende", origin: "Monterrey", dateFrom: "2026-12-30", dateTo: "2027-01-03",
  travelers: 4, adults: 2, children: 2, rooms: 2, currency: "MXN",
  lines: [
    { category: "vuelos", amount: 0, state: "ESTIMADO", source: "estimado" },
    { category: "hospedaje", amount: 38400, state: "PENDIENTE", source: "serpapi", consultedAt: minutesAgo(60 * 30) },
    { category: "comida", amount: 9600 },
    { category: "tours", amount: 4800, source: "perplexity", state: "ESTIMADO" },
    { category: "transporte_local", amount: 2500 },
  ],
  quotedAt: minutesAgo(1), validUntil: new Date(NOW.getTime() + 7 * 24 * 3600_000).toISOString(),
  flight: { airline: "Autobús de lujo (ETN / Primera Plus)", mode: "autobus", duration: "≈ 8 h", pricePerPerson: 1450, source: "estimado" },
  hero: null, siteUrl: SITE, now: NOW,
});

samples["bienvenida"] = welcomeEmail({ firstName: "valentina", hero: PHOTOS.tokyoTower, siteUrl: SITE });
samples["bienvenida-sin-nombre-sin-foto"] = welcomeEmail({ siteUrl: SITE });

samples["invitacion-viaje"] = tripInviteEmail({
  guestName: "Mariana", hostName: "Rodrigo del Castillo", destination: "Barcelona", origin: "Ciudad de México",
  dateFrom: "2027-05-08", dateTo: "2027-05-16", travelers: 4, tripId: "c1d2e3f4-3333-4a5b-8c6d-7e8f9a0b1c2d",
  hero: PHOTOS.barcelona, siteUrl: SITE,
});

samples["alerta-precio"] = priceDropEmail({
  firstName: "Rodrigo", tripId: "c1d2e3f4-3333-4a5b-8c6d-7e8f9a0b1c2d", destination: "Barcelona", originCity: "Ciudad de México",
  originCode: "MEX", destinationCode: "BCN", dateFrom: "2027-05-08", dateTo: "2027-05-16", adults: 2, currency: "MXN",
  before: 18420, now: 15960, source: "travelpayouts", checkedAt: minutesAgo(4),
  bookingUrl: "https://www.aviasales.com/search/MEX0805BCN16052?marker=muestra", hero: PHOTOS.barcelona, siteUrl: SITE,
});

samples["alerta-vuelo"] = flightUpdateEmail({
  firstName: "Rodrigo", flight: "am 58", flightDate: "2027-03-20", route: "MEX → NRT",
  changes: ["Puerta: 72 → 75", "Hora estimada de salida: 01:20 → 02:05"], status: "retrasado",
  checkedAt: minutesAgo(2), url: "/dashboard/viajes/7d0c3f7e-1111-4a2b-9c3d-5e6f7a8b9c0d", siteUrl: SITE,
});

samples["cuenta-eliminada"] = accountDeletedEmail({ firstName: "Rodrigo", at: NOW, pending: true, siteUrl: SITE });

// ── Correos internos de operaciones ──
samples["ops-reserva-prive"] = conciergeRequestOpsEmail({
  requestId: "4be1c0de-9f3a-4c2b-8d7e-0123456789ab", type: "prive_request", title: "Le Bernardin",
  createdAt: NOW.toISOString(),
  client: { name: "Valentina Ruiz", email: "valentina@correo-muestra.mx", contactMethod: "whatsapp" },
  trip: { destination: "Nueva York", dateFrom: "2026-11-12", dateTo: "2026-11-17" },
  experience: { name: "Le Bernardin", city: "Nueva York", country: "US", sourceUrl: "https://www.le-bernardin.com/", timezone: "America/New_York" },
  requestedFor: "2026-11-14T20:00:00", partySize: 4,
  preferences: "Mesa tranquila, aniversario. Una persona sin mariscos crudos.",
  payload: { experience_id: "a3c1b2d4-0000-4000-8000-000000000001", requested_for: "2026-11-14T20:00:00", party_size: 4, preferences: "x", contact_method: "whatsapp", plan_group: null },
  siteUrl: SITE,
});
samples["ops-reserva-prive-prueba"] = conciergeRequestOpsEmail({
  requestId: "9c0ffee0-1234-4abc-8def-0123456789ab", type: "prive_request", title: "Experiencia de muestra",
  createdAt: NOW.toISOString(),
  client: { name: null, email: "e2e+prive@mailinator.com", contactMethod: "app" },
  trip: null, experience: { name: "Experiencia de muestra", city: "Ciudad de México", country: "MX", sourceUrl: null, timezone: "America/Mexico_City" },
  requestedFor: "2026-10-30T21:30:00", partySize: 2, preferences: "PRUEBA — no contactar al lugar",
  payload: {}, siteUrl: SITE,
});
samples["ops-mesa-concierge"] = conciergeRequestOpsEmail({
  requestId: "77aa11bb-2222-4ccc-8ddd-eeeeffff0000", type: "reservation", title: "Contramar",
  createdAt: NOW.toISOString(), client: { name: "Rodrigo del Castillo", email: "rodrigo@correo-muestra.mx" },
  trip: { destination: "Ciudad de México", dateFrom: "2026-10-24", dateTo: "2026-10-26" },
  payload: { subtitle: "Mariscos · Roma Norte", meta: ["$$$", "Reservación recomendada"] }, siteUrl: SITE,
});
{
  const parsed = parseFixerPayload({
    user_name: "Valentina Ruiz", user_phone: "+52 55 1234 5678", urgencia: "alta",
    motivo: "Perdí la conexión en Madrid y el siguiente vuelo sale mañana. Necesito hotel cerca del aeropuerto para 2 personas.",
    trip: { titulo: "Barcelona", destinos: "Madrid, Barcelona", fecha_salida: "2027-05-08", fecha_regreso: "2027-05-16" },
    contexto_chat: [{ role: "user", content: "¿Me ayudas con un hotel cerca de Barajas?" }, { role: "assistant", content: "Te conecto con el Fixer para resolverlo ya." }],
  });
  if (!parsed.ok) throw new Error("muestra inválida");
  const f = buildFixerEmail(parsed.value, { email: "valentina@correo-muestra.mx", userId: "5f1e2d3c-0000-4000-8000-00000000abcd" }, NOW);
  samples["ops-fixer"] = { ...f, preheader: "" };
}
{
  const a = alertEmail([
    { name: "SerpApi", ok: false, detail: "HTTP 429 — cuota agotada", ms: 120 },
    { name: "Tareas programadas (pg_cron)", ok: true, warn: "price-watch-twice-daily no corre desde hace 30 h", ms: 0 },
  ], "changed");
  samples["ops-salud"] = { subject: a.subject, preheader: "", html: layout(a.subject, a.html), text: "(el aviso de salud se envía solo en HTML)" };
  const title = "Pago rechazado en una suscripción PRO";
  samples["ops-cobros"] = { subject: `[IATOS] ${title}`, preheader: "", html: layout(escapeHtml(title), `<p>${escapeHtml("Stripe no pudo cobrar la renovación de una suscripción (invoice in_muestra). El acceso sigue activo hasta el fin del periodo.")}</p>`), text: "(el aviso de cobros se envía solo en HTML)" };
}

const only = process.argv[2];
for (const [name, mail] of Object.entries(samples)) {
  if (only && !name.startsWith(only)) continue;
  writeFileSync(join(OUT, `${name}.html`), mail.html);
  writeFileSync(join(OUT, `${name}.txt`), `Asunto: ${mail.subject}\nPreencabezado: ${mail.preheader}\n\n${mail.text}`);
  console.log(`${name}: ${mail.html.length} bytes · ${mail.subject}`);
}
