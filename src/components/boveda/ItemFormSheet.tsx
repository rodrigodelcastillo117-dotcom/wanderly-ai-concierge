import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { COUNTRY_NAME } from "@/lib/boveda/alerts";
import { catalogCategoryForKind, getProgram, programsFor } from "@/lib/boveda/catalog";
import { prepareVaultFile, type PreparedFile } from "@/lib/boveda/files";
import { formToInput, initialForm, itemToForm, defaultTitle, type VaultForm } from "@/lib/boveda/form";
import {
  ENTRIES_LABEL, KIND_LABEL, KINDS_BY_SECTION, LIMITS, SECTION_LABEL, VAULT_SECTIONS, parseBenefitLines, validateItem,
  type VaultItem, type VaultItemInput, type VaultKind, type VaultSection,
} from "@/lib/boveda/types";
import { BenefitsBlock } from "./BenefitsBlock";
import { CaptureInputs, FILES_HINT } from "./FileTiles";
import { KindIcon } from "./KindIcon";

export type PendingFile = { id: string; prepared: PreparedFile; preview: string | null };

type Props = {
  open: boolean;
  editing: VaultItem | null;
  initialKind?: VaultKind | null;
  defaultSection: VaultSection;
  onOpenChange: (o: boolean) => void;
  onSave: (input: VaultItemInput, pending: PendingFile[], id?: string) => Promise<void>;
};

const COUNTRY_OPTIONS = Object.entries(COUNTRY_NAME).filter(([c]) => c !== "EU").sort((a, b) => a[1].localeCompare(b[1], "es"));
const VISA_COUNTRIES = [["US", "EUA"], ["CA", "Canadá"], ["GB", "Reino Unido"], ["EU", "Espacio Schengen"], ["JP", "Japón"], ["CN", "China"], ["AU", "Australia"], ["IN", "India"]] as const;

const inputCls = "w-full h-11 rounded-xl bg-input border border-border px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40";

function Field({ label, id, hint, children, half }: { label: string; id: string; hint?: string; children: React.ReactNode; half?: boolean }) {
  return (
    <div className={half ? "col-span-1 min-w-0" : "col-span-2"}>
      <label htmlFor={id} className="block text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function KindPicker({ onPick, section }: { onPick: (k: VaultKind) => void; section: VaultSection }) {
  const [tab, setTab] = useState<VaultSection>(section);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-surface p-1" role="tablist" aria-label="Sección">
        {VAULT_SECTIONS.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
            className={`h-9 rounded-lg text-[12px] font-medium transition ${tab === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {SECTION_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(KINDS_BY_SECTION[tab] as readonly VaultKind[]).map((k) => (
          <button key={k} type="button" onClick={() => onPick(k)}
            className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-surface px-3 py-3 text-left text-sm hover:border-primary/60 transition">
            <span className="w-8 h-8 rounded-lg bg-primary/10 grid place-items-center shrink-0"><KindIcon kind={k} className="w-4 h-4 text-primary" aria-hidden="true" /></span>
            <span className="leading-tight">{KIND_LABEL[k]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ItemFormSheet({ open, editing, initialKind = null, defaultSection, onOpenChange, onSave }: Props) {
  const isMobile = useIsMobile();
  const [kind, setKind] = useState<VaultKind | null>(null);
  const [form, setForm] = useState<VaultForm>(initialForm("pasaporte"));
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) { setKind(editing.kind); setForm(itemToForm(editing)); } else { setKind(initialKind); if (initialKind) setForm(initialForm(initialKind)); }
    setPending([]);
  }, [open, editing, initialKind]);

  // Las vistas previas usan la foto YA limpia; se liberan al cerrar.
  const previews = useRef<string[]>([]);
  useEffect(() => {
    if (open) return;
    previews.current.forEach((u) => URL.revokeObjectURL(u));
    previews.current = [];
  }, [open]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const set = <K extends keyof VaultForm>(k: K, v: VaultForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pick = (k: VaultKind) => { setKind(k); setForm(initialForm(k)); };

  const category = kind ? catalogCategoryForKind(kind) : null;
  const programs = useMemo(() => (category ? programsFor(category) : []), [category]);
  const program = getProgram(form.program_id);
  const section = kind ? (VAULT_SECTIONS.find((s) => (KINDS_BY_SECTION[s] as readonly string[]).includes(kind)) as VaultSection) : defaultSection;
  const isDoc = section === "documento";
  const isCard = section === "tarjeta";
  const isInsurance = section === "seguro";
  const isMembership = section === "membresia";

  const addFiles = async (files: File[]) => {
    const room = LIMITS.filesPerItem - pending.length;
    setPreparing(true);
    const next: PendingFile[] = [];
    for (const f of files.slice(0, Math.max(0, room))) {
      try {
        const prepared = await prepareVaultFile(f);
        const preview = prepared.kind === "image" ? URL.createObjectURL(prepared.blob) : null;
        if (preview) previews.current.push(preview);
        next.push({ id: `${Date.now()}-${Math.random()}`, prepared, preview });
      } catch (e) {
        toast.error((e as Error).message || "No pudimos usar ese archivo.");
      }
    }
    if (files.length > room) toast.info(`Máximo ${LIMITS.filesPerItem} archivos por elemento.`);
    setPending((p) => [...p, ...next]);
    setPreparing(false);
  };

  const submit = async () => {
    if (!kind) return;
    const input = formToInput(kind, form);
    if (editing && editing.benefits_unverified) {
      input.benefits_unverified = editing.benefits.join("\n") === parseBenefitLines(form.benefitsText).join("\n");
    }
    const problem = validateItem(input);
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      await onSave(input, pending, editing?.id);
    } finally {
      setSaving(false);
    }
  };

  const titlePlaceholder = kind ? defaultTitle(kind, form) : "";
  const numberLabel = isCard ? "Últimos 4 dígitos" : kind === "pasaporte" ? "Número de pasaporte" : kind === "viajero_confiable" ? "Número (KTN / PASSID)"
    : kind === "ine" ? "Clave de elector o CIC" : isInsurance ? "Número de póliza" : isMembership ? "Número de socio" : "Número";

  const photoSection = !editing && (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{isDoc ? "Foto del documento" : "Foto o PDF (opcional)"}</p>
      {pending.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {pending.map((p) => (
            <div key={p.id} className="relative rounded-xl overflow-hidden border border-border/60 bg-surface aspect-[4/3] grid place-items-center">
              {p.preview ? <img src={p.preview} alt="Vista previa sin metadatos" className="w-full h-full object-cover" /> : <span className="text-xs text-muted-foreground">PDF</span>}
              <button type="button" aria-label="Quitar archivo" onClick={() => setPending((l) => l.filter((x) => x.id !== p.id))}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white grid place-items-center"><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      )}
      {pending.length < LIMITS.filesPerItem && <CaptureInputs onFiles={(f) => void addFiles(f)} disabled={preparing} compact />}
      {preparing && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Quitando datos ocultos de la foto…</p>}
      <p className="text-[11px] text-muted-foreground leading-relaxed">{FILES_HINT}</p>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={isMobile ? "bottom" : "right"} onOpenAutoFocus={(e) => { if (isMobile) e.preventDefault(); }}
        className={`${isMobile ? "max-h-[94dvh] rounded-t-3xl" : "w-full sm:max-w-lg"} overflow-y-auto border-border/60 bg-background p-0`}>
        <div className="p-4 sm:p-5 space-y-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
          <SheetHeader className="text-left space-y-1 pr-8">
            <div className="flex items-center gap-2">
              {kind && !editing && (
                <button type="button" onClick={() => setKind(null)} aria-label="Elegir otro tipo" className="-ml-1 w-8 h-8 rounded-full grid place-items-center hover:bg-surface">
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
              <SheetTitle className="font-display text-xl">{editing ? "Editar" : kind ? KIND_LABEL[kind] : "Agregar a Documentos y tarjetas"}</SheetTitle>
            </div>
            <SheetDescription className="text-xs flex items-center gap-1.5">
              <Lock className="w-3 h-3" aria-hidden="true" /> Privado: solo tú lo ves. No se comparte con la IA.
            </SheetDescription>
          </SheetHeader>

          {!kind ? <KindPicker onPick={pick} section={defaultSection} /> : (
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              {isDoc && photoSection}
              {category && programs.length > 0 && (
                <Field id="vf-program" label={isCard ? "Tarjeta o banco" : "Programa"}>
                  <select id="vf-program" className={inputCls} value={form.program_id}
                    onChange={(e) => {
                      const p = getProgram(e.target.value);
                      // Programa con un solo nivel (The Platinum Card: "Titular"): se elige solo. Antes quedaba
                      // sin nivel y la tarjeta se guardaba sin sus beneficios verificados (auditoría 10/10, P2-5).
                      const only = p && p.tiers.length === 1 ? p.tiers[0] : null;
                      setForm((f) => ({ ...f, program_id: e.target.value, tier_id: only?.id ?? "", tier: only?.name ?? "", title: p ? p.name : f.title }));
                    }}>
                    <option value="">Otro (escríbelo)</option>
                    {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field id="vf-title" label={isCard ? "Nombre de la tarjeta" : isInsurance ? "Plan o póliza" : "Nombre"}>
                  <input id="vf-title" className={inputCls} value={form.title} maxLength={LIMITS.title} placeholder={titlePlaceholder}
                    onChange={(e) => set("title", e.target.value)} />
                </Field>

                {(isCard || isInsurance || kind === "licencia" || kind === "vacuna" || kind === "otro_documento" || kind === "otra_membresia") && (
                  <Field id="vf-issuer" label={isCard ? "Banco" : isInsurance ? "Aseguradora" : kind === "licencia" ? "Estado o país que la emite" : "Emisor"}>
                    <input id="vf-issuer" className={inputCls} value={form.issuer} maxLength={LIMITS.issuer} onChange={(e) => set("issuer", e.target.value)} />
                  </Field>
                )}

                {(kind === "pasaporte") && (
                  <Field id="vf-country" label="País emisor">
                    <select id="vf-country" className={inputCls} value={form.country_code} onChange={(e) => set("country_code", e.target.value)}>
                      {COUNTRY_OPTIONS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </Field>
                )}
                {(kind === "visa" || kind === "autorizacion") && (
                  <Field id="vf-country" label="Para viajar a">
                    <select id="vf-country" className={inputCls} value={form.country_code} onChange={(e) => set("country_code", e.target.value)}>
                      {VISA_COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                      {COUNTRY_OPTIONS.filter(([c]) => !VISA_COUNTRIES.some(([v]) => v === c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </Field>
                )}
                {kind === "visa" && (
                  <>
                    <Field id="vf-visatype" label="Tipo" half>
                      <input id="vf-visatype" className={inputCls} value={form.visa_type} maxLength={LIMITS.visaType} placeholder="B1/B2 turista, Schengen C…"
                        onChange={(e) => set("visa_type", e.target.value)} />
                    </Field>
                    <Field id="vf-entries" label="Entradas" half>
                      <select id="vf-entries" className={inputCls} value={form.entries} onChange={(e) => set("entries", e.target.value as VaultForm["entries"])}>
                        <option value="">—</option>
                        {(Object.keys(ENTRIES_LABEL) as (keyof typeof ENTRIES_LABEL)[]).map((k) => <option key={k} value={k}>{ENTRIES_LABEL[k]}</option>)}
                      </select>
                    </Field>
                  </>
                )}

                {(isMembership || isCard) && (
                  <>
                    {program && program.tiers.length > 0 && (
                      <Field id="vf-tierid" label="Nivel">
                        <select id="vf-tierid" className={inputCls} value={form.tier_id}
                          onChange={(e) => {
                            const t = program.tiers.find((x) => x.id === e.target.value);
                            setForm((f) => ({ ...f, tier_id: e.target.value, tier: t ? t.name : f.tier }));
                          }}>
                          <option value="">Elige tu nivel</option>
                          {program.tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                      </Field>
                    )}
                    {(!program || !program.tiers.length || program.note) && (
                      <Field id="vf-tier" label={program && program.tiers.length ? "Tu nivel, como aparece en tu cuenta" : "Nivel"}>
                        <input id="vf-tier" className={inputCls} value={form.tier} maxLength={LIMITS.tier} placeholder="Gold, Platino, Prestige…"
                          onChange={(e) => set("tier", e.target.value)} />
                      </Field>
                    )}
                  </>
                )}

                <Field id="vf-number" label={numberLabel}
                  hint={isCard ? "Nunca guardamos el número completo, el CVV ni la fecha de vencimiento de tus tarjetas." : "Se muestra oculto (••••1234) hasta que toques «mostrar»."}>
                  <input id="vf-number" className={`${inputCls} font-mono tracking-wider`} value={form.number}
                    maxLength={isCard ? 4 : LIMITS.number} inputMode={isCard ? "numeric" : "text"} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                    onChange={(e) => set("number", isCard ? e.target.value.replace(/\D/g, "").slice(0, 4) : e.target.value)} />
                </Field>

                {(isDoc && kind !== "vacuna") && (
                  <Field id="vf-holder" label="Titular">
                    <input id="vf-holder" className={inputCls} value={form.holder_name} maxLength={LIMITS.holder} placeholder="Como aparece en el documento"
                      autoComplete="off" onChange={(e) => set("holder_name", e.target.value)} />
                  </Field>
                )}

                {isInsurance && (
                  <Field id="vf-phone" label="Teléfono de asistencia">
                    <input id="vf-phone" className={inputCls} value={form.contact_phone} inputMode="tel" placeholder="+52 55 1234 5678"
                      onChange={(e) => set("contact_phone", e.target.value)} />
                  </Field>
                )}

                {!isCard && (
                  <>
                    {(isDoc || isInsurance) && (
                      <Field id="vf-from" half label={isInsurance ? "Vigente desde" : kind === "vacuna" ? "Aplicación" : "Expedición"}>
                        <input id="vf-from" type="date" className={inputCls} value={form.valid_from} onChange={(e) => set("valid_from", e.target.value)} />
                      </Field>
                    )}
                    <Field id="vf-exp" half={isDoc || isInsurance} label={isMembership ? "Vigencia del nivel o membresía" : "Vence"}>
                      <input id="vf-exp" type="date" className={inputCls} value={form.expires_on} onChange={(e) => set("expires_on", e.target.value)} />
                    </Field>
                  </>
                )}
              </div>

              {!isDoc && (
                <div className="space-y-3">
                  <BenefitsBlock item={{ program_id: form.program_id || null, tier_id: form.tier_id || null, benefits: [], benefits_unverified: false }} />
                  <Field id="vf-benefits" label={isInsurance ? "Coberturas (una por línea)" : "Tus beneficios (uno por línea)"}
                    hint="Escríbelos tal como vienen en tu programa o póliza; Iato solo usará lo que esté aquí o en la lista verificada.">
                    <textarea id="vf-benefits" rows={3} className={`${inputCls} h-auto py-2.5 leading-relaxed`} value={form.benefitsText}
                      placeholder={isInsurance ? "Gastos médicos USD 100,000\nCancelación de viaje" : "Upgrade sujeto a disponibilidad\nSala VIP con 1 invitado"}
                      onChange={(e) => set("benefitsText", e.target.value)} />
                  </Field>
                </div>
              )}

              {!isDoc && photoSection}

              <Field id="vf-notes" label="Notas">
                <textarea id="vf-notes" rows={2} className={`${inputCls} h-auto py-2.5`} value={form.notes} maxLength={LIMITS.notes}
                  onChange={(e) => set("notes", e.target.value)} />
              </Field>

              <div className="sticky bottom-0 -mx-4 sm:-mx-5 px-4 sm:px-5 pt-3 pb-1 bg-gradient-to-t from-background via-background to-transparent">
                <Button type="submit" disabled={saving || preparing} className="w-full h-12 rounded-xl bg-gradient-gold text-primary-foreground hover:opacity-90 font-semibold">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : editing ? "Guardar cambios" : "Guardar"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
