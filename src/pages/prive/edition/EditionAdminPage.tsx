// Panel editorial de THE PRIVATE EDITION (/dashboard/admin/edicion). Solo admins (public.admins): el servidor
// lo exige en cada RPC (edition_admin_*); esta pantalla solo lo refleja. Aquí el responsable editorial revisa
// candidatos, ve fuentes, edita, aprueba, rechaza, programa, publica, corrige, retira y gestiona licencias.
// "Vista previa" = modo demostración: muestra el número tal como lo verá el miembro, marcado como no publicado.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Eye, Loader2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { ArticleView } from "@/components/prive/edition/Magazine";
import { IssueView } from "./LatestIssuePage";
import { DEFAULT_PREFS, formatDate, txt, type Block, type EditionArticle, type IssuePayload } from "@/lib/priveEdition";
import { createEditionAdminApi, describeCheck, EditionError, type AdminOverview } from "@/lib/priveEditionApi";
import { editionText } from "@/lib/priveEditionI18n";
import "@/components/prive/prive.css";
import "@/components/prive/edition/edition.css";
import { invalidateEditionSection } from "@/components/prive/edition/PrivateEditionTeaser";

const TABS = [
  { key: "revision", label: "Revisión" }, { key: "numero", label: "Número" }, { key: "fuentes", label: "Fuentes" },
  { key: "imagenes", label: "Imágenes y licencias" }, { key: "bitacora", label: "Bitácora y costos" }, { key: "preview", label: "Vista previa (demo)" },
] as const;
const STATUS: Record<string, string> = {
  draft: "Borrador", pending_review: "En revisión", approved: "Aprobado", rejected: "Rechazado", scheduled: "Programado", published: "Publicado", retracted: "Retirado",
};
const statusClass = (s?: string) => s === "published" ? "bg-emerald-900/50 text-emerald-200" : s === "approved" || s === "scheduled" ? "bg-sky-900/50 text-sky-200"
  : s === "rejected" || s === "retracted" ? "bg-red-900/40 text-red-200" : "bg-amber-900/40 text-amber-200";

function Pill({ s }: { s?: string }) {
  return <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${statusClass(s)}`}>{STATUS[s ?? ""] ?? s}</span>;
}

export default function EditionAdminPage() {
  const api = useMemo(() => createEditionAdminApi(), []);
  const [params, setParams] = useSearchParams();
  const tab = (params.get("vista") ?? "revision") as (typeof TABS)[number]["key"];
  const [data, setData] = useState<AdminOverview | null>(null);
  const [preview, setPreview] = useState<IssuePayload | null>(null);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const selected = params.get("a");
  const go = (vista: string, a?: string | null) => { const p = new URLSearchParams({ vista }); if (a) p.set("a", a); setParams(p); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, p] = await Promise.all([api.overview(), api.preview(null)]);
      setData(o); setPreview(p); setDenied(false);
    } catch (e) {
      if (e instanceof EditionError && e.code === "EDITION_NOT_ADMIN") setDenied(true);
      else setMsg({ ok: false, text: "No se pudo cargar el panel. Revisa la conexión." });
    } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(null);
    try { await fn(); invalidateEditionSection(); setMsg({ ok: true, text: `${label}: hecho.` }); await load(); }
    catch (e) {
      const err = e as EditionError & { detail?: string };
      let detail = err.detail ?? "";
      try { const arr = JSON.parse(detail) as string[]; if (Array.isArray(arr)) detail = arr.map(describeCheck).join(" "); } catch { /* texto */ }
      setMsg({ ok: false, text: `${label}: ${err.code ?? "error"}${detail ? ` — ${detail}` : ""}` });
    } finally { setBusy(false); }
  };
  const ask = (q: string) => (typeof window !== "undefined" ? window.prompt(q) : null);

  if (denied) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto py-20 text-center space-y-3" data-testid="edition-admin-denied">
          <ShieldAlert className="h-8 w-8 mx-auto text-primary" aria-hidden="true" />
          <h1 className="font-display text-2xl">Panel editorial</h1>
          <p className="text-muted-foreground">Solo el equipo editorial (administradores) puede abrir este panel.</p>
          <Link to="/dashboard" className="inline-flex items-center rounded-xl bg-gradient-gold px-5 py-3 text-sm font-medium text-primary-foreground">Ir al inicio</Link>
        </div>
      </DashboardLayout>
    );
  }
  const article = data?.articles.find((a) => a.slug === selected);
  const previewArticle = preview?.articles?.find((a) => a.slug === selected);
  const issue = data?.issues[0];
  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6" data-testid="edition-admin">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-primary text-[11px] tracking-[0.3em] uppercase">IATOS Privé · panel editorial</p>
            <h1 className="font-display text-3xl">THE PRIVATE EDITION</h1>
            <p className="text-sm text-muted-foreground">Investigación → fuentes → borrador (IA) → verificación → revisión → maquetación → publicación. La IA redacta; tú decides.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm min-h-[44px]">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar
          </button>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-white/10" aria-label="Secciones del panel">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => go(t.key)} aria-current={tab === t.key ? "page" : undefined}
              className={`whitespace-nowrap px-3 min-h-[44px] text-sm border-b-2 ${tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>{t.label}</button>
          ))}
        </nav>
        {msg && <p role="status" className={`text-sm rounded-md px-3 py-2 ${msg.ok ? "bg-emerald-900/30 text-emerald-200" : "bg-red-900/30 text-red-200"}`}>{msg.text}</p>}
        {loading && !data ? <p className="text-muted-foreground">Cargando…</p> : !data ? null : (
          <>
            {tab === "revision" && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <ul className="space-y-2" aria-label="Piezas">
                  {data.articles.map((a) => (
                    <li key={a.slug}>
                      <button type="button" onClick={() => go("revision", a.slug)} aria-current={selected === a.slug || undefined}
                        className={`w-full text-left rounded-lg border px-3 py-2.5 ${selected === a.slug ? "border-primary bg-primary/5" : "border-white/10 bg-surface/40"}`}>
                        <span className="flex items-center gap-2 flex-wrap"><Pill s={a.status} />
                          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{a.section} · {a.format} · {a.source_count} fuentes · {a.reading_minutes} min</span>
                          {a.drafted_by === "claude" && <span className="text-[11px] text-amber-300">borrador IA</span>}
                        </span>
                        <span className="block mt-1 font-medium">{txt(a.title, "es")}</span>
                        {a.checks.blocking.length > 0 && <span className="block text-xs text-red-300 mt-1">{a.checks.blocking.length} bloqueo(s): {describeCheck(a.checks.blocking[0])}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                <div>
                  {!article ? <p className="text-muted-foreground">Elige una pieza para revisarla.</p> : (
                    <ArticleEditor key={article.slug + article.version} article={article} previewArticle={previewArticle} preview={preview} busy={busy}
                      onTransition={(action, opts) => run(`${action} ${article.slug}`, () => api.articleTransition(article.slug, action, opts))}
                      onUpdate={(patch, note) => run(`editar ${article.slug}`, () => article.status === "published" ? api.correctArticle(article.slug, patch, note ?? "") : api.updateArticle(article.slug, patch, note))}
                      ask={ask} />
                  )}
                </div>
              </div>
            )}
            {tab === "numero" && issue && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center gap-3"><Pill s={issue.status} /><h2 className="font-display text-2xl">Nº {issue.number} · {txt(issue.period_label, "es")} · «{txt(issue.title, "es")}»</h2></div>
                <Checks blocking={issue.checks.blocking} warnings={issue.checks.warnings} />
                <div className="flex flex-wrap gap-2">
                  <Btn busy={busy} onClick={() => { const l = ask("Firma editorial (p. ej. «Rodrigo del Castillo, director editorial»):"); void run("aprobar número", () => api.issueTransition(issue.slug, "approve", { label: l ?? undefined })); }}>Aprobar número</Btn>
                  <Btn busy={busy} onClick={() => { const w = ask("Fecha y hora de publicación (AAAA-MM-DDTHH:MM, hora de la Ciudad de México):"); if (w) void run("programar número", () => api.issueTransition(issue.slug, "schedule", { when: new Date(`${w}:00-06:00`).toISOString() })); }}>Programar</Btn>
                  <Btn busy={busy} onClick={() => void run("publicar número", () => api.issueTransition(issue.slug, "publish"))}>Publicar ahora</Btn>
                  <Btn busy={busy} danger onClick={() => { const n = ask("Motivo público del retiro del número:"); if (n) void run("retirar número", () => api.issueTransition(issue.slug, "retract", { note: n })); }}>Retirar</Btn>
                  <Btn busy={busy} onClick={() => void run("volver a revisión", () => api.issueTransition(issue.slug, "return_to_review"))}>Volver a revisión</Btn>
                </div>
                <p className="text-sm text-muted-foreground">Publicar el número publica solo las piezas APROBADAS; el resto sigue invisible para los miembros.</p>
                {issue.plan && <details className="rounded-lg border border-white/10 p-3"><summary className="cursor-pointer text-sm">Plan editorial</summary>
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground mt-2">{JSON.stringify(issue.plan, null, 2)}</pre></details>}
              </section>
            )}
            {tab === "fuentes" && (
              <section className="space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <Btn busy={busy} onClick={() => void run("comprobar enlaces", async () => { const r = await api.checkLinks(); if (!r) throw new EditionError("LINK_CHECK_UNAVAILABLE"); })}>Comprobar enlaces (función edition-link-check)</Btn>
                  <span className="text-xs text-muted-foreground">{data.sources.filter((s) => s.link_status === "broken").length} rotas · {data.sources.filter((s) => s.link_status === "unchecked").length} sin comprobar</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground">
                    <th className="p-2">Fuente</th><th className="p-2">Tipo</th><th className="p-2">Publicada / consultada</th><th className="p-2">Derechos</th><th className="p-2">Enlace</th><th className="p-2" />
                  </tr></thead><tbody>
                    {data.sources.map((s) => (
                      <tr key={s.key} className="border-t border-white/5 align-top">
                        <td className="p-2 max-w-[22rem]"><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.entity}</a><br /><span className="text-muted-foreground">{s.title}</span><br /><span className="text-muted-foreground">Datos: {s.data_used}</span><br /><span className="text-muted-foreground">Usa: {s.used_by.join(", ")}</span></td>
                        <td className="p-2">{s.kind.replace(/_/g, " ")}</td>
                        <td className="p-2 whitespace-nowrap">{s.published_at ?? "—"}<br />{s.consulted_at}</td>
                        <td className="p-2 max-w-[16rem]">{s.reuse_rights}<br /><span className="text-muted-foreground">{s.verification}</span></td>
                        <td className="p-2"><Pill s={s.link_status === "ok" ? "published" : s.link_status === "broken" ? "rejected" : "pending_review"} /> <span className="text-muted-foreground">{s.link_status}{s.link_http ? ` ${s.link_http}` : ""}</span></td>
                        <td className="p-2 whitespace-nowrap">
                          <button type="button" className="underline mr-2" onClick={() => void run(`fuente ${s.key} ok`, () => api.markSource(s.key, "ok", 200))}>OK</button>
                          <button type="button" className="underline text-red-300" onClick={() => void run(`fuente ${s.key} rota`, () => api.markSource(s.key, "broken"))}>Rota</button>
                        </td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </section>
            )}
            {tab === "imagenes" && (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.images.map((i) => (
                  <article key={i.key} className="rounded-lg border border-white/10 overflow-hidden bg-surface/40" data-testid="admin-image">
                    <img src={i.url} alt={txt(i.alt, "es")} loading="lazy" className="w-full aspect-[16/10] object-cover" />
                    <div className="p-3 space-y-1 text-xs">
                      <p className="flex items-center gap-2"><Pill s={i.license_status === "approved" ? "published" : i.license_status === "blocked" ? "rejected" : "pending_review"} />
                        <span>{i.license_status}</span>{i.illustrative && <span className="text-amber-300">ilustrativa</span>}</p>
                      <p>{txt(i.depicts, "es")}</p>
                      <p className="text-muted-foreground">{i.photographer} · <a className="underline" href={i.page_url} target="_blank" rel="noopener noreferrer">página</a> · <a className="underline" href={i.license_url} target="_blank" rel="noopener noreferrer">{i.license}</a> · PDF {i.allow_pdf ? "sí" : "no"} · offline {i.allow_offline ? "sí" : "no"}</p>
                      <p className="text-muted-foreground">{i.verification}</p>
                      <div className="flex gap-2 pt-1">
                        {i.license_status !== "approved" && <Btn busy={busy} onClick={() => void run(`licencia ${i.key}`, () => api.imageLicense(i.key, "approve", "Licencia y crédito verificados en la página del proveedor"))}>Aprobar licencia</Btn>}
                        <Btn busy={busy} danger onClick={() => { const n = ask("Motivo del bloqueo:"); if (n) void run(`bloquear ${i.key}`, () => api.imageLicense(i.key, "block", n)); }}>Bloquear</Btn>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )}
            {tab === "bitacora" && (
              <section className="grid gap-6 lg:grid-cols-2">
                <div>
                  <h2 className="font-display text-xl mb-2">Bitácora editorial</h2>
                  <ul className="text-xs space-y-1">
                    {data.reviews.map((r, idx) => <li key={idx} className="border-b border-white/5 py-1"><span className="text-muted-foreground">{formatDate(r.at, "es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> · {r.entity} {r.key} · <strong>{r.action}</strong>{r.note ? ` — ${r.note}` : ""}{r.by_me ? " (tú)" : ""}</li>)}
                  </ul>
                </div>
                <div className="text-sm space-y-2">
                  <h2 className="font-display text-xl mb-2">Costos medidos (30 días)</h2>
                  <p>PDF descargados: {data.downloads.pdf_30d} · copias offline: {data.downloads.offline_30d}</p>
                  <p>PDF promedio: {data.downloads.avg_pdf_bytes ? `${Math.round(data.downloads.avg_pdf_bytes / 1024)} KB` : "—"} · tiempo de generación: {data.downloads.avg_pdf_ms ? `${data.downloads.avg_pdf_ms} ms` : "—"} (en el dispositivo del miembro: costo de servidor 0)</p>
                  <p className="text-muted-foreground">La revista no llama a IA por miembro: la personalización ordena la edición común en el navegador. El costo de IA es solo la redacción asistida de cada número (ver docs/iatos/prive_reimagined/EDITION.md).</p>
                </div>
              </section>
            )}
            {tab === "preview" && preview?.found && (
              <section className="-mx-4 sm:mx-0" aria-label="Vista previa">
                <div className="prive-root" style={{ minHeight: "auto" }}>
                  <div className="ped">
                    <div className="ped-banner" role="note" data-testid="preview-banner">{editionText("es").preview}<small>{editionText("es").previewSub}</small></div>
                    {previewArticle ? (
                      <>
                        <div className="px-4 py-2"><Link to="/dashboard/admin/edicion?vista=preview" className="ped-link text-sm">← Índice</Link></div>
                        <ArticleView article={previewArticle} images={preview.images ?? {}} lang="es" issue={preview.issue} preview />
                      </>
                    ) : (
                      <IssueView payload={preview} lang="es" prefs={DEFAULT_PREFS} preview hrefFor={(slug) => `/dashboard/admin/edicion?vista=preview&a=${slug}`} />
                    )}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Btn({ children, onClick, busy, danger }: { children: React.ReactNode; onClick: () => void; busy: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy}
      className={`inline-flex items-center gap-1 rounded-full border px-3 min-h-[40px] text-xs font-semibold disabled:opacity-50 ${danger ? "border-red-400/40 text-red-200" : "border-primary/40 text-foreground hover:bg-primary/10"}`}>
      {children}
    </button>
  );
}

function Checks({ blocking, warnings }: { blocking: string[]; warnings: string[] }) {
  return (
    <div className="space-y-1 text-sm" data-testid="checks">
      {blocking.length === 0 ? <p className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Sin bloqueos: se puede aprobar.</p>
        : blocking.map((b) => <p key={b} className="flex items-center gap-2 text-red-300"><XCircle className="h-4 w-4 shrink-0" />{describeCheck(b)}</p>)}
      {warnings.map((w) => <p key={w} className="text-amber-300 text-xs">· {describeCheck(w)}</p>)}
    </div>
  );
}

type AdminArticle = AdminOverview["articles"][number];
function ArticleEditor({ article, previewArticle, preview, busy, onTransition, onUpdate, ask }: {
  article: AdminArticle; previewArticle?: EditionArticle; preview: IssuePayload | null; busy: boolean;
  onTransition: (action: string, opts?: { note?: string; when?: string; label?: string }) => void;
  onUpdate: (patch: Record<string, unknown>, note?: string) => void; ask: (q: string) => string | null;
}) {
  const full = previewArticle;
  const [title, setTitle] = useState({ es: article.title.es, en: article.title.en ?? "" });
  const [dek, setDek] = useState({ es: article.dek?.es ?? "", en: article.dek?.en ?? "" });
  const [body, setBody] = useState<Block[]>(full?.body ?? []);
  const [notes, setNotes] = useState(article.editor_notes ?? "");
  // Vigencia (valid_until): después de esa fecha la pieza sale del World Brief y lleva aviso; la base no deja aprobar vencidas.
  const [validUntil, setValidUntil] = useState(article.valid_until ?? "");
  const [showPreview, setShowPreview] = useState(false);
  const published = article.status === "published";
  const setText = (i: number, l: "es" | "en", v: string) => setBody((b) => b.map((x, j) => (j === i && "es" in x ? { ...x, [l]: v } as Block : x)));
  return (
    <div className="space-y-4" data-testid="article-editor">
      <div className="flex flex-wrap items-center gap-2"><Pill s={article.status} /><span className="text-xs text-muted-foreground">v{article.version} · {article.reading_minutes} min · {article.fact_status}{article.sensitive ? " · sensible" : ""}</span></div>
      <Checks blocking={article.checks.blocking} warnings={article.checks.warnings} />
      <div className="flex flex-wrap gap-2">
        <Btn busy={busy} onClick={() => { const l = ask("Firma editorial para el crédito público:"); onTransition("approve", { label: l ?? undefined }); }}>Aprobar</Btn>
        <Btn busy={busy} danger onClick={() => { const n = ask("Motivo del rechazo:"); if (n) onTransition("reject", { note: n }); }}>Rechazar</Btn>
        <Btn busy={busy} onClick={() => { const w = ask("Programar (AAAA-MM-DDTHH:MM, hora CDMX):"); if (w) onTransition("schedule", { when: new Date(`${w}:00-06:00`).toISOString() }); }}>Programar</Btn>
        <Btn busy={busy} onClick={() => onTransition("publish")}>Publicar</Btn>
        <Btn busy={busy} danger onClick={() => { const n = ask("Nota pública del retiro:"); if (n) onTransition("retract", { note: n }); }}>Retirar</Btn>
        <Btn busy={busy} onClick={() => onTransition("return_to_review")}>Volver a revisión</Btn>
        <Btn busy={busy} onClick={() => setShowPreview((s) => !s)}><Eye className="h-3.5 w-3.5" /> {showPreview ? "Editar" : "Ver como miembro"}</Btn>
      </div>
      {showPreview && full && preview ? (
        <div className="prive-root rounded-lg overflow-hidden" style={{ minHeight: "auto" }}><div className="ped">
          <div className="ped-banner">{editionText("es").preview}</div>
          <ArticleView article={{ ...full, title, dek, body }} images={preview.images ?? {}} lang="es" issue={preview.issue} preview />
        </div></div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); const note = published ? ask("Nota PÚBLICA de corrección (obligatoria):") : (notes || undefined); if (published && !note) return;
          onUpdate({ title, dek, body, ...(published ? {} : { editor_notes: notes }), ...(validUntil !== (article.valid_until ?? "") ? { valid_until: validUntil || null } : {}) }, note ?? undefined); }}>
          {(["es", "en"] as const).map((l) => (
            <div key={l} className="grid gap-2">
              <label className="text-xs text-muted-foreground">Título ({l})<input className="w-full rounded-md bg-background border border-white/10 px-2 py-2 text-sm" value={title[l]} onChange={(e) => setTitle({ ...title, [l]: e.target.value })} /></label>
              <label className="text-xs text-muted-foreground">Entradilla ({l})<textarea className="w-full rounded-md bg-background border border-white/10 px-2 py-2 text-sm" rows={2} value={dek[l]} onChange={(e) => setDek({ ...dek, [l]: e.target.value })} /></label>
            </div>
          ))}
          <details open>
            <summary className="cursor-pointer text-sm">Cuerpo ({body.length} bloques)</summary>
            <ol className="space-y-3 mt-2">
              {body.map((b, i) => (
                <li key={i} className="rounded-md border border-white/10 p-2 text-xs">
                  <span className="text-muted-foreground uppercase">{b.t}{b.t === "note" ? ` · ${b.kind}` : ""}</span>
                  {"es" in b ? (["es", "en"] as const).map((l) => (
                    <textarea key={l} aria-label={`Bloque ${i + 1} (${l})`} className="mt-1 w-full rounded bg-background border border-white/10 px-2 py-1 text-sm" rows={l === "es" ? 3 : 2}
                      value={(b as { es: string; en?: string })[l] ?? ""} onChange={(e) => setText(i, l, e.target.value)} />
                  )) : <pre className="whitespace-pre-wrap text-muted-foreground mt-1">{JSON.stringify(b).slice(0, 400)}</pre>}
                </li>
              ))}
            </ol>
          </details>
          <label className="text-xs text-muted-foreground block">Vigente hasta (vacío = sin vencimiento)
            <input type="date" className="mt-1 block rounded-md bg-background border border-white/10 px-2 py-2 text-sm" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} data-testid="valid-until" /></label>
          {!published && <label className="text-xs text-muted-foreground block">Notas internas del editor<textarea className="w-full rounded-md bg-background border border-white/10 px-2 py-2 text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>}
          <button type="submit" disabled={busy} className="rounded-full bg-primary text-primary-foreground px-4 min-h-[44px] text-sm font-semibold disabled:opacity-50">{published ? "Publicar corrección (con nota pública)" : "Guardar cambios (vuelve a revisión si estaba aprobado)"}</button>
        </form>
      )}
      <section className="text-xs space-y-1">
        <h3 className="font-semibold text-sm">Fuentes ({full?.sources?.length ?? 0})</h3>
        {(full?.sources ?? []).map((s) => (
          <p key={s.key} className="border-t border-white/5 pt-1"><a href={s.url} className="underline" target="_blank" rel="noopener noreferrer">{s.entity}</a> — {s.title} · {s.used_for} · consultada {s.consulted_at}{s.published_at ? ` · publicada ${s.published_at}` : ""} · <span className="text-muted-foreground">{s.link_status}</span></p>
        ))}
      </section>
    </div>
  );
}
