// Correos del equipo que atiende solicitudes (FIXER_EMAIL). Acepta varios separados por coma
// (28-oct-2026: el dueño y Carlo). Sin variable → hola@traveliatos.life.
export function teamEmails(raw: string | undefined | null = typeof Deno !== "undefined" ? Deno.env.get("FIXER_EMAIL") : undefined): string[] {
  const list = String(raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  return list.length ? [...new Set(list)] : ["hola@traveliatos.life"];
}
