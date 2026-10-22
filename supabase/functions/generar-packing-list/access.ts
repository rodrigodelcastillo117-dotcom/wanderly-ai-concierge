// AUD-SEG-03. Sin dependencias de Deno (se prueba con Vitest: src/test/audSeguridadEdge.test.ts).
// packing_lists tiene UNA fila por viaje (UNIQUE trip_id) y RLS de lectura "solo la mía". Antes la función
// hacía upsert con user_id = quien llama: un colaborador que generaba su lista se quedaba con la fila del
// dueño (el dueño dejaba de verla). Ahora: el dueño siempre puede (re)generar; un colaborador solo si no
// hay lista o si la que hay es suya.
export function canWritePackingList(existing: { user_id: string } | null, callerId: string, ownerId: string): boolean {
  if (callerId === ownerId) return true;
  return existing === null || existing.user_id === callerId;
}

/**
 * Mejora (auditoría de cierre): la lista leía b.benefit_name / b.name, columnas que user_vault_benefits
 * no tiene, así que "Vault activo" siempre llegaba vacío al modelo. La bóveda real es UNA fila con
 * arreglos jsonb. Aquí se resume en nombres útiles para el equipaje (tarjeta, alianza, cadena, renta),
 * SIN números de socio, de cliente ni de documento.
 */
export function vaultSummary(rows: unknown): string[] {
  const out: string[] = [];
  const list = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
  const s = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
  const join = (...p: string[]) => p.filter(Boolean).join(" ");
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    for (const c of list(r.credit_cards)) {
      const lounges = Array.isArray(c.lounge_access) && c.lounge_access.length ? " (salas VIP)" : "";
      const name = s(c.card_name) || join(s(c.bank), s(c.card_tier));
      if (name) out.push(`Tarjeta ${name}${lounges}`);
    }
    for (const a of list(r.airline_alliances)) {
      const name = join(s(a.airline) || s(a.alliance_name), s(a.tier_status));
      if (name) out.push(`Aerolínea ${name}`);
    }
    for (const h of list(r.hotel_loyalty)) {
      const name = join(s(h.chain_name), s(h.status_tier));
      if (name) out.push(`Hotel ${name}`);
    }
    for (const c of list(r.car_rentals)) if (s(c.company_name)) out.push(`Renta de autos ${s(c.company_name)}`);
  }
  return [...new Set(out)].slice(0, 12);
}
