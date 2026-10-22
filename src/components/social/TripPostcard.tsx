import { useEffect, useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { PriveSeal } from "@/components/PriveSeal";
import { getStockPhoto, cachedStockPhoto } from "@/lib/stockPhoto";
import { destinationQuery } from "@/lib/categoryImagery";
import { postcardCaption, postcardFilename, renderPostcard, shareOrDownload, type PostcardInput } from "@/lib/postcard";

export type PostcardPerson = { name: string; avatar: string | null; prive?: boolean };

type Props = {
  me: PostcardPerson;
  friend: PostcardPerson;
  place: string;
  country?: string | null;
  year?: string | null;
  upcoming?: boolean;
  /** Portada real del viaje; si no hay, foto ilustrativa del destino. */
  coverUrl?: string | null;
};

const safeHttps = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
};

/**
 * Postal de los dos: vista previa en la página (HTML) y, al compartir o descargar, la misma
 * composición dibujada en canvas a 1080 × 1350 (formato de historia/feed).
 */
export function TripPostcard({ me, friend, place, country, year, upcoming, coverUrl }: Props) {
  const real = safeHttps(coverUrl);
  const query = destinationQuery(place, country ?? null);
  const [stock, setStock] = useState<string | null>(() => (real ? null : cachedStockPhoto(query)?.image ?? null));
  const [busy, setBusy] = useState<"share" | "download" | null>(null);

  useEffect(() => {
    if (real) { setStock(null); return; }
    let alive = true;
    const hit = cachedStockPhoto(query);
    if (hit !== undefined) { setStock(hit?.image ?? null); return; }
    void getStockPhoto(query).then((p) => { if (alive) setStock(p?.image ?? null); });
    return () => { alive = false; };
  }, [real, query]);

  const photo = real ?? stock;
  const input: PostcardInput = {
    place, country: country ?? null, year: year ?? null, upcoming: !!upcoming,
    names: [me.name, friend.name], avatars: [me.avatar, friend.avatar], prive: [!!me.prive, !!friend.prive],
    photoUrl: photo, photoIsStock: !real && !!stock,
  };
  const caption = postcardCaption(input);

  const run = async (mode: "share" | "download") => {
    if (busy) return;
    setBusy(mode);
    try {
      const blob = await renderPostcard(input);
      if (!blob) { toast.error("Tu navegador no pudo crear la postal."); return; }
      const out = await shareOrDownload(blob, postcardFilename(input), `${caption} ✈️`, mode === "download");
      if (out === "downloaded") toast.success("Postal descargada");
      else if (out === "shared") toast.success("¡Postal compartida!");
      else if (out === "failed") toast.error("No se pudo guardar la postal.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Misma composición que el PNG (1080 × 1350); medidas en % y cqw del ancho de la postal. */}
      <figure
        className="relative mx-auto w-full max-w-[420px] aspect-[4/5] overflow-hidden rounded-[22px] bg-[#0f0d09] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] [container-type:inline-size]"
        data-testid="postcard"
        aria-label={`Postal: ${caption}`}
      >
        {photo ? (
          <img src={photo} alt="" referrerPolicy="no-referrer" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,#3a3020_0%,#17130d_50%,#0a0a0a_100%)]" />
        )}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[42%] bg-gradient-to-b from-[#0a0a0a]/75 to-transparent" />
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/75 to-transparent" />
        <div aria-hidden="true" className="absolute inset-[3.7cqw] border border-primary/80" />
        <div aria-hidden="true" className="absolute inset-[5cqw] border border-primary/30" />

        <div className="absolute left-[9cqw] top-[9cqw] right-[30cqw]">
          <p className="text-[2.6cqw] tracking-[0.35em] text-primary font-semibold leading-none">{upcoming ? "PRÓXIMO DESTINO" : "SALUDOS DESDE"}</p>
          <p className={`mt-[1.5cqw] font-display italic leading-[0.95] text-[#F5EBDD] drop-shadow-[0_4px_18px_rgba(0,0,0,0.6)] break-words ${place.length > 9 ? "text-[10cqw]" : "text-[15cqw]"}`}>{place}</p>
          {country && <p className="mt-[1.2cqw] text-[2.8cqw] tracking-[0.25em] text-[#F5EBDD]/80 uppercase">{country}</p>}
        </div>

        {/* Timbre */}
        <div aria-hidden="true" className="absolute left-[74.4cqw] top-[8.5cqw] w-[16.3cqw] aspect-[176/214] rotate-[5deg] bg-[#F3E9D2] p-[1.6cqw] shadow-[0_8px_20px_rgba(0,0,0,0.45)] outline-[0.5cqw] outline-dotted outline-[#F3E9D2] outline-offset-[0.4cqw]">
          <div className="w-full h-full border border-primary bg-gradient-to-b from-[#1a1610] to-[#2b2416] flex flex-col items-center justify-center gap-[0.8cqw]">
            <span className="font-display text-primary text-[3.4cqw] leading-none">IATOS</span>
            <span className="text-primary/80 text-[1.05cqw] tracking-[0.12em] leading-none whitespace-nowrap">VIAJES JUNTOS</span>
            <span className="text-[#F5EBDD] text-[2.6cqw] font-semibold leading-none">{year ?? new Date().getFullYear()}</span>
          </div>
        </div>

        {/* Matasellos */}
        <div aria-hidden="true" className="absolute left-[68.2cqw] top-[31.3cqw] w-[17cqw] h-[17cqw] -rotate-12 rounded-full border-[0.4cqw] border-[#F5EBDD]/75 p-[1.1cqw]">
          <div className="w-full h-full rounded-full border-[0.2cqw] border-[#F5EBDD]/60 flex flex-col items-center justify-center gap-[0.7cqw] text-[#F5EBDD]/85 font-semibold leading-none">
            <span className="text-[1.5cqw] tracking-[0.3em]">SALUDOS</span>
            <span className="text-[2.4cqw] tracking-[0.1em] uppercase max-w-[13cqw] truncate">{place}</span>
            <span className="text-[1.8cqw]">{year ?? new Date().getFullYear()}</span>
          </div>
        </div>

        {/* Los dos (el de la derecha va abajo, como en el PNG) */}
        <div className="absolute left-[46.9%] top-[47.9%] w-[34%] aspect-square">
          <FriendAvatar name={friend.name} url={friend.avatar} className="w-full h-full text-[14cqw] border-[0.4cqw] border-[#0a0a0a] ring-[1cqw] ring-primary shadow-[0_16px_40px_rgba(0,0,0,0.6)]" testId="postcard-avatar" />
          {friend.prive && <span className="absolute right-[-2%] bottom-[2%]"><PriveSeal size="lg" /></span>}
        </div>
        <div className="absolute left-[19.1%] top-[47.9%] w-[34%] aspect-square">
          <FriendAvatar name={me.name} url={me.avatar} className="w-full h-full text-[14cqw] border-[0.4cqw] border-[#0a0a0a] ring-[1cqw] ring-primary shadow-[0_16px_40px_rgba(0,0,0,0.6)]" testId="postcard-avatar" />
          {me.prive && <span className="absolute left-[-2%] bottom-[2%]"><PriveSeal size="lg" /></span>}
        </div>
        <span aria-hidden="true" className="absolute left-1/2 top-[72.9%] -translate-x-1/2 -translate-y-1/2 w-[8.5cqw] h-[8.5cqw] rounded-full bg-primary text-primary-foreground font-display italic text-[5cqw] flex items-center justify-center shadow-lg">&amp;</span>

        <figcaption className="absolute inset-x-0 top-[78.5%] text-center px-[8cqw]">
          <p className="font-display text-[7.2cqw] text-[#F5EBDD] leading-tight truncate">{me.name} &amp; {friend.name}</p>
          <p className="mt-[1.2cqw] text-[2.4cqw] tracking-[0.3em] text-primary uppercase font-semibold">
            {upcoming ? `${place} · próximamente` : `${place}${year ? ` · ${year}` : ""}`}
          </p>
          <p className="mt-[4.5cqw] text-[1.9cqw] tracking-[0.35em] text-[#F5EBDD]/50">HECHO CON IATOS</p>
        </figcaption>
        {!real && stock && (
          <span className="absolute bottom-[3cqw] right-[7cqw] text-[1.6cqw] text-white/60" data-testid="illustrative-caption">Foto ilustrativa</span>
        )}
      </figure>

      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => run("share")} disabled={!!busy} className="bg-gradient-gold text-primary-foreground gold-glow">
          {busy === "share" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
          Compartir postal
        </Button>
        <Button variant="outline" onClick={() => run("download")} disabled={!!busy} className="border-primary/30 text-primary hover:bg-primary/10">
          {busy === "download" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
          Descargar
        </Button>
      </div>
    </div>
  );
}
