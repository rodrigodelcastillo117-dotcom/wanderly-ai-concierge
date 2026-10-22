// AUD-03 · Confirmaciones ambiguas del restaurante. El clasificador es un LLM: aquí el modelo va
// simulado y MIENTE a propósito (dice "confirmed", booking_held = true y repite los datos de la
// solicitud aunque el correo no los diga). La validación determinista de decideReply() debe impedir la
// confirmación en todos esos casos: solo hay "confirmed" con una frase explícita de confirmación,
// sin contradicciones ni condiciones pendientes, y con fecha, hora y personas dichas en el correo o
// ligadas a nuestra solicitud exacta (respuesta en nuestro hilo que cita la solicitud sin cambios).
import { describe, expect, it } from "vitest";
import { decideReply, parseClassification } from "../../supabase/functions/_shared/ai-reservations/classifier";
import { userUpdateEmail, venueRequestEmail } from "../../supabase/functions/_shared/ai-reservations/templates";
import { ambiguousReasonEs } from "../../supabase/functions/_shared/ai-reservations/evidence";

const row = {
  requested_local: "2026-11-03T20:30", party_size: 4, customer_name: "Ana López", ref_code: "R-ABC234",
  venue_timezone: "America/Mexico_City", venue_language: "es" as const, venue_name: "Casa Oaxaca",
};
// Recibido el lunes 2 de noviembre (hora de CDMX): "mañana" = martes 3.
const RECEIVED = "2026-11-02T18:00:00Z";

/** Salida del modelo que intenta confirmar a toda costa. */
const lie = (text: string, over: Record<string, unknown> = {}) => parseClassification({
  outcome: "confirmed", automatic_reply: false, booking_held: true, stated_date: "2026-11-03", stated_time: "20:30",
  stated_party_size: 4, stated_name: "Ana López", confirmation_code: null, alternatives: [], info_requested: null,
  requires_payment_or_card: false, evidence_quotes: [text], reply_language: "es", summary_es: "El restaurante confirmó.", ...over,
})!;
const ctx = (text: string, extra: Record<string, unknown> = {}) => ({
  replyText: text, fullText: text, verifiedSender: true, fromDomain: "casaoaxaca.com.mx", inboundEmailId: "em_x",
  linkage: "reply_token" as const, receivedAt: RECEIVED, ...extra,
});
const decide = (text: string, over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  decideReply(row as never, lie(text, over), ctx(text, extra) as never);

/** Nuestra solicitud citada tal cual al final de la respuesta (como la deja Gmail/Outlook). */
const quoted = (lang: "es" | "en" | "fr" = "es", over: Partial<typeof row> = {}) => {
  const mail = venueRequestEmail({ ...row, ...over, venue_language: lang, customer_email: null, customer_phone: null, notes: null, consent: null } as never);
  const header = { es: "El lun, 2 nov 2026 a las 10:02, Ana López vía IATOS <reservas@traveliatos.life> escribió:",
    en: "On Mon, Nov 2, 2026 at 10:02 AM Ana López vía IATOS <reservas@traveliatos.life> wrote:",
    fr: "Le lun. 2 nov. 2026 à 10:02, Ana López vía IATOS <reservas@traveliatos.life> a écrit :" }[lang];
  return `\n\n${header}\n${mail.text.split("\n").map((l) => `> ${l}`).join("\n")}`;
};

// Las frases del hallazgo (es) y sus equivalentes en inglés y francés.
const PHRASES: Array<[string, string, string, string]> = [
  // [es, en, fr, resultado esperado]
  ["Sí, perfecto.", "Yes, perfect.", "Oui, parfait.", "ambiguous"],
  ["Tenemos disponibilidad.", "We have availability.", "Nous avons de la disponibilité.", "ambiguous"],
  ["Podemos recibirlos.", "We can host you.", "Nous pouvons vous recevoir.", "ambiguous"],
  ["Confirmado.", "Confirmed.", "Confirmé.", "ambiguous"],
  ["Claro, nos vemos.", "Sure, see you then.", "Bien sûr, à bientôt.", "ambiguous"],
  ["Tenemos mesa para mañana, pero no a la hora solicitada.", "We have a table tomorrow, but not at the requested time.",
    "Nous avons une table demain, mais pas à l'heure demandée.", "ambiguous"],
  ["Podemos recibir a dos, no a cuatro.", "We can seat two, not four.", "Nous pouvons accueillir deux personnes, pas quatre.", "ambiguous"],
  ["La fecha solicitada no está disponible.", "The requested date is not available.", "La date demandée n'est pas disponible.", "ambiguous"],
  ["Necesitamos tarjeta para garantizar la reserva.", "We need a card to guarantee the booking.",
    "Nous avons besoin d'une carte bancaire pour garantir la réservation.", "payment_required"],
  ["Queda pendiente la confirmación final.", "Final confirmation is still pending.", "La confirmation finale reste en attente.", "ambiguous"],
];

describe("AUD-03 · el modelo dice 'confirmed' pero la respuesta no lo sostiene", () => {
  for (const [es, en, fr, expected] of PHRASES) {
    for (const [lang, text] of [["es", es], ["en", en], ["fr", fr]] as const) {
      it(`[${lang}] "${text}" → ${expected}, nunca confirmed`, () => {
        const d = decide(text, { reply_language: lang });
        expect(d.outcome).toBe(expected);
        expect(d.confirmation).toBeUndefined();
      });
    }
  }

  it("el modelo inventa la hora: el correo dice 21:00 y el modelo 20:30 → no se confirma", () => {
    const d = decide("Confirmamos su reserva para 4 personas el 3 de noviembre a las 21:00.");
    expect(d.outcome).not.toBe("confirmed");
    expect(d.confirmation).toBeUndefined();
  });
  it("el modelo inventa las personas (el correo no dice cuántas y no cita la solicitud) → ambiguous", () => {
    expect(decide("Confirmamos su reserva el 3 de noviembre a las 20:30.").outcome).toBe("ambiguous");
  });
  it("otro nombre en el correo → ambiguous aunque el modelo diga el nombre correcto", () => {
    const d = decide("Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30 a nombre de Pedro Ruiz.");
    expect(d.outcome).toBe("ambiguous");
    expect(decide("Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30 a nombre de Pedro Ruiz.", { stated_name: "Pedro Ruiz" }).outcome).toBe("ambiguous");
  });
  it("otro día de la semana → ambiguous", () => {
    expect(decide("Confirmamos su reserva para 4 personas el miércoles a las 20:30.").outcome).toBe("ambiguous");
  });
  it("'mañana' que no es el día pedido → ambiguous", () => {
    expect(decide("Confirmamos su reserva para mañana a las 20:30 para 4 personas.", {}, { receivedAt: "2026-11-01T18:00:00Z" }).outcome).toBe("ambiguous");
  });
  it("confirmación con una pregunta pendiente → no se confirma", () => {
    const d = decide("Confirmamos su reserva para 4 personas el 3 de noviembre a las 20:30. ¿Nos comparte un teléfono?");
    expect(d.outcome).not.toBe("confirmed");
  });
  it("tarjeta o depósito aunque el modelo diga que no hay pago → payment_required", () => {
    expect(decide("Confirmamos su reserva para 4 personas el 3 de noviembre a las 20:30. Requerimos un depósito de 500 pesos.").outcome).toBe("payment_required");
    expect(decide("Your table for 4 on November 3 at 8:30 pm is confirmed. A credit card is required to hold it.").outcome).toBe("payment_required");
  });
  it("el modelo dice booking_held = false → ambiguous aunque haya 'confirmamos'", () => {
    expect(decide("Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30.", { booking_held: false }).outcome).toBe("ambiguous");
  });
  it("el modelo agrega una cita que no está en el correo → no cuenta como evidencia", () => {
    const d = decide("Tenemos disponibilidad.", { evidence_quotes: ["Confirmamos su reserva para 4 personas"] });
    expect(d.outcome).toBe("ambiguous");
  });
  it("cita inventada (sin fixture): en nuestro hilo todo lo demás confirmaría, pero la frase del modelo no está escrita → ambiguous", () => {
    // r2: armada sin el fixture grabado. Respuesta en nuestro hilo que cita la solicitud sin cambios
    // (fecha, hora y personas ligadas a la solicitud) y el modelo sin datos "afirmados": lo ÚNICO que
    // falta es que la frase de confirmación esté escrita por el restaurante.
    const nulls = { stated_date: null, stated_time: null, stated_party_size: null, stated_name: null };
    const thread = (reply: string) => ({ fullText: reply + quoted("es") });
    // Control: con la frase escrita, la ligadura con la solicitud citada (quotedRequestLinked) confirma.
    const ok = decide("Confirmamos su reserva. Los esperamos.", { ...nulls, evidence_quotes: ["Confirmamos su reserva."] }, thread("Confirmamos su reserva. Los esperamos."));
    expect(ok.outcome).toBe("confirmed");
    expect(ok.confirmation).toMatchObject({ linkage: { quoted_request: true }, conditions: { party_size: { basis: "thread_quote" } } });
    // La misma respuesta sin la frase, con el modelo inventándola (o copiándola de nuestro propio correo citado).
    for (const invented of ["Confirmamos su reserva.", "Su reserva está confirmada", "Ana López vía IATOS"]) {
      const d = decide("Gracias, los esperamos.", { ...nulls, evidence_quotes: [invented] }, thread("Gracias, los esperamos."));
      expect(d.outcome, invented).toBe("ambiguous");
      expect(d.quotes, invented).toEqual([]);
      expect(d.why, invented).toBe("no_verbatim_quote");
    }
  });
});

describe("AUD-03 · número de confirmación: nunca inventado", () => {
  const ok = "Con gusto confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30 a nombre de Ana López. Su número de confirmación es MX-4821.";
  it("el código escrito por el restaurante se guarda", () => {
    const d = decide(ok, { confirmation_code: "MX-4821" });
    expect(d.outcome).toBe("confirmed");
    expect(d.confirmation?.code).toBe("MX-4821");
  });
  it("un código que no está en el correo, un fragmento suelto ('4') o nuestro propio folio → null", () => {
    expect(decide(ok, { confirmation_code: "ZZ-9999" }).confirmation?.code).toBeNull();
    expect(decide(ok, { confirmation_code: "4" }).confirmation?.code).toBeNull();
    expect(decide(`${ok} Ref R-ABC234`, { confirmation_code: "R-ABC234" }).confirmation?.code).toBeNull();
    expect(decide(ok, { confirmation_code: "20:30" }).confirmation?.code).toBeNull();
  });
});

describe("AUD-03 · confirmación suficiente", () => {
  it("fecha, hora, personas y nombre escritos por el restaurante y sin contradicciones → confirmed (es/en/fr)", () => {
    const es = decide("Con gusto confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30 a nombre de Ana López.");
    expect(es.outcome).toBe("confirmed");
    expect(es.confirmation).toMatchObject({
      conditions: {
        date: { value: "2026-11-03", basis: "stated" }, time: { value: "20:30", basis: "stated" },
        party_size: { value: 4, basis: "stated" }, name: { basis: "stated" },
      },
      contradictions: [],
    });
    expect(decide("We confirm your reservation for 4 guests on Tuesday, November 3rd at 8:30 pm.", { stated_name: null }).outcome).toBe("confirmed");
    expect(decide("Nous confirmons votre réservation pour 4 personnes le mardi 3 novembre à 20h30.", { stated_name: null }).outcome).toBe("confirmed");
  });
  it("'mañana' que sí es el día pedido cuenta como fecha", () => {
    expect(decide("Confirmamos su reserva para mañana a las 20:30 para 4 personas.", { stated_name: null }).outcome).toBe("confirmed");
  });
  it("'Confirmado.' en nuestro hilo, citando nuestra solicitud sin cambios → confirmed ligado a la solicitud (es/en/fr)", () => {
    for (const [lang, word] of [["es", "Confirmado."], ["en", "Confirmed."], ["fr", "Confirmé."]] as const) {
      const d = decide(word, { stated_date: null, stated_time: null, stated_party_size: null, stated_name: null }, { fullText: word + quoted(lang) });
      expect(d.outcome, lang).toBe("confirmed");
      expect(d.confirmation).toMatchObject({
        conditions: {
          date: { value: "2026-11-03", basis: "thread_quote" }, time: { value: "20:30", basis: "thread_quote" },
          party_size: { value: 4, basis: "thread_quote" }, name: { basis: "reply_token" },
        },
        linkage: { method: "reply_token", quoted_request: true },
      });
    }
  });
  it("la cita de nuestra solicitud con otro número de personas, sin el folio o de otra solicitud → no liga → ambiguous", () => {
    const nulls = { stated_date: null, stated_time: null, stated_party_size: null, stated_name: null };
    expect(decide("Confirmado.", nulls, { fullText: "Confirmado." + quoted("es", { party_size: 2 }) }).outcome).toBe("ambiguous");
    expect(decide("Confirmado.", nulls, { fullText: "Confirmado." + quoted("es", { ref_code: "R-ZZZ999" }) }).outcome).toBe("ambiguous");
    expect(decide("Confirmado.", nulls, { fullText: "Confirmado." + quoted("es").replace(/> — IATOS · Ref R-ABC234 —\n/, "") }).outcome).toBe("ambiguous");
  });
  it("sin ligadura al hilo (sin token ni folio) el nombre no queda aceptado → ambiguous", () => {
    expect(decide("Confirmamos su reserva para 4 personas el martes 3 de noviembre a las 20:30.", { stated_name: null }, { linkage: null }).outcome).toBe("ambiguous");
  });
});

describe("AUD-03 · alternos 'apartados' que el modelo inventa", () => {
  it("el modelo dice que el alterno ya está apartado pero el correo solo lo ofrece → held = false", () => {
    const text = "Les podemos ofrecer a las 21:15, ¿les funciona?";
    const d = decide(text, { outcome: "alternative_offered", stated_time: null, stated_date: null, stated_party_size: null,
      alternatives: [{ date: null, time: "21:15", note: null }] });
    expect(d.outcome).toBe("alternative_offered");
    expect(d.alternatives).toHaveLength(1);
    expect(d.alternatives![0].held).toBe(false);
  });
  it("un alterno con una hora que el correo no menciona se descarta", () => {
    const d = decide("Les podemos ofrecer a las 21:15.", { outcome: "alternative_offered", booking_held: false,
      alternatives: [{ date: null, time: "21:15", note: null }, { date: null, time: "23:00", note: null }] });
    expect(d.alternatives!.map((a) => a.local)).toEqual(["2026-11-03T21:15"]);
  });
  it("alterno 'apartado' pero con tarjeta → payment_required", () => {
    const d = decide("Les apartamos una mesa para 4 personas a las 21:15 con una tarjeta de garantía.", { outcome: "alternative_offered",
      alternatives: [{ date: null, time: "21:15", note: null }] });
    expect(d.outcome).toBe("payment_required");
  });
});

describe("Mejora · el usuario sabe por qué no se tomó como confirmación", () => {
  it("motivo concreto en el correo de 'revísalo tú'", () => {
    const d = decide("Confirmamos su reserva el 3 de noviembre a las 20:30.", { stated_party_size: null, stated_name: null });
    expect(d.outcome).toBe("ambiguous");
    expect(ambiguousReasonEs(d.why)).toBe("El restaurante no confirmó para cuántas personas.");
    expect(ambiguousReasonEs(decide("Tenemos disponibilidad.", { stated_date: null, stated_time: null, stated_party_size: null, stated_name: null }).why))
      .toMatch(/no dice explícitamente/);
    const mail = userUpdateEmail("ambiguous", { ...row, excerpt: null, info: ambiguousReasonEs(d.why), appUrl: "https://x.test" });
    expect(mail.text).toContain("no confirmó para cuántas personas");
    expect(mail.text).toContain("Aún no es una reserva confirmada");
    expect(ambiguousReasonEs("algo_desconocido")).toBeNull();
  });
});
