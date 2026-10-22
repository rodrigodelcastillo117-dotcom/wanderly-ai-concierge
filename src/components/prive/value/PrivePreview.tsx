// Vista previa antes del día 90 (Doc B §14): presentación atractiva, algunos destinos públicos del catálogo,
// ejemplos editoriales marcados como ejemplo, progreso real hacia la elegibilidad y la explicación. Sin
// contenido protegido, sin invitaciones inventadas, sin urgencia falsa y sin quitar nada de PRO.
// Los datos salen de prive_status (usePriveAccess) y del adelanto público prive_teaser.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ProgressRing } from "@/components/prive/ProgressRing";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { PRO_PATH } from "@/lib/functionErrors";
import { previewDestinations, trackPreview } from "@/lib/priveValueApi";
import { useValueText, type ValueLang } from "@/lib/priveValueI18n";
import { pickVaried } from "@/lib/priveValueModel";
import { BrandTitle, Chip } from "./ValueUi";

export function PrivePreview({ lang, tenureDays, requiredDays, isPro }: { lang?: ValueLang; tenureDays?: number; requiredDays?: number; isPro?: boolean } = {}) {
  const t = useValueText(lang);
  const { status } = usePriveAccess();
  const days = Math.max(0, tenureDays ?? status?.tenure_days ?? 0);
  const total = Math.max(1, requiredDays ?? status?.required_days ?? 90);
  const pro = isPro ?? status?.is_pro ?? false;
  const [dests, setDests] = useState<{ slug: string; name: string }[]>([]);
  useEffect(() => {
    void trackPreview("preview_view");
    let alive = true;
    previewDestinations().then((d) => { if (alive) setDests(pickVaried(d, 8)); });
    return () => { alive = false; };
  }, []);
  return (
    <section aria-labelledby="prive-preview" className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-8 sm:py-16" data-testid="prive-preview">
      <BrandTitle as="h1" id="prive-preview" eyebrow={t.preview.eyebrow} name={t.brand.preview.name} sub={t.preview.title} />
      <p className="max-w-2xl text-base prive-champagne">{t.preview.lead}</p>

      <div className="prive-panel grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center sm:p-8">
        {pro ? <ProgressRing value={Math.min(days, total)} total={total} /> : null}
        <div className="space-y-3">
          <p className="prive-serif text-2xl" data-testid="prive-preview-progress">{pro ? t.preview.progress(Math.min(days, total), total) : t.preview.progressNotPro}</p>
          <h2 className="pt-2 text-[11px] tracking-[0.2em] uppercase prive-gold">{t.preview.how}</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm prive-muted">{t.preview.howList.map((l) => <li key={l}>{l}</li>)}</ol>
          <p className="text-sm prive-muted">{t.preview.proKeeps}</p>
          {!pro ? <Link to={PRO_PATH} onClick={() => void trackPreview("preview_pro_click")} className="prive-btn prive-btn-gold">{t.preview.pro}</Link> : null}
        </div>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {t.preview.areas.map(([name, desc]) => (
          <li key={name} className="prive-panel space-y-2 p-5">
            <p className="prive-serif text-xl tracking-[0.04em]" lang="en">{name}</p>
            <p className="text-sm prive-muted">{desc}</p>
          </li>
        ))}
      </ul>

      {dests.length ? (
        <div className="space-y-3">
          <h2 className="prive-serif text-2xl">{t.preview.destinations}</h2>
          <ul className="flex flex-wrap gap-2">{dests.map((d) => <li key={d.slug}><Chip>{d.name}</Chip></li>)}</ul>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="prive-serif text-2xl">{t.preview.examples}</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {t.preview.exampleItems.map(([title, body]) => (
            <li key={title} className="prive-panel space-y-2 p-5">
              <Chip>{t.preview.exampleTag}</Chip>
              <p className="prive-serif text-lg">{title}</p>
              <p className="text-sm prive-muted">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
