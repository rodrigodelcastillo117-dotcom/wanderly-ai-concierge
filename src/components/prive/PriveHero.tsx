import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Monogram } from "@/components/prive/Monogram";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { usePriveMotion } from "@/components/prive/motion";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { PRIVE_DESTINATION_INDEX } from "@/lib/priveDestinationIndex";
import { cachedVideo, getDestinationVideo } from "@/lib/videoSearch";
import { askIatoHref } from "@/lib/priveLinks";
import { usePriveTrip } from "@/components/prive/home/context";

/** Portadas posibles del hub: un destino emblemático por visita, con su foto (y video si se puede). */
export const PRIVE_HERO_DESTINATIONS = [
  { slug: "cdmx", es: "Ciudad de México", video: "Mexico City aerial" },
  { slug: "paris", es: "París", video: "Paris aerial Eiffel Tower" },
  { slug: "mc", es: "Mónaco", video: "Monaco harbour yachts" },
  { slug: "lago-de-como", es: "Lago de Como", video: "Lake Como" },
  { slug: "tokio", es: "Tokio", video: "Tokyo night city" },
  { slug: "los-cabos", es: "Los Cabos", video: "Los Cabos ocean" },
  { slug: "nueva-york", es: "Nueva York", video: "New York City aerial" },
  { slug: "santorini", es: "Santorini", video: "Santorini sunset" },
  { slug: "dubai", es: "Dubái", video: "Dubai skyline aerial" },
  { slug: "roma", es: "Roma", video: "Rome aerial" },
] as const;

/**
 * Una portada distinta en cada visita, sin guardar nada en el navegador (Privé no deja rastros en
 * localStorage fuera de su sesión): cambia con el minuto en que se abre el hub.
 */
export function nextHeroIndex(n = PRIVE_HERO_DESTINATIONS.length, now = Date.now()): number {
  return Math.floor(now / 60_000) % n;
}

type HeroData = { slug: string; place: string; queries: string[]; video: string | null; fromTrip: boolean };

/** Destino de portada: el del próximo viaje si está en Privé; si no, uno emblemático distinto por visita. */
function useHeroData(): HeroData {
  const lang = usePriveLang();
  const { dest } = usePriveTrip();
  const [idx] = useState(() => nextHeroIndex());
  return useMemo(() => {
    if (dest && PRIVE_DESTINATION_INDEX[dest.slug]) {
      const m = PRIVE_DESTINATION_INDEX[dest.slug];
      return { slug: dest.slug, place: lang === "en" ? m.en : m.es, queries: destinationPhotoQueries(dest.slug, m.es), video: `${m.en} aerial`, fromTrip: true };
    }
    const d = PRIVE_HERO_DESTINATIONS[idx] ?? PRIVE_HERO_DESTINATIONS[0];
    return { slug: d.slug, place: lang === "en" ? PRIVE_DESTINATION_INDEX[d.slug]?.en ?? d.es : d.es, queries: destinationPhotoQueries(d.slug, d.es), video: d.video, fromTrip: false };
  }, [dest, idx, lang]);
}

function HeroCopy({ firstName, h, titleId = "prive-hero-title", align = "left" }: { firstName: string | null; h: HeroData; titleId?: string; align?: "left" | "center" }) {
  const t = usePriveT();
  const name = firstName?.trim() || null;
  return (
    <>
      <div className={`flex items-center gap-3 mb-5 ${align === "center" ? "justify-center" : ""}`}>
        <Monogram size={44} />
        <p className="prive-eyebrow">IATOS PRIVÉ</p>
      </div>
      <h1 id={titleId} className="prive-display prive-hero-title">
        <span className="block">{t.home.tagline}</span>
        {t.home.taglineSub && <span className="block prive-hero-sub" lang="es">{t.home.taglineSub}</span>}
      </h1>
      <p className="prive-champagne mt-5 text-base sm:text-lg max-w-xl" data-testid="prive-hero-personal">
        {h.fromTrip ? t.home.personalTrip(name, h.place) : t.home.personal(name)}
      </p>
      <div className={`flex flex-wrap items-center gap-3 mt-7 ${align === "center" ? "justify-center" : ""}`}>
        <Link to="/prive/explorar" className="prive-btn prive-btn-gold">{t.home.explore}</Link>
        <Link to={askIatoHref("")} className="prive-btn prive-btn-ghost prive-btn-glass">{t.home.askIato}</Link>
      </div>
      <p className="text-[11px] tracking-[0.2em] uppercase prive-muted mt-6">
        {h.fromTrip
          ? <Link to={`/prive/destino/${h.slug}`} className="hover:text-[color:var(--pv-champagne)] underline-offset-4 hover:underline">{t.home.nextTrip(h.place)} →</Link>
          : <Link to={`/prive/destino/${h.slug}`} className="hover:text-[color:var(--pv-champagne)] underline-offset-4 hover:underline">{t.browse.heroPlace(h.place)} →</Link>}
      </p>
    </>
  );
}

/**
 * C · CINEMATIC JOURNEY (elegida). Foto a sangre completa con un acercamiento muy lento (Ken Burns)
 * y, si el movimiento está permitido y no se pidió ahorrar datos, un video ilustrativo de la ciudad
 * que aparece encima cuando ya puede reproducirse. Con movimiento reducido: foto fija, sin video.
 */
export function PriveHero({ firstName }: { firstName: string | null }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const { reduce, rise } = usePriveMotion();
  const h = useHeroData();
  const saveData = typeof navigator !== "undefined" && (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const wantVideo = !reduce && !saveData && !!h.video;
  const [video, setVideo] = useState<string | null>(() => (wantVideo && h.video ? cachedVideo(h.video)?.url ?? null : null));
  const [videoOn, setVideoOn] = useState(false);

  useEffect(() => {
    if (!wantVideo || !h.video) { setVideo(null); setVideoOn(false); return; }
    let alive = true;
    void getDestinationVideo(h.video).then((r) => { if (alive && r.url && /^https:\/\//.test(r.url)) setVideo(r.url); });
    return () => { alive = false; };
  }, [wantVideo, h.video]);

  return (
    <section className="prive-hero" aria-labelledby="prive-hero-title" data-testid="prive-hero" data-variant="c" data-slug={h.slug}>
      <div className="absolute inset-0" aria-hidden={videoOn}>
        <PrivePhoto queries={h.queries} alt={t.common.photoAlt(h.place)} label={h.place} eager
          className={`h-full w-full ${reduce ? "" : "prive-kenburns"}`} credit={!videoOn} creditClassName="is-hero" />
      </div>
      {video && wantVideo && (
        <video key={video} src={video} className={`prive-hero-video ${videoOn ? "is-on" : ""}`}
          autoPlay muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1}
          onCanPlay={() => setVideoOn(true)} onError={() => { setVideo(null); setVideoOn(false); }} />
      )}
      {videoOn && <p className="prive-photo-credit is-hero">{lang === "en" ? "Illustrative video · Pexels" : "Video ilustrativo · Pexels"}</p>}
      <div className="prive-hero-veil" aria-hidden="true" />
      <div className="relative z-10 h-full max-w-6xl mx-auto px-4 sm:px-8 flex flex-col justify-end pb-20 sm:pb-24">
        <motion.div {...rise(0.15)} className="max-w-3xl">
          <HeroCopy firstName={firstName} h={h} />
        </motion.div>
      </div>
      <a href="#prive-home" className="prive-hero-cue" aria-label={t.browse.scrollCue}><ChevronDown className="w-5 h-5" aria-hidden="true" /></a>
    </section>
  );
}

/** A · A PRIVATE EDITORIAL: portada de revista en dos columnas, número de edición y foto vertical. */
export function PriveHeroEditorial({ firstName }: { firstName: string | null }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const h = useHeroData();
  const now = new Date();
  const issue = `${lang === "en" ? "No." : "N.º"} ${String(isoWeekOf(now)).padStart(2, "0")} · ${now.toLocaleDateString(lang === "en" ? "en-US" : "es-MX", { month: "long", year: "numeric" })}`;
  return (
    <section className="prive-hero-editorial" aria-labelledby="prive-hero-title" data-testid="prive-hero" data-variant="a" data-slug={h.slug}>
      <div className="max-w-6xl mx-auto px-4 sm:px-8 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-14 items-end">
        <div className="order-2 lg:order-1 pb-4">
          <p className="text-[11px] tracking-[0.3em] uppercase prive-muted mb-6">{issue}</p>
          <HeroCopy firstName={firstName} h={h} />
        </div>
        <figure className="order-1 lg:order-2 relative">
          <PrivePhoto queries={h.queries} alt={t.common.photoAlt(h.place)} label={h.place} eager className="prive-editorial-photo" creditClassName="is-hero" />
          <figcaption className="mt-3 text-[11px] tracking-[0.2em] uppercase prive-muted">{t.browse.heroPlace(h.place)}</figcaption>
        </figure>
      </div>
    </section>
  );
}

/** B · CONTEMPORARY PRIVATE CLUB: saludo de club, credencial y accesos directos a las áreas. */
export function PriveHeroClub({ firstName, memberSince }: { firstName: string | null; memberSince?: string | null }) {
  const t = usePriveT();
  const h = useHeroData();
  const tiles = [
    { to: "/prive/key", brand: t.home.keyBrand, sub: t.shell.keySub },
    { to: "/prive/drops", brand: "Privé Drops", sub: t.shell.dropsSub },
    { to: "/prive/insider", brand: "Insider", sub: t.shell.insiderSub },
    { to: "/prive/explorar", brand: t.explore.brand, sub: t.explore.universesSub || t.explore.intro },
  ];
  return (
    <section className="prive-hero-club" aria-labelledby="prive-hero-title" data-testid="prive-hero" data-variant="b" data-slug={h.slug}>
      <div className="absolute inset-0 opacity-45" aria-hidden="true">
        <PrivePhoto queries={h.queries} alt="" label={h.place} eager className="h-full w-full" credit={false} />
      </div>
      <div className="prive-hero-veil" aria-hidden="true" />
      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-8 pt-28 pb-12 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-end">
        <div>
          <HeroCopy firstName={firstName} h={h} />
          {memberSince && <p className="text-xs prive-muted mt-3">{t.card.since}: {memberSince}</p>}
        </div>
        <ul className="grid grid-cols-2 gap-3">
          {tiles.map((x) => (
            <li key={x.to}>
              <Link to={x.to} className="prive-club-tile">
                <span className="prive-serif text-xl leading-tight">{x.brand}</span>
                <span className="text-[11px] prive-muted leading-snug mt-1">{x.sub}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function isoWeekOf(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - y0.getTime()) / 864e5 + 1) / 7);
}
