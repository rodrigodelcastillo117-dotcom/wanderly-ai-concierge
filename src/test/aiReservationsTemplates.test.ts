// Reservas IA: correos al restaurante (es/en/fr, transparentes, sin datos de pago) y al usuario
// (la confirmación cita la respuesta; los demás avisos dicen "aún no es una reserva").
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  reservationIcs, userConfirmedEmail, userUpdateEmail, venueAlternativeEmail, venueCancellationEmail, venueReminderEmail, venueRequestEmail,
} from "../../supabase/functions/_shared/ai-reservations/templates";

const row = {
  ref_code: "R-ABC234", venue_name: "Casa Oaxaca", requested_local: "2026-11-03T20:30", party_size: 4, customer_name: "Ana López",
  customer_email: "ana@cliente.test", customer_phone: "+52 55 1234 5678", notes: "Celebramos un cumpleaños <b>", venue_language: "es" as const,
  consent: { share_contact: false },
};

describe("correo al restaurante", () => {
  it("es: datos, pregunta, firma transparente y folio; sin contacto si no lo autorizó; HTML escapado", () => {
    const m = venueRequestEmail(row);
    expect(m.subject).toBe("Solicitud de reserva · 4 personas · martes, 3 de noviembre de 2026, 20:30 · Ref R-ABC234");
    expect(m.text).toContain("Les escribo en nombre de Ana López");
    expect(m.text).toContain("• Personas: 4");
    expect(m.text).toContain("asistente de IA de IATOS");
    expect(m.text).toContain("— IATOS · Ref R-ABC234 —");
    expect(m.text).toMatch(/Nunca les pediremos ni enviaremos datos de pago/);
    expect(m.text).not.toContain("ana@cliente.test");
    expect(m.text).not.toContain("1234 5678");
    expect(m.html).toContain("&lt;b&gt;");
    expect(m.text.indexOf("• Personas")).toBeLessThan(m.text.indexOf("¿Podrían confirmarnos"));
  });
  it("con permiso comparte teléfono y correo", () => {
    const m = venueRequestEmail({ ...row, consent: { share_contact: true } });
    expect(m.text).toContain("Teléfono de contacto: +52 55 1234 5678");
    expect(m.text).toContain("Correo de contacto: ana@cliente.test");
  });
  it("en y fr en el idioma del lugar", () => {
    expect(venueRequestEmail({ ...row, venue_language: "en" }).subject).toMatch(/^Reservation request · 4 guests · Tuesday, November 3, 2026, 20:30/);
    const fr = venueRequestEmail({ ...row, venue_language: "fr" });
    expect(fr.subject).toMatch(/^Demande de réservation · 4 personnes · mardi 3 novembre 2026, 20:30 · Réf R-ABC234/);
    expect(fr.text).toContain("Je vous écris au nom de Ana López");
  });
  it("recordatorio, alterno, alterno apartado y cancelación", () => {
    expect(venueReminderEmail(row).subject).toMatch(/^Recordatorio: Solicitud de reserva/);
    expect(venueAlternativeEmail({ ...row, requested_local: "2026-11-03T21:15" }, false).text).toMatch(/¿Nos confirman por escrito la reserva a esa hora\?/);
    expect(venueAlternativeEmail({ ...row, requested_local: "2026-11-03T21:15" }, true).text).toMatch(/Aceptamos el horario que nos apartaron: martes, 3 de noviembre de 2026, 21:15/);
    expect(venueCancellationEmail(row).text).toContain("ya no necesitaremos la reserva");
  });
});

describe("correo al usuario", () => {
  const cal = { ...row, venue_address: "Constitución 104, Oaxaca", venue_city: "Oaxaca", venue_place_id: "ChIJ_x_000000001", requested_for: "2026-11-04T02:30:00Z", confirmation_code: "MX-4821" };
  it("confirmación: cita del restaurante, código, .ics, Google/Outlook y cómo llegar", () => {
    const m = userConfirmedEmail({ ...cal, quote: "Con gusto confirmamos su reserva", receivedAt: "2 de noviembre de 2026", icsUrl: "https://fn.test/x?ics=1", appUrl: "https://app.test" });
    expect(m.subject).toBe("Reserva confirmada por Casa Oaxaca · martes, 3 de noviembre de 2026, 20:30");
    expect(m.html).toContain("“Con gusto confirmamos su reserva”");
    expect(m.html).toContain("MX-4821");
    expect(m.html).toContain("https://fn.test/x?ics=1");
    expect(m.text).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
    expect(m.text).toContain("dates=20261104T023000Z%2F20261104T043000Z");
    expect(m.text).toContain("outlook.live.com");
    expect(m.text).toContain("query_place_id=ChIJ_x_000000001");
  });
  it("los demás avisos dicen que aún no es una reserva (o por qué no)", () => {
    for (const k of ["alternative_offered", "needs_info", "payment_required", "unverified", "ambiguous"] as const) {
      expect(userUpdateEmail(k, { ...row, appUrl: "https://app.test", alternatives: ["21:15"] }).text).toMatch(/Aún no es una reserva/);
    }
  });
  it(".ics válido (CRLF, UTC, UID estable, escapado)", () => {
    const ics = reservationIcs({ ...cal, venue_name: "Casa, Oaxaca; Centro" }, new Date("2026-11-02T00:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20261104T023000Z");
    expect(ics).toContain("DTEND:20261104T043000Z");
    expect(ics).toContain("UID:R-ABC234@traveliatos.life");
    expect(ics).toContain("SUMMARY:Reserva en Casa\\, Oaxaca\\; Centro");
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });
});

it("ningún texto de Reservas IA dice 'mesa confirmada' (regla del Booking Bridge)", () => {
  const dir = "supabase/functions/_shared/ai-reservations";
  const files = [...readdirSync(dir).map((f) => `${dir}/${f}`), "supabase/migrations/20261023170000_ai_reservations.sql", "src/components/reservas/AiReservationsPanel.tsx"];
  for (const f of files) expect(readFileSync(f, "utf8").toLowerCase(), f).not.toContain("mesa confirmada");
});
