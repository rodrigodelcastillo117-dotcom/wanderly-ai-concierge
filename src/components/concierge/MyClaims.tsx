// "Mis reclamos" (Concierge › Mis solicitudes): las cartas que Iato preparó contra una aerolínea, hotel o
// traslado. El usuario ve la carta, la copia, abre el formulario oficial y marca "ya lo envié"; si el envío
// por correo está encendido en el servidor y hay correo verificado, puede pedir "Enviar en mi nombre"
// (con su confirmación explícita en este mismo panel). Nunca se envía nada sin ese sí.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, FileText, Loader2, Mail, Scale, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NEW_CLAIM_PROMPT, OPEN_CLAIM, cancelClaim, canSendFromApp, claimKindText, claimStatusText, markClaimResolved, markClaimSentByMe,
  myClaims, sendClaim, type Claim, type ClaimsResult,
} from "@/lib/claims";
import { sentText } from "@/lib/opsDesk";

type Props = { onAskIato?: (text: string) => void };

function ClaimCard({ c, envioActivo, onChanged }: { c: Claim; envioActivo: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [ccMe, setCcMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const sendable = canSendFromApp(c, envioActivo);
  const pending = c.status === "esperando_ok";

  const run = async (fn: () => Promise<ClaimsResult<object>>, done: string) => {
    setBusy(true); setNote(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setNote((r as { message?: string }).message ?? "No se pudo completar. Inténtalo de nuevo."); return; }
    setNote(done); setConfirming(false); onChanged();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${c.subject}\n\n${c.body_text}`);
      setCopied(true); window.setTimeout(() => setCopied(false), 2500);
    } catch { setOpen(true); setNote("Selecciona el texto de la carta y cópialo."); }
  };

  return (
    <li data-testid="claim" data-status={c.status} className="rounded-2xl border border-white/10 bg-card p-4 space-y-2">
      <p className="text-primary text-[10px] tracking-[0.25em] uppercase">{claimKindText(c.kind, c.target)}</p>
      <h3 className="font-display text-base md:text-lg break-words">{c.provider_name}</h3>
      <p className="text-xs text-muted-foreground">{sentText(c.created_at).replace("Enviada", "Creada")} · Folio {c.ref_code}</p>
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight ${
        c.status === "resuelto" ? "border-primary bg-primary/15 text-primary" : OPEN_CLAIM.has(c.status) ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}`}>
        {c.status === "resuelto" ? <Check className="w-3 h-3" aria-hidden="true" /> : <Scale className="w-3 h-3" aria-hidden="true" />}
        {claimStatusText(c.status)}
      </span>

      {c.reply?.resumen_es ? (
        <p className="text-xs rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2">
          <span className="text-primary">Respuesta de {c.provider_name}:</span> {c.reply.resumen_es}
        </p>
      ) : null}

      {pending && !sendable ? (
        <p className="text-[11px] text-muted-foreground" data-testid="claim-how-to-send">
          {c.form_url
            ? `Copia la carta y pégala en el formulario oficial de ${c.provider_name}. Luego toca «Ya la envié» y te ayudamos con el seguimiento.`
            : `Copia la carta y envíala por el canal oficial de ${c.provider_name}. Luego toca «Ya la envié» y te ayudamos con el seguimiento.`}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="claim-ver-carta">
          <FileText className="w-3.5 h-3.5 mr-1" />{open ? "Ocultar carta" : "Ver carta"}
        </Button>
        <Button size="sm" variant="outline" onClick={copy} data-testid="claim-copiar">
          {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}{copied ? "Copiada" : "Copiar carta"}
        </Button>
        {c.form_url && pending ? (
          <Button size="sm" variant="outline" asChild>
            <a href={c.form_url} target="_blank" rel="noopener noreferrer" data-testid="claim-formulario">
              <ExternalLink className="w-3.5 h-3.5 mr-1" />Formulario de {c.provider_name}
            </a>
          </Button>
        ) : null}
        {sendable && !confirming ? (
          <Button size="sm" onClick={() => setConfirming(true)} data-testid="claim-enviar">
            <Mail className="w-3.5 h-3.5 mr-1" />Enviar en mi nombre
          </Button>
        ) : null}
        {pending && !sendable ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => markClaimSentByMe(c.id), "Listo: la marcamos como enviada.")} data-testid="claim-ya-envie">
            Ya la envié
          </Button>
        ) : null}
        {["enviado", "recordado", "respondido", "escalado"].includes(c.status) ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => markClaimResolved(c.id), "¡Qué bueno! La marcamos como resuelta.")} data-testid="claim-resuelto">
            Ya me resolvieron
          </Button>
        ) : null}
        {pending ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => cancelClaim(c.id), "Cancelada. No se envió nada.")} aria-label={`Cancelar reclamo ${c.ref_code}`}>
            <X className="w-3.5 h-3.5" />
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3 space-y-2" data-testid="claim-confirmar">
          <p className="text-sm">
            ¿Enviamos esta carta a <span className="text-primary">{c.provider_name}</span> ({c.recipient_email}) en tu nombre?
            Las respuestas te llegarán por IATOS.
          </p>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={ccMe} onChange={(e) => setCcMe(e.target.checked)} /> Mándame una copia a mi correo
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => sendClaim(c.id, ccMe), `Enviada a ${c.provider_name}. Te avisamos cuando respondan.`)} data-testid="claim-confirmar-si">
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}Sí, envíala
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>No, todavía no</Button>
          </div>
        </div>
      ) : null}

      {open ? (
        <div className="rounded-xl border border-white/10 bg-background/40 p-3 space-y-1" data-testid="claim-carta">
          <p className="text-xs text-muted-foreground">Asunto: <span className="text-foreground">{c.subject}</span></p>
          <p className="text-sm whitespace-pre-line select-text">{c.body_text}</p>
        </div>
      ) : null}

      {note ? <p className="text-xs text-primary" role="status">{note}</p> : null}
    </li>
  );
}

export function MyClaims({ onAskIato }: Props) {
  const [rows, setRows] = useState<Claim[] | null>(null);
  const [envioActivo, setEnvioActivo] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const r = await myClaims();
    if (!r.ok) { setError(true); return; }
    setError(false);
    setEnvioActivo(r.envio_activo === true);
    setRows(Array.isArray(r.reclamos) ? r.reclamos : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = (rows ?? []).filter((c) => c.status !== "cancelado");

  return (
    <section aria-labelledby="mis-reclamos" className="space-y-3 max-w-2xl mx-auto mt-8" data-testid="mis-reclamos">
      <div>
        <h2 id="mis-reclamos" className="font-display text-xl md:text-2xl">Mis reclamos</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          ¿Vuelo retrasado o cancelado, maleta perdida, un hotel que no cumplió? Iato revisa tus derechos, te dice qué te corresponde y escribe la carta por ti.
        </p>
      </div>
      {error ? (
        <div className="rounded-2xl border border-white/10 p-4 text-sm text-muted-foreground">
          No pudimos cargar tus reclamos. <button type="button" className="text-primary underline" onClick={() => load()}>Reintentar</button>
        </div>
      ) : rows === null ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : visible.length > 0 ? (
        <ul className="space-y-3">
          {visible.map((c) => <ClaimCard key={c.id} c={c} envioActivo={envioActivo} onChanged={() => void load()} />)}
        </ul>
      ) : null}
      {onAskIato ? (
        <Button variant="outline" size="sm" onClick={() => onAskIato(NEW_CLAIM_PROMPT)} data-testid="claim-nuevo">
          <Scale className="w-3.5 h-3.5 mr-1" />Reclamar con Iato
        </Button>
      ) : null}
    </section>
  );
}

export default MyClaims;
