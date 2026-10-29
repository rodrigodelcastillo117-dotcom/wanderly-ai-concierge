import { useEffect, useState } from "react";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { SRE_GUIA_URL } from "../../../supabase/functions/_shared/sre.ts";
import {
  type AdvisoryFail, type AdvisoryOk, type AdvisoryResult, type AvisoFuente, type PaisResuelto, fechaFuente, fetchAdvisory, severity, tripCountries,
} from "@/lib/travelAdvisory";

/**
 * "Antes de viajar": avisos OFICIALES por país del viaje, con fuente y fecha. La Guía del Viajero de la
 * SRE (lo que aplica a un pasaporte mexicano) va siempre primero y no depende de ninguna consulta.
 * GOV.UK y el Departamento de Estado se muestran como lo que son: avisos para sus propios ciudadanos.
 * Carga perezosa: solo consulta cuando la pestaña está visible (`active`), y cada país una sola vez.
 */
export function BeforeYouTravelCard({ trip, destinations = [], active }: {
  trip: { id?: string; pais_destino?: string | null; destino?: string | null };
  destinations?: string[];
  active: boolean;
}) {
  const countries = tripCountries(trip, destinations);
  if (!countries.length) return null;
  const sre = { url: SRE_GUIA_URL };
  return (
    <section data-testid="antes-de-viajar" className="glass-card rounded-2xl p-4 sm:p-5 space-y-4" aria-labelledby="antes-de-viajar-titulo">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
        <h2 id="antes-de-viajar-titulo" className="font-display text-lg sm:text-xl">Antes de viajar</h2>
        <span className="text-xs text-muted-foreground truncate">{countries.map((c) => c.nombre).join(" · ")}</span>
      </div>

      {/* Primero y siempre visible: lo que aplica a un pasaporte mexicano. */}
      <a
        href={sre.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="avisos-sre"
        className="flex items-start justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3 transition hover:bg-primary/10"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">Para mexicanos: consulta la Guía del Viajero de la SRE</span>
          <span className="block text-xs text-muted-foreground">Requisitos de entrada, visas y contactos consulares para pasaporte mexicano.</span>
        </span>
        <ExternalLink className="w-4 h-4 shrink-0 text-primary mt-0.5" aria-hidden />
      </a>

      {countries.map((c) => (
        <CountryAdvisory key={c.iso2} pais={c} tripId={trip.id ?? null} active={active} showName={countries.length > 1} />
      ))}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        GOV.UK y el Departamento de Estado de EE. UU. publican estos avisos para sus propios ciudadanos; los requisitos de
        entrada que mencionan no son los de un pasaporte mexicano. No sustituye asesoría migratoria, legal o consular.
      </p>
    </section>
  );
}

type Load = { state: "idle" } | { state: "loading" } | { state: "error" } | { state: "done"; data: AdvisoryResult };

function CountryAdvisory({ pais, tripId, active, showName }: { pais: PaisResuelto; tripId: string | null; active: boolean; showName: boolean }) {
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || load.state === "done" || load.state === "loading") return;
    let alive = true;
    setLoad({ state: "loading" });
    fetchAdvisory(pais.iso2, tripId)
      .then((data) => { if (alive) setLoad({ state: "done", data }); })
      .catch(() => { if (alive) setLoad({ state: "error" }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pais.iso2, attempt]);

  return (
    <div className="space-y-3" data-testid={`avisos-${pais.iso2}`}>
      {showName && <h3 className="text-xs uppercase tracking-[0.18em] text-primary">{pais.nombre}</h3>}
      {(load.state === "idle" || load.state === "loading") && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Consultando avisos oficiales…
        </p>
      )}
      {load.state === "error" && (
        <p className="text-xs text-muted-foreground" role="status">
          No pudimos consultar los avisos oficiales ahora.{" "}
          <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => { setLoad({ state: "idle" }); setAttempt((n) => n + 1); }}>
            Reintentar
          </button>
        </p>
      )}
      {load.state === "done" && <AdvisoryBody data={load.data} />}
    </div>
  );
}

const SEVERITY_CLASS = [
  "border-primary/30 bg-primary/5 text-foreground/90",
  "border-amber-500/40 bg-amber-500/10 text-amber-300",
  "border-orange-500/50 bg-orange-500/10 text-orange-300",
  "border-red-500/50 bg-red-500/10 text-red-300",
];
const QUIEN = { govuk: "Reino Unido (FCDO)", state_dept: "EE. UU. (Depto. de Estado)" } as const;

function LevelBadge({ f }: { f: AvisoFuente }) {
  const s = severity(f.nivel);
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${SEVERITY_CLASS[s ?? 0]}`} data-testid={`nivel-${f.fuente}`} data-severidad={s ?? ""}>
      <span className="font-medium">{QUIEN[f.fuente]}:</span> {f.nivel.etiqueta}
    </div>
  );
}

function AdvisoryBody({ data: result }: { data: AdvisoryResult }) {
  if (!result.ok) return <p className="text-xs text-muted-foreground">{(result as AdvisoryFail).mensaje}</p>;
  const data = result as AdvisoryOk;
  if (!data.fuentes.length) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {data.fallas.map((f) => f.mensaje).join(" ") || "No hay avisos oficiales disponibles para este país."}
      </p>
    );
  }
  const puntos = data.traduccion?.puntos ?? [];
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {data.fuentes.map((f) => <LevelBadge key={f.fuente} f={f} />)}
      </div>

      {puntos.length > 0 ? (
        <ul className="space-y-1.5" data-testid="avisos-puntos">
          {puntos.slice(0, 4).map((p, i) => (
            <li key={i} className="flex gap-2 text-sm leading-snug text-foreground/90">
              <span className="text-primary" aria-hidden>•</span>
              <span>{p.texto} <span className="text-[10px] text-muted-foreground">({p.fuente === "govuk" ? "GOV.UK" : "Depto. de Estado"})</span></span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-2" data-testid="avisos-original">
          <p className="text-[11px] text-amber-400">No pudimos traducirlo ahora; este es el texto original en inglés.</p>
          {data.fuentes.map((f) => (
            <p key={f.fuente} lang="en" className="text-xs leading-relaxed text-muted-foreground">
              {f.resumen.length > 320 ? `${f.resumen.slice(0, 319).trimEnd()}…` : f.resumen}
            </p>
          ))}
        </div>
      )}

      {data.fallas.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{data.fallas.map((f) => f.mensaje).join(" ")}</p>
      )}

      <ul className="space-y-1 border-t border-border/40 pt-2" data-testid="avisos-fuentes">
        {data.fuentes.map((f) => (
          <li key={f.fuente} className="text-[11px] leading-relaxed text-muted-foreground">
            Fuente: {f.fuente_nombre}{fechaFuente(f.actualizado_at) ? `, actualizado ${fechaFuente(f.actualizado_at)}` : ""} · Aviso para {f.para_quien}
            {f.licencia ? " · Licencia Open Government v3.0" : ""} ·{" "}
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">Ver original</a>
          </li>
        ))}
        {data.guardado && (
          <li className="text-[11px] text-amber-400">Las fuentes no respondieron; es lo consultado el {fechaFuente(data.consultado_at)}.</li>
        )}
      </ul>
    </div>
  );
}
