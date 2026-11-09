// Avisos al equipo (Mesa → «Avisos a mi celular»): a quién le llegan los avisos de un caso que la IA pasa a una
// persona, si este administrador tiene el celular activado, una prueba de punta a punta (correo + push a cada
// persona de la guardia, por el mismo camino que un aviso real) y entrar o salir de la guardia.
// Motivo (9-nov-2026): el Operador IA se encendió y el camino de avisos al equipo nunca se había probado en vivo;
// el dueño y Carlo no tenían el celular activado. Puro: la base, el correo y el push llegan por parámetro.

export type PersonaGuardia = { email: string; name?: string | null; role: "primario" | "respaldo"; user_id?: string | null; on_duty?: boolean; fallback?: boolean };

export type AvisosDeps = {
  /** incident_oncall_now(2, respaldo): toda la guardia (primarios y respaldos). */
  guardia: () => Promise<PersonaGuardia[]>;
  /** ¿La guardia está configurada en incident_oncall (o sale del secreto FIXER_EMAIL)? */
  guardiaConfigurada: () => Promise<boolean>;
  dispositivos: (userId: string) => Promise<number>;
  correo: (to: string, asunto: string, texto: string, html: string) => Promise<{ ok: boolean; error?: string }>;
  push: (userId: string, p: { title: string; body: string; url: string }) => Promise<number>;
  unirse: (p: { email: string; name: string | null; role: "primario" | "respaldo" }) => Promise<{ ok: boolean; error?: string }>;
  salir: (email: string) => Promise<{ ok: boolean; error?: string }>;
  ahora?: () => Date;
};

export type Llamante = { id: string; email: string | null; nombre?: string | null };

const minus = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

export async function estadoAvisos(d: AvisosDeps, yo: Llamante) {
  const [guardia, configurada, mios] = await Promise.all([d.guardia(), d.guardiaConfigurada(), d.dispositivos(yo.id)]);
  const enGuardia = guardia.some((g) => minus(g.email) === minus(yo.email));
  const conCelular = await Promise.all(guardia.map(async (g) => ({ ...g, celular: g.user_id ? (await d.dispositivos(g.user_id)) > 0 : false })));
  return {
    ok: true as const,
    configurada,
    guardia: conCelular.map((g) => ({ email: g.email, nombre: g.name ?? null, rol: g.role, celular: g.celular, de_turno: g.on_duty !== false })),
    yo: { email: yo.email, en_guardia: enGuardia, celular: mios > 0 },
    // Lo que falta para que un aviso urgente llegue al celular de alguien.
    faltan: [
      !configurada ? "La guardia sale del secreto FIXER_EMAIL: agrégate con «Entrar a la guardia» para que el aviso llegue a tu cuenta (y a tu celular)." : null,
      !conCelular.some((g) => g.celular) ? "Nadie de la guardia tiene el celular activado: toca «Activar en este celular» desde tu teléfono." : null,
    ].filter(Boolean) as string[],
  };
}

const ASUNTO = "PRUEBA · Así te llega un aviso urgente de IATOS";

function textoPrueba(quien: string, cuando: string): { texto: string; html: string } {
  const texto = [
    `Esto es una PRUEBA que pidió ${quien} desde la Mesa de operaciones (${cuando}).`,
    "",
    "Así te llega un aviso cuando el Operador IA pasa un caso a una persona (salud, seguridad, algo que hay que pagar o reservar, o cuando el viajero pide hablar con alguien).",
    "No hay ningún viajero esperando: no tienes que hacer nada.",
  ].join("\n");
  const html = texto.split("\n").map((l) => (l ? `<p style="margin:0 0 8px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>` : "")).join("");
  return { texto, html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${html}</div>` };
}

/** Manda la prueba a TODA la guardia (correo a cada uno; push a quien tenga cuenta). No toca casos ni viajeros. */
export async function pruebaAvisos(d: AvisosDeps, yo: Llamante) {
  const guardia = await d.guardia();
  if (!guardia.length) return { ok: false as const, code: "SIN_GUARDIA", resultados: [] };
  const cuando = (d.ahora?.() ?? new Date()).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const { texto, html } = textoPrueba(yo.nombre || yo.email || "el equipo", cuando);
  const resultados = [];
  for (const g of guardia) {
    const em = await d.correo(g.email, ASUNTO, texto, html).catch((e) => ({ ok: false, error: String((e as Error)?.message ?? e) }));
    let push = 0;
    if (g.user_id) push = await d.push(g.user_id, { title: "PRUEBA · Aviso de IATOS", body: "Así te llega un caso urgente. No hay nadie esperando.", url: "/admin/operaciones" }).catch(() => 0);
    resultados.push({ email: g.email, correo: em.ok, error: em.ok ? null : (em.error ?? "no salió"), celular: push > 0 });
  }
  return { ok: resultados.some((r) => r.correo || r.celular), resultados };
}

export async function cambiarGuardia(d: AvisosDeps, yo: Llamante, accion: "unirme" | "salir", rol: unknown) {
  if (!yo.email) return { ok: false as const, code: "SIN_CORREO" };
  if (accion === "salir") return d.salir(minus(yo.email));
  const role = rol === "respaldo" ? "respaldo" : "primario";
  return d.unirse({ email: minus(yo.email), name: yo.nombre ?? null, role });
}
