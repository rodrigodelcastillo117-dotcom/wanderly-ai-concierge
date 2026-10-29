// Botones de "Llamada directa" en Emergencia local (ola 9.5, 29-oct-2026). En México salían tres botones
// iguales "🚑 911 · 🚓 911 · 🚒 911", distinguidos solo por un emoji: no se entendía cuál tocar. Ahora un
// número compartido es UN botón que dice para qué sirve, y cada botón lleva su nombre en palabras.

export interface EmergencyNumbers { police: string; medical: string; fire: string; general?: string }
export interface CallButton { number: string; label: string }

const NAMES: Record<"medical" | "police" | "fire", string> = { medical: "ambulancia", police: "policía", fire: "bomberos" };

const joinEs = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function emergencyCallButtons(n: EmergencyNumbers): CallButton[] {
  const groups = new Map<string, string[]>();
  for (const k of ["medical", "police", "fire"] as const) {
    const num = String(n[k] ?? "").trim();
    if (!num) continue;
    groups.set(num, [...(groups.get(num) ?? []), NAMES[k]]);
  }
  const out: CallButton[] = [...groups.entries()].map(([number, names]) => ({ number, label: cap(joinEs(names)) }));
  const general = String(n.general ?? "").trim();
  if (general && !groups.has(general)) out.push({ number: general, label: "Emergencias (general)" });
  return out;
}
