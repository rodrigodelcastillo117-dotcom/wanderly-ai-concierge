import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { localISODatePlus } from "@/lib/localDate";
import type { PriveExperience, PriveLockedError } from "@/lib/priveCatalogApi";
import { planExperiences, TEMPLATES, type Candidate, type PlanResult } from "../../../../supabase/functions/_shared/privePlanner";
import { AddToTripDialog } from "./AddToTripDialog";
import { PRIVE } from "./theme";

export function toPlannerCandidate(e: PriveExperience): Candidate {
  return {
    id: e.id, slug: e.slug, name: e.name, universe: e.universe, subcategory: e.subcategory, state: e.state, label: e.label ?? null,
    age_policy: e.age_policy, dress_code: e.dress_code ?? null, booking_method: e.booking_method ?? null,
    reservation_required: e.reservation_required ?? null, restrictions: e.restrictions ?? null, safety: e.safety ?? null,
    price_level: e.price_level ?? null, price: e.price ?? null,
    opening_hours: e.opening_hours?.source ? { hours: e.opening_hours.hours as NonNullable<Candidate["opening_hours"]>["hours"], source: e.opening_hours.source } : null,
    duration_min: e.duration_min ?? null, lat: e.lat ?? null, lng: e.lng ?? null, season: e.season ?? null,
    website: e.website ?? null, booking_url: e.booking_url ?? null, tags: e.tags ?? null, destination: e.destination ?? null,
  };
}

/**
 * Experience Planner: propuesta determinista (sin IA) con horarios con fuente, traslados ESTIMADOS,
 * precios con fuente, requisitos y alternativas. Iato la explica; nada se reserva.
 */
export function ExperiencePlanner({ experiences, timeZone, onLocked }: { experiences: PriveExperience[]; timeZone?: string | null; onLocked: (c: PriveLockedError["code"]) => void }) {
  const [text, setText] = useState("Quiero una cena espectacular, conocer un casino elegante, pasar una tarde en un beach club y disfrutar un paseo privado en barco.");
  const [from, setFrom] = useState(localISODatePlus(14));
  const [nights, setNights] = useState(3);
  const [party, setParty] = useState(2);
  const [hotelId, setHotelId] = useState("");
  const [template, setTemplate] = useState("");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const usable = useMemo(() => experiences.filter((e) => e.state !== "DESACTUALIZADO"), [experiences]);
  const hotels = usable.filter((e) => e.universe === "private_stays" && e.lat != null);
  const run = () => {
    const hotel = hotels.find((h) => h.id === hotelId);
    setPlan(planExperiences(usable.map(toPlannerCandidate), {
      dateFrom: from, nights, partySize: party, text, template: template || null, timeZone,
      hotel: hotel ? { name: hotel.name, lat: hotel.lat, lng: hotel.lng } : null,
    }));
  };
  const items = plan ? plan.days.flatMap((d) => d.items.filter((i) => i.experience).map((i) => ({
    experience_id: i.experience!.id, start_at: i.start_iso, template: plan.template, transfer_estimate_min: i.transfer_before?.minutes ?? null, name: i.experience!.name,
  }))) : [];
  return (
    <section className={`${PRIVE.card} space-y-4 p-5`} aria-labelledby="planner-title" data-testid="prive-planner">
      <div>
        <h2 id="planner-title" className={`${PRIVE.serif} text-xl`}>Experience Planner</h2>
        <p className={`text-xs ${PRIVE.muted}`}>Iato arma una propuesta con lo verificado de este destino. Valida horarios, traslados y requisitos; no reserva nada.</p>
      </div>
      <div className="space-y-3">
        <div><Label htmlFor="pl-text">¿Qué quieres vivir?</Label><Textarea id="pl-text" value={text} maxLength={500} onChange={(x) => setText(x.target.value)} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label htmlFor="pl-from">Primer día</Label><Input id="pl-from" type="date" value={from} onChange={(x) => setFrom(x.target.value)} /></div>
          <div><Label htmlFor="pl-n">Noches</Label><Input id="pl-n" type="number" min={1} max={14} value={nights} onChange={(x) => setNights(Math.max(1, Math.min(14, Number(x.target.value) || 1)))} /></div>
          <div><Label htmlFor="pl-p">Personas</Label><Input id="pl-p" type="number" min={1} max={30} value={party} onChange={(x) => setParty(Math.max(1, Math.min(30, Number(x.target.value) || 1)))} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="pl-t">Plan compuesto</Label>
            <select id="pl-t" className="mt-1 w-full rounded-md border border-[color:var(--pv-line-strong)] bg-[color:var(--pv-surface)] p-2 text-sm" value={template} onChange={(x) => setTemplate(x.target.value)}>
              <option value="">Según lo que escribí</option>
              {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="pl-h">Hotel (opcional)</Label>
            <select id="pl-h" className="mt-1 w-full rounded-md border border-[color:var(--pv-line-strong)] bg-[color:var(--pv-surface)] p-2 text-sm" value={hotelId} onChange={(x) => setHotelId(x.target.value)}>
              <option value="">Sin hotel (traslados entre lugares)</option>
              {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
        </div>
        <Button className={PRIVE.button} onClick={run}>Armar propuesta</Button>
      </div>
      {plan && (
        <div className="space-y-4" data-testid="prive-plan">
          {plan.days.filter((d) => d.items.length).map((d) => (
            <div key={d.day} className="space-y-2">
              <h3 className={`text-sm ${PRIVE.gold}`}>Día {d.day} · {d.date}</h3>
              <ol className="space-y-2">
                {d.items.map((it) => (
                  <li key={`${it.intent}-${it.experience?.id}`} className="rounded-xl border border-[color:var(--pv-line)] p-3 text-sm">
                    {it.transfer_before && <p className={`mb-1 text-[11px] ${PRIVE.muted}`}>Traslado: {it.transfer_before.text} · ESTIMADO</p>}
                    <p><span className={PRIVE.gold}>{it.time_text}</span> — {it.intent_label}: <strong>{it.experience?.name}</strong> <span className={`text-xs ${PRIVE.muted}`}>[{it.experience?.state}]</span></p>
                    <p className={`text-xs ${PRIVE.muted}`}>{it.price_text} · duración {it.duration_status === "ESTIMADO" ? "estimada" : "publicada"}</p>
                    {it.requirements.length > 0 && <ul className={`mt-1 list-disc pl-4 text-xs ${PRIVE.muted}`}>{it.requirements.map((r) => <li key={r}>{r}</li>)}</ul>}
                    {it.warnings.length > 0 && <p className="mt-1 text-xs text-amber-300">{it.warnings.join(" · ")}</p>}
                    {it.alternatives.length > 0 && <p className={`mt-1 text-xs ${PRIVE.muted}`}>Alternativas: {it.alternatives.map((a) => a.name).join(", ")}</p>}
                  </li>
                ))}
              </ol>
              {d.return_to_hotel && <p className={`text-[11px] ${PRIVE.muted}`}>Regreso al hotel: {d.return_to_hotel.text} · ESTIMADO</p>}
            </div>
          ))}
          {plan.unplaced.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 p-3 text-xs text-amber-200" role="status">
              {plan.unplaced.map((u) => <p key={u.intent}>{u.reason}</p>)}
            </div>
          )}
          <p className="text-sm">{plan.budget.text}{plan.budget.over_budget ? " · supera tu presupuesto" : ""}</p>
          <ul className={`space-y-0.5 text-[11px] ${PRIVE.muted}`}>{plan.disclaimers.map((x) => <li key={x}>{x}</li>)}</ul>
          {items.length > 0 && <Button variant="outline" className={PRIVE.ghost} onClick={() => setSaveOpen(true)}>Guardar propuesta en mi viaje</Button>}
          <AddToTripDialog items={items} open={saveOpen} onOpenChange={setSaveOpen} timeZone={timeZone} onLocked={onLocked} askTime={false} />
        </div>
      )}
    </section>
  );
}
