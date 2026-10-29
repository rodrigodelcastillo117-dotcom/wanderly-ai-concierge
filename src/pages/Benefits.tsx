import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Download, Lock, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { AlertsPanel } from "@/components/boveda/AlertsPanel";
import { ItemDetailSheet } from "@/components/boveda/ItemDetailSheet";
import { ItemFormSheet, type PendingFile } from "@/components/boveda/ItemFormSheet";
import { KindIcon } from "@/components/boveda/KindIcon";
import { PartnerOffers } from "@/components/boveda/PartnerOffers";
import { SummarySheet } from "@/components/boveda/SummarySheet";
import { WalletCard } from "@/components/boveda/WalletCard";
import { buildAlerts, type TripLite } from "@/lib/boveda/alerts";
import { deleteFile, deleteItem, listUpcomingTrips, listVault, saveItem, uploadFile, uploadPrepared } from "@/lib/boveda/api";
import { defaultSide } from "@/lib/boveda/files";
import { filterAndSort, type SortKey } from "@/lib/boveda/organize";
import {
  KIND_LABEL, LIMITS, SECTION_LABEL, VAULT_SECTIONS, type VaultFile, type VaultItem, type VaultItemInput, type VaultKind, type VaultSection,
} from "@/lib/boveda/types";
import { IatoName } from "@/lib/iatoMark";

const TAB_KEY = "iatos.boveda.tab";
const REVEAL_MS = 30_000;
/** En móvil las tarjetas se apilan como en una cartera: de cada una se ve la franja superior. */
const STACK_OVERLAP = "-mt-[120px] md:mt-0";

const readTab = (): VaultSection => {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return (VAULT_SECTIONS as readonly string[]).includes(v ?? "") ? (v as VaultSection) : "documento";
  } catch { return "documento"; }
};

const EMPTY: Record<VaultSection, { title: string; body: string; kinds: VaultKind[] }> = {
  documento: { title: "Tus documentos, siempre contigo", body: "Pasaporte, visas, INE, licencia o certificados de vacunación. Tómales foto y tenlos a la mano.", kinds: ["pasaporte", "visa", "ine"] },
  membresia: { title: "Todas tus membresías en un lugar", body: "Aerolíneas, hoteles, renta de autos, cruceros, salas VIP y viajero confiable, con los beneficios de cada nivel.", kinds: ["aerolinea", "hotel", "sala"] },
  tarjeta: { title: "Los beneficios de tus tarjetas", body: "Solo el nombre, el nivel y los últimos 4 dígitos. Nunca el número completo, CVV ni vencimiento.", kinds: ["tarjeta"] },
  seguro: { title: "Tu póliza cuando la necesites", body: "Número de póliza, teléfono de asistencia, coberturas y el PDF, listos para una emergencia.", kinds: ["seguro_viaje", "seguro_medico"] },
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

const errorMessage = (e: unknown, fallback: string) => {
  // Los errores de preparación del archivo traen un mensaje para la persona; los de red/servidor no.
  const err = e as { message?: string; statusCode?: unknown; code?: unknown };
  return err?.message && err.statusCode === undefined && err.code === undefined ? err.message : fallback;
};

const Benefits = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [trips, setTrips] = useState<TripLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [tab, setTabState] = useState<VaultSection>(readTab);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("vence");
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<VaultKind | null>(null);
  const [editing, setEditing] = useState<VaultItem | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const timers = useRef<Map<string, number>>(new Map());

  const setTab = (t: VaultSection) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* sin almacenamiento */ } };

  // Los viajes solo alimentan las alertas: si fallan, la bóveda se muestra igual.
  const load = useCallback(async () => {
    try {
      const [v, t] = await Promise.all([listVault(), listUpcomingTrips().catch(() => [] as TripLite[])]);
      setItems(v.items); setFiles(v.files); setUnavailable(v.unavailable); setTrips(t);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const userId = user?.id;
  useEffect(() => { if (userId) void load(); }, [userId, load]);

  // Al salir de la pestaña todo vuelve a ocultarse.
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") setRevealed(new Set()); };
    document.addEventListener("visibilitychange", hide);
    const map = timers.current;
    return () => { document.removeEventListener("visibilitychange", hide); map.forEach((id) => window.clearTimeout(id)); };
  }, []);

  const toggleReveal = (id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    const old = timers.current.get(id);
    if (old) window.clearTimeout(old);
    timers.current.set(id, window.setTimeout(() => setRevealed((p) => { const n = new Set(p); n.delete(id); return n; }), REVEAL_MS));
  };

  const copy = async (item: VaultItem) => {
    if (!item.number) return;
    if (await copyText(item.number)) toast.success(`Número de ${item.title} copiado`);
    else toast.error("No pudimos copiar el número.");
  };

  const counts = useMemo(() => Object.fromEntries(VAULT_SECTIONS.map((s) => [s, items.filter((i) => i.section === s).length])) as Record<VaultSection, number>, [items]);
  const visible = useMemo(() => filterAndSort(items.filter((i) => i.section === tab), query, sort), [items, tab, query, sort]);
  const alerts = useMemo(() => buildAlerts(items, trips), [items, trips]);
  const detail = items.find((i) => i.id === detailId) ?? null;
  const filesOf = (id: string) => files.filter((f) => f.item_id === id);

  const openNew = (kind: VaultKind | null = null) => { setEditing(null); setFormKind(kind); setFormOpen(true); };

  const onSave = async (input: VaultItemInput, pending: PendingFile[], id?: string) => {
    if (!user) return;
    let saved: VaultItem;
    try {
      saved = await saveItem(input, id);
    } catch {
      toast.error("No pudimos guardar. Revisa los datos e intenta de nuevo.");
      return;
    }
    let failed = 0;
    const sides = filesOf(saved.id).map((f) => f.side);
    for (const p of pending) {
      try {
        const side = defaultSide(p.prepared.kind, sides);
        sides.push(side);
        await uploadPrepared(user.id, saved.id, p.prepared, side);
      } catch { failed++; }
    }
    if (failed) toast.error(`Guardado, pero ${failed} archivo${failed === 1 ? "" : "s"} no se pudo subir.`);
    else toast.success(id ? "Cambios guardados" : "Guardado en Documentos y tarjetas");
    setFormOpen(false);
    setEditing(null);
    if (saved.section !== tab) setTab(saved.section);
    await load();
    if (!id) setDetailId(saved.id);
  };

  const onAddFiles = async (list: File[]) => {
    if (!user || !detail) return;
    const sides = filesOf(detail.id).map((f) => f.side);
    const room = LIMITS.filesPerItem - sides.length;
    setUploading(true);
    for (const f of list.slice(0, Math.max(0, room))) {
      try {
        const side = defaultSide(f.type === "application/pdf" ? "pdf" : "image", sides);
        sides.push(side);
        await uploadFile(user.id, detail.id, f, side);
      } catch (e) {
        toast.error(errorMessage(e, "No pudimos subir el archivo."));
      }
    }
    if (list.length > room) toast.info(`Máximo ${LIMITS.filesPerItem} archivos por elemento.`);
    setUploading(false);
    await load();
  };

  const onDeleteFile = async (f: VaultFile) => {
    try { await deleteFile(f); setFiles((l) => l.filter((x) => x.id !== f.id)); toast.success("Archivo borrado"); }
    catch { toast.error("No pudimos borrar el archivo."); }
  };

  const onDelete = async () => {
    if (!detail) return;
    try {
      await deleteItem(detail, files);
      setDetailId(null);
      setItems((l) => l.filter((x) => x.id !== detail.id));
      setFiles((l) => l.filter((x) => x.item_id !== detail.id));
      toast.success("Borrado de Documentos y tarjetas");
    } catch { toast.error("No pudimos borrarlo. Intenta de nuevo."); }
  };

  // Copia de lo que escribió la persona (con números: la pide ella). Sin fotos ni PDF.
  const exportJson = () => {
    const data = {
      exportado: new Date().toISOString(),
      nota: "Copia de tus documentos y tarjetas en IATOS. Incluye números: guárdala en un lugar seguro. Las fotos y PDF no se incluyen.",
      elementos: items.map(({ user_id: _omit, ...rest }) => rest),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "iatos-boveda.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto px-4 md:px-8 pt-4 md:pt-8 pb-10 space-y-4 md:space-y-5">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-primary flex items-center gap-1.5"><Lock className="w-3 h-3" aria-hidden="true" /> Documentos y tarjetas · privado</p>
            <h1 className="font-display text-[27px] md:text-[40px] leading-[1.05] mt-1">Todo tu viaje, a la mano</h1>
            <p className="hidden sm:block text-[13px] text-muted-foreground mt-1">Documentos, membresías, tarjetas y seguros, con sus beneficios. Solo tú lo ves.</p>
          </div>
          <div className="grid grid-cols-2 md:flex gap-2">
            <Button variant="outline" onClick={() => setSummaryOpen(true)} aria-label="Iato, resúmeme" className="h-11 rounded-xl border-primary/40 hover:bg-primary/10">
              <Sparkles className="w-4 h-4 mr-2 text-primary" aria-hidden="true" /> <span><IatoName />, resúmeme</span>
            </Button>
            <Button onClick={() => openNew()} className="h-11 rounded-xl bg-gradient-gold text-primary-foreground hover:opacity-90 font-semibold">
              <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Agregar
            </Button>
          </div>
        </header>

        <AlertsPanel alerts={alerts} onOpenItem={(id) => setDetailId(id)} />

        <div className="grid grid-cols-4 gap-1 rounded-2xl bg-surface/80 border border-border/60 p-1" role="tablist" aria-label="Secciones de Documentos y tarjetas">
          {VAULT_SECTIONS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={tab === s} onClick={() => setTab(s)}
              className={`h-10 rounded-xl text-[12px] sm:text-[13px] font-medium transition flex items-center justify-center gap-1 ${tab === s ? "bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_hsl(41_47%_59%/.7)]" : "text-muted-foreground hover:text-foreground"}`}>
              <span>{SECTION_LABEL[s]}</span>
              {counts[s] > 0 && <span className="hidden sm:inline text-[10px] tabular-nums opacity-70">{counts[s]}</span>}
            </button>
          ))}
        </div>

        {(items.length > 3 || query) && (
          <div className="flex gap-2">
            <label className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar" aria-label="Buscar en tus documentos y tarjetas" type="search"
                className="w-full h-10 rounded-xl bg-surface border border-border/60 pl-9 pr-3 text-sm focus:outline-none focus:border-primary/60" />
            </label>
            <label className="relative">
              <ArrowDownUp className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar"
                className="h-10 rounded-xl bg-surface border border-border/60 pl-8 pr-3 text-sm appearance-none">
                <option value="vence">Vence primero</option>
                <option value="nombre">A–Z</option>
                <option value="recientes">Recientes</option>
              </select>
            </label>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className={`relative h-[212px] rounded-[22px] bg-surface border border-border/40 animate-pulse ${i ? STACK_OVERLAP : ""}`} />)}
          </div>
        ) : unavailable ? (
          <p className="text-sm text-muted-foreground rounded-2xl border border-border/60 p-4">Documentos y tarjetas todavía no está disponible en este ambiente.</p>
        ) : visible.length === 0 ? (
          query ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nada coincide con «{query}» en {SECTION_LABEL[tab].toLowerCase()}.</p>
          ) : (
            <div className="rounded-[22px] border border-dashed border-primary/30 bg-[radial-gradient(120%_100%_at_0%_0%,hsl(41_47%_59%/.10),transparent_60%)] p-5 md:p-7">
              <h2 className="font-display text-xl md:text-2xl">{EMPTY[tab].title}</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">{EMPTY[tab].body}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {EMPTY[tab].kinds.map((k) => (
                  <Button key={k} variant="outline" onClick={() => openNew(k)} className="h-10 rounded-xl border-border hover:border-primary/50">
                    <KindIcon kind={k} className="w-4 h-4 mr-2 text-primary" aria-hidden="true" /> {KIND_LABEL[k]}
                  </Button>
                ))}
              </div>
            </div>
          )
        ) : (
          <ul className="flex flex-col md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-4" aria-label={SECTION_LABEL[tab]}>
            {visible.map((item, i) => {
              const own = filesOf(item.id);
              return (
                <li key={item.id} className={`relative ${i ? STACK_OVERLAP : ""}`} style={{ zIndex: i + 1 }}>
                  <WalletCard item={item} revealed={revealed.has(item.id)} filesCount={own.length} hasPdf={own.some((f) => f.mime === "application/pdf")}
                    onOpen={() => setDetailId(item.id)} onToggleReveal={() => toggleReveal(item.id)} onCopy={() => void copy(item)} />
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
          <p className="flex items-start gap-1.5"><Lock className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
            <span>Números ocultos por defecto y fotos protegidas. Tus documentos y números nunca se envían a la IA: para resúmenes y promociones, <IatoName /> solo usa el nombre, el nivel y los beneficios de tus membresías, tarjetas y seguros.</span></p>
          {items.length > 0 && (
            <button type="button" onClick={exportJson} className="inline-flex items-center gap-1 hover:text-foreground self-start sm:self-auto">
              <Download className="w-3 h-3" aria-hidden="true" /> Descargar una copia de mis documentos y tarjetas
            </button>
          )}
        </div>

        <PartnerOffers />
      </div>

      <ItemDetailSheet item={detail} files={files} revealed={detail ? revealed.has(detail.id) : false} uploading={uploading}
        onOpenChange={(o) => { if (!o) setDetailId(null); }}
        onToggleReveal={() => detail && toggleReveal(detail.id)} onCopy={() => detail && void copy(detail)}
        onEdit={() => { if (detail) { setEditing(detail); setDetailId(null); setFormOpen(true); } }}
        onDelete={onDelete} onAddFiles={(l) => void onAddFiles(l)} onDeleteFile={(f) => void onDeleteFile(f)} />

      <ItemFormSheet open={formOpen} editing={editing} initialKind={formKind} defaultSection={tab}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }} onSave={onSave} />

      <SummarySheet open={summaryOpen} onOpenChange={setSummaryOpen} items={items} trips={trips} />
    </DashboardLayout>
  );
};

export default Benefits;
