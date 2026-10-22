import { useState } from "react";
import { Copy, Eye, EyeOff, Loader2, Pencil, Phone, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { COUNTRY_NAME, fmtDate } from "@/lib/boveda/alerts";
import { ENTRIES_LABEL, IDENTITY_KINDS, KIND_LABEL, type VaultFile, type VaultItem } from "@/lib/boveda/types";
import { BenefitsBlock } from "./BenefitsBlock";
import { CaptureInputs, FILES_HINT, FileTiles } from "./FileTiles";
import { WalletCard } from "./WalletCard";

type Props = {
  item: VaultItem | null;
  files: VaultFile[];
  revealed: boolean;
  uploading: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleReveal: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onAddFiles: (files: File[]) => void;
  onDeleteFile: (f: VaultFile) => void;
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border/40 last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm text-right min-w-0 break-words">{value}</dd>
    </div>
  );
}

export function ItemDetailSheet({ item, files, revealed, uploading, onOpenChange, onToggleReveal, onCopy, onEdit, onDelete, onAddFiles, onDeleteFile }: Props) {
  const isMobile = useIsMobile();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const own = item ? files.filter((f) => f.item_id === item.id) : [];
  const showBenefits = item && item.section !== "documento";
  const country = item?.country_code ? COUNTRY_NAME[item.country_code] ?? item.country_code : null;

  return (
    <Sheet open={!!item} onOpenChange={(o) => { if (!o) setConfirm(false); onOpenChange(o); }}>
      <SheetContent side={isMobile ? "bottom" : "right"} onOpenAutoFocus={(e) => e.preventDefault()}
        className={`${isMobile ? "max-h-[92dvh] rounded-t-3xl" : "w-full sm:max-w-md"} overflow-y-auto border-border/60 bg-background p-0`}>
        {item && (
          <div className="p-4 sm:p-5 space-y-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
            <SheetHeader className="text-left space-y-0.5 pr-8">
              <SheetTitle className="font-display text-xl">{item.title}</SheetTitle>
              <SheetDescription className="text-xs">{KIND_LABEL[item.kind]}{item.tier ? ` · ${item.tier}` : ""}</SheetDescription>
            </SheetHeader>

            <WalletCard item={item} revealed={revealed} filesCount={own.length} hasPdf={own.some((f) => f.mime === "application/pdf")}
              onOpen={() => undefined} onToggleReveal={onToggleReveal} onCopy={onCopy} />

            <div className="grid grid-cols-3 gap-2">
              {item.number && item.section !== "tarjeta" ? (
                <>
                  <Button variant="outline" size="sm" onClick={onToggleReveal} className="h-10">
                    {revealed ? <EyeOff className="w-4 h-4 mr-1.5" aria-hidden="true" /> : <Eye className="w-4 h-4 mr-1.5" aria-hidden="true" />}
                    {revealed ? "Ocultar" : "Mostrar"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={onCopy} className="h-10">
                    <Copy className="w-4 h-4 mr-1.5" aria-hidden="true" /> Copiar
                  </Button>
                </>
              ) : <span className="col-span-2" />}
              <Button variant="outline" size="sm" onClick={onEdit} className="h-10">
                <Pencil className="w-4 h-4 mr-1.5" aria-hidden="true" /> Editar
              </Button>
            </div>

            <dl className="rounded-2xl border border-border/60 bg-surface/60 px-3 empty:hidden">
              <Row label={item.section === "seguro" ? "Aseguradora" : item.section === "tarjeta" ? "Banco" : "Emisor"} value={item.issuer} />
              <Row label="Titular" value={item.holder_name} />
              <Row label={item.kind === "pasaporte" ? "País emisor" : "País"} value={country} />
              <Row label="Tipo de visa" value={item.visa_type} />
              <Row label="Entradas" value={item.entries ? ENTRIES_LABEL[item.entries] : null} />
              <Row label={item.section === "seguro" ? "Vigente desde" : "Expedición"} value={item.valid_from ? fmtDate(item.valid_from) : null} />
              <Row label="Vence" value={item.expires_on ? fmtDate(item.expires_on) : null} />
              <Row label="Teléfono de asistencia" value={item.contact_phone ? (
                <a href={`tel:${item.contact_phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 text-primary">
                  <Phone className="w-3.5 h-3.5" aria-hidden="true" />{item.contact_phone}
                </a>
              ) : null} />
            </dl>

            {showBenefits && (
              <section aria-labelledby="vault-benefits-h">
                <h4 id="vault-benefits-h" className="font-display text-base mb-2">{item.section === "seguro" ? "Coberturas" : "Beneficios"}</h4>
                <BenefitsBlock item={item} onAdd={onEdit} />
              </section>
            )}

            <section aria-labelledby="vault-files-h" className="space-y-2">
              <h4 id="vault-files-h" className="font-display text-base">{IDENTITY_KINDS.includes(item.kind) ? "Fotos del documento" : "Fotos y archivos"}</h4>
              <FileTiles files={own} onDelete={onDeleteFile} />
              {own.length < 6 && <CaptureInputs onFiles={onAddFiles} disabled={uploading} compact />}
              {uploading && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Limpiando y guardando…</p>}
              <p className="text-[11px] text-muted-foreground leading-relaxed">{FILES_HINT}</p>
            </section>

            {item.notes && (
              <section>
                <h4 className="font-display text-base mb-1">Notas</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.notes}</p>
              </section>
            )}

            <div className="pt-1">
              {confirm ? (
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1" onClick={() => setConfirm(false)}>Cancelar</Button>
                  <Button variant="destructive" className="flex-1" disabled={deleting}
                    onClick={async () => { setDeleting(true); try { await onDelete(); } finally { setDeleting(false); setConfirm(false); } }}>
                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : "Borrar definitivamente"}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" className="w-full text-muted-foreground hover:text-destructive" onClick={() => setConfirm(true)}>
                  <Trash2 className="w-4 h-4 mr-1.5" aria-hidden="true" /> Borrar de mi bóveda
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
