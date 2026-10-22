// /prive/drops — PRIVÉ DROPS (oportunidades verificadas) + THE PRIVILEGE RADAR. Los filtros viven en la URL
// (?tipo=…&destino=…) para conservarse al volver. Si no hay nada verificable, contenido editorial útil.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";
import { DropCard } from "@/components/prive/value/DropCard";
import { EditorialFallback } from "@/components/prive/value/EditorialFallback";
import { PrivilegeRadar } from "@/components/prive/value/PrivilegeRadar";
import { BrandTitle } from "@/components/prive/value/ValueUi";
import { localToday, pick, visibleDrops, type DropType } from "@/lib/priveValueModel";
import { usePriveValue } from "@/lib/priveValueApi";
import { useValueText } from "@/lib/priveValueI18n";

// Móvil: una sola fila deslizable (no ocupa la primera pantalla); escritorio: filas que envuelven.
const filterRow = "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0";
function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-xs tracking-[0.06em] transition-colors ${
        on ? "border-[color:var(--pv-gold)] bg-[color:var(--pv-gold)] text-[#0a0906] font-semibold" : "border-[color:var(--pv-line-strong)] prive-champagne hover:bg-[rgba(201,169,97,0.08)]"}`}>
      {children}
    </button>
  );
}

const TYPE_ORDER: DropType[] = ["promocion_publica", "tarifa_publicada", "beneficio_lealtad", "beneficio_tarjeta", "oferta_temporal", "beneficio_iatos", "editorial"];

export default function PriveDropsPage() {
  const api = usePriveValue();
  const t = useValueText();
  const [params, setParams] = useSearchParams();
  const type = (params.get("tipo") as DropType | null) ?? null;
  const dest = params.get("destino");
  const { data, loading, locked, error } = usePriveLoad(() => api.drops({ limit: 60 }), [api]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  useEffect(() => { if (data) void api.track("drops_view", { surface: "drops" }); }, [api, data]);

  const all = useMemo(() => visibleDrops(data?.items, localToday()), [data]);
  const types = TYPE_ORDER.filter((x) => all.some((d) => d.type === x));
  const dests = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of all) if (d.destination) m.set(d.destination.slug, pick({ es: d.destination.es, en: d.destination.en }, t.lang));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all, t.lang]);
  // Un Drop global (sin destino) aplica en cualquier destino: sigue visible al filtrar.
  const shown = all.filter((d) => (!type || d.type === type) && (!dest || !d.destination || d.destination.slug === dest));
  const setFilter = (k: "tipo" | "destino", v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };
  const follow = async (id: string) => {
    try {
      const r = await api.radarSave({ drop_id: id, state: "por_comprobar" });
      if (r.ok) setFollowing((s) => new Set(s).add(id));
    } catch { /* el radar muestra su propio error */ }
  };
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error ? t.common.error : null} backLabel={t.common.back}>
      <div className="space-y-8">
        <BrandTitle as="h1" name={t.brand.drops.name} sub={t.brand.drops.sub} />
        <p className="max-w-3xl text-sm prive-muted">{t.drops.intro}</p>
        {all.length ? (
          <div className="space-y-3">
            <nav aria-label={t.drops.filterType} className={filterRow}>
              <FilterChip on={!type} onClick={() => setFilter("tipo", null)}>{t.common.all}</FilterChip>
              {types.map((x) => <FilterChip key={x} on={type === x} onClick={() => setFilter("tipo", x)}>{t.dropType[x]}</FilterChip>)}
            </nav>
            {dests.length > 1 ? (
              <nav aria-label={t.drops.filterDest} className={filterRow}>
                <FilterChip on={!dest} onClick={() => setFilter("destino", null)}>{t.common.global}</FilterChip>
                {dests.map(([slug, name]) => <FilterChip key={slug} on={dest === slug} onClick={() => setFilter("destino", slug)}>{name}</FilterChip>)}
              </nav>
            ) : null}
          </div>
        ) : null}
        {data?.expired_recent ? <p className="text-xs prive-muted" data-testid="prive-drops-expired">{t.drops.expired(data.expired_recent)}</p> : null}
        {shown.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="prive-drops-list">
            {shown.map((d) => (
              <DropCard key={d.id} drop={d} lang={t.lang} t={t} following={following.has(d.id)}
                onOpenLink={(x) => void api.track("drop_link_open", { ref: x.id, destination: x.destination?.slug ?? null, surface: "drops" })}
                onFollow={(x) => void follow(x.id)} />
            ))}
          </div>
        ) : data ? (
          <div className="space-y-4">
            <p className="prive-panel p-5 text-sm prive-muted" role="status" data-testid="prive-drops-empty">{t.drops.empty}</p>
            <EditorialFallback api={api} t={t} destination={dest} />
          </div>
        ) : null}
        <hr className="prive-divider" />
        <div id="radar"><PrivilegeRadar key={following.size} /></div>
      </div>
    </PriveCatalogShell>
  );
}
