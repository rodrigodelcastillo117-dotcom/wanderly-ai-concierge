import { useState } from "react";
import { Bookmark, BookmarkCheck, CalendarPlus, ExternalLink, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PriveLockedError, usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";
import { AGE_TEXT, canRequest, hoursText, imageQueries, priceText, seasonText, shortDate, universeMeta } from "@/lib/priveCatalogView";
import { AddToTripDialog } from "./AddToTripDialog";
import { LabelBadge, StateBadge } from "./Badges";
import { PriveImage } from "./PriveImage";
import { RequestDialog } from "./RequestDialog";
import { PRIVE } from "./theme";

const srcUrl = (s: string | { url: string }) => (typeof s === "string" ? s : s.url);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Ficha completa: fuente, fecha de verificación, estado, etiqueta con evidencia, crédito de foto y acciones. */
export function ExperienceDetail({ e, onLocked }: { e: PriveExperience; onLocked: (code: PriveLockedError["code"]) => void }) {
  const api = usePriveCatalog();
  const [saved, setSaved] = useState(!!e.saved);
  const [reqOpen, setReqOpen] = useState(false);
  const [tripOpen, setTripOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const meta = universeMeta(e.universe);
  const season = seasonText(e);
  const toggleSave = async () => {
    try {
      const r = await api.save(e.id, !saved);
      if (r.ok) setSaved(!saved); else setNote("No se pudo guardar.");
    } catch (err) {
      if (err instanceof PriveLockedError) onLocked(err.code); else setNote("No se pudo guardar.");
    }
  };
  const sources = (e.sources ?? []).map(srcUrl);
  return (
    <article className="space-y-5" data-testid="prive-detail">
      <PriveImage queries={imageQueries(e)} illustrative={e.image?.illustrative !== false} alt={e.name} className="aspect-[16/9] rounded-2xl" />
      <header className="space-y-2">
        <p className={`text-[11px] tracking-[0.2em] ${PRIVE.gold}`}>{meta?.title} · {e.destination?.name}{e.neighborhood ? ` · ${e.neighborhood}` : ""}</p>
        <h1 className={`${PRIVE.serif} text-3xl leading-tight`}>{e.name}</h1>
        <div className="flex flex-wrap gap-2">
          <StateBadge state={e.state} verifiedAt={e.verified_at} />
          <LabelBadge e={e} withEvidence />
        </div>
      </header>
      {e.why && <p className="text-base">{e.why}</p>}
      {e.description && <p className={`text-sm ${PRIVE.muted}`}>{e.description}</p>}
      {meta?.note && <p className="rounded-xl border border-[color:var(--pv-line-strong)] p-3 text-xs text-[color:var(--pv-gold)]" role="note">{meta.note}</p>}
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div><dt className={PRIVE.muted}>Precio</dt><dd>{priceText(e)}{e.price_note ? <span className={`block text-xs ${PRIVE.muted}`}>{e.price_note}</span> : null}</dd></div>
        <div><dt className={PRIVE.muted}>Horario</dt><dd>{hoursText(e)}</dd></div>
        <div><dt className={PRIVE.muted}>Edad</dt><dd>{AGE_TEXT[e.age_policy ?? "todas"] ?? e.age_policy}</dd></div>
        {e.dress_code && <div><dt className={PRIVE.muted}>Dress code</dt><dd>{e.dress_code}</dd></div>}
        <div><dt className={PRIVE.muted}>Disponibilidad</dt><dd>{e.availability?.state === "disponible" && e.availability.checked_at ? `Consultada el ${shortDate(e.availability.checked_at)}` : "Disponibilidad no consultada"}</dd></div>
        {season && <div><dt className={PRIVE.muted}>Temporada</dt><dd className="text-amber-300">{season}</dd></div>}
        {e.address && <div className="sm:col-span-2"><dt className={PRIVE.muted}>Dirección</dt><dd>{e.address}</dd></div>}
        {e.restrictions && <div className="sm:col-span-2"><dt className={PRIVE.muted}>Restricciones</dt><dd>{e.restrictions}</dd></div>}
        {e.safety && <div className="sm:col-span-2"><dt className={PRIVE.muted}>Seguridad</dt><dd>{e.safety}</dd></div>}
        {e.license?.authority && <div className="sm:col-span-2"><dt className={PRIVE.muted}>Licencia</dt><dd>{e.license.authority}{e.license.ref ? ` · ${e.license.ref}` : ""}</dd></div>}
        {e.booking_policy && <div className="sm:col-span-2"><dt className={PRIVE.muted}>Reserva</dt><dd>{e.booking_policy}</dd></div>}
        {e.cancellation && <div className="sm:col-span-2"><dt className={PRIVE.muted}>Cancelación</dt><dd>{e.cancellation}</dd></div>}
      </dl>
      {e.accolades?.length ? (
        <section aria-label="Reconocimientos" className="space-y-1 text-sm">
          {e.accolades.map((a) => (
            <p key={`${a.name}-${a.year}`}><a href={a.url} target="_blank" rel="noopener noreferrer" className={`${PRIVE.gold} underline-offset-2 hover:underline`}>{a.name} {a.year}</a></p>
          ))}
        </section>
      ) : null}
      <section aria-label="Fuentes" className={`text-xs ${PRIVE.muted}`}>
        <p>Fuentes{e.verified_at ? ` · revisado el ${shortDate(e.verified_at)}` : ""}:</p>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{host(u)}</a></li>)}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className={PRIVE.ghost} onClick={toggleSave} aria-pressed={saved}>
          {saved ? <BookmarkCheck className="mr-2 h-4 w-4" /> : <Bookmark className="mr-2 h-4 w-4" />}{saved ? "Guardado" : "Guardar"}
        </Button>
        {canRequest(e) && (
          <>
            <Button variant="outline" className={PRIVE.ghost} onClick={() => setTripOpen(true)}><CalendarPlus className="mr-2 h-4 w-4" />Agregar al viaje</Button>
            <Button className={PRIVE.button} onClick={() => setReqOpen(true)}><Send className="mr-2 h-4 w-4" />Solicitar con Iato</Button>
          </>
        )}
        {(e.booking_url || e.website) && (
          <a href={(e.booking_url || e.website)!} target="_blank" rel="noopener noreferrer"
             onClick={() => void api.track("external_click", { experience: e.id, surface: "city" })}
             className={`inline-flex items-center rounded-md px-4 py-2 text-sm ${PRIVE.ghost}`}>
            <ExternalLink className="mr-2 h-4 w-4" />Sitio oficial
          </a>
        )}
      </div>
      {!canRequest(e) && <p className={`text-xs ${PRIVE.muted}`}>No se puede solicitar mientras esté {e.state === "DESACTUALIZADO" ? "por verificar" : "no disponible"}.</p>}
      {note && <p className="text-xs text-amber-300" role="alert">{note}</p>}
      <p className={`text-[11px] ${PRIVE.muted}`}>Solicitar no es reservar: el equipo de IATOS lo gestiona y te avisa cuando el lugar confirme. Nada se cobra aquí.</p>
      <RequestDialog e={e} open={reqOpen} onOpenChange={setReqOpen} onLocked={onLocked} />
      <AddToTripDialog items={[{ experience_id: e.id, name: e.name }]} open={tripOpen} onOpenChange={setTripOpen}
        timeZone={e.destination?.timezone} onLocked={onLocked} />
    </article>
  );
}
