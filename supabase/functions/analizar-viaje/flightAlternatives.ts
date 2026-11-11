// «Ver más vuelos» (pedido del dueño, 10/11-nov-2026: «no da más opciones, solo te da 3»; «que sea mejor que una
// agencia»). Además de los 3 vuelos de la cotización (ahorro · equilibrio · premium), hasta 5 vuelos REALES más de la
// misma búsqueda de Google Flights, con tier "alternativa". Comprar enseña los 3 y «Ver más vuelos»; el total sigue
// usando el vuelo del nivel. Sin Deno: se prueba con Vitest.

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const stamp = (t: unknown) => (typeof t === "string" && /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(t) ? t.slice(0, 16) : null);
const escalasText = (n: number) => (n <= 0 ? "Directo" : n === 1 ? "1 escala" : `${n} escalas`);

/** Vuelos reales extra (forma de trips.vuelos_json) que no repiten los que ya están. */
export function flightAlternatives(vuelos: any[], live: any[], o: { fxUsd: number; consultedAt: string; max?: number }): any[] {
  const fx = Number(o.fxUsd) || 0;
  if (!(fx > 0) || !Array.isArray(live) || !live.length) return [];
  const rows = Array.isArray(vuelos) ? vuelos : [];
  // Solo si la cotización ya trae vuelos en vivo de Google (si no, no se mezclan fuentes).
  if (!rows.some((v) => String(v?.fuente_precio ?? "") === "serpapi")) return [];
  const key = (airline: unknown, pp: number, salida: unknown) => `${norm(airline)}|${Math.round(pp / 50)}|${stamp(salida) ?? ""}`;
  const seen = new Set(rows.map((v) => key(v?.aerolinea, Number(v?.precio_por_persona) || 0, v?.salida)));
  // Nada desproporcionado (recorrido 11-nov-2026, CDMX→Oaxaca: «COPA $31,814» junto a Aeroméxico desde $5,710, casi
  // seguro con escala en Panamá): tope = el mayor de 1.5× el vuelo premium o 2.5× el más barato de la cotización.
  const tierPrices = rows.map((v) => Number(v?.precio_por_persona) || 0).filter((n) => n > 0);
  const cap = tierPrices.length ? Math.max(Math.max(...tierPrices) * 1.5, Math.min(...tierPrices) * 2.5) : Infinity;
  const out: any[] = [];
  for (const f of [...live].sort((a, b) => Number(a?.price_per_person_usd) - Number(b?.price_per_person_usd))) {
    if (out.length >= (o.max ?? 5)) break;
    const pp = Math.round((Number(f?.price_per_person_usd) || 0) * fx);
    const link = typeof f?.buy_url === "string" && /^https:\/\//.test(f.buy_url) ? f.buy_url : null;
    if (!(pp > 0) || !f?.airline || !link || pp > cap) continue;
    const k = key(f.airline, pp, f?.departure?.time);
    if (seen.has(k)) continue;
    seen.add(k);
    const salida = stamp(f?.departure?.time);
    const stops = Math.max(0, Number(f?.stops) || 0);
    out.push({
      aerolinea: String(f.airline),
      precio_por_persona: pp,
      escalas: escalasText(stops),
      duracion: typeof f?.duration === "string" ? f.duration : null,
      ...(salida ? { salida } : {}),
      ...(stamp(f?.arrival?.time) ? { llegada: stamp(f?.arrival?.time) } : {}),
      booking_link: link,
      fuente_precio: "serpapi",
      estado_dato: "CONSULTADO_EN_VIVO",
      consultado_at: o.consultedAt,
      tier: "alternativa",
      notas: `Viaje redondo por persona${salida ? `, sale ${salida.slice(11)}` : ""}. Otra opción real de Google Flights para tus fechas; verifica equipaje y asiento al reservar.`,
    });
  }
  return out;
}
