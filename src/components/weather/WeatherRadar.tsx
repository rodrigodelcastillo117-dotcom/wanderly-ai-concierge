// Radar de lluvia animado de una ciudad (pantalla Clima). Se carga diferido (React.lazy) solo al abrirlo.
// Cuadros de precipitación de las últimas horas (NASA GIBS · GPM IMERG, satélite) sobre el mapa de la
// NASA, con reproducir/pausar y línea de tiempo; encima, partículas de viento con el viento real de la
// ciudad y, abajo, la lluvia de las próximas horas (MET Norway). Fuentes y términos: src/lib/weatherRadar.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Wind } from "lucide-react";
import {
  ATTRIBUTION, RADAR_ZOOM, baseTileUrl, bordersTileUrl, fetchLatestFrame, fetchNowcast, findLatestFrame, frameTimes, precipTileUrl, tileGrid,
  windFromLabel, windVector, type Nowcast,
} from "@/lib/weatherRadar";

type Props = { city: string; lat: number; lng: number };

const FRAMES = 8;
const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** ¿Existe la tesela? (una imagen; sin red o con 404, false). */
function probeImage(url: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined") return resolve(false);
    const img = new Image();
    const t = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => { clearTimeout(t); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const ago = (iso: string, now: number) => {
  const h = Math.max(0, Math.round((now - Date.parse(iso)) / 3600_000));
  return h === 0 ? "hace menos de 1 h" : `hace ${h} h`;
};

export default function WeatherRadar({ city, lat, lng }: Props) {
  const grid = useMemo(() => tileGrid(lat, lng, RADAR_ZOOM), [lat, lng]);
  const [frames, setFrames] = useState<string[]>([]);
  const [status, setStatus] = useState<"cargando" | "listo" | "sin_datos">("cargando");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [nowcast, setNowcast] = useState<Nowcast | null>(null);
  const now = useRef(Date.now());

  // Último cuadro publicado y los anteriores (4 h).
  useEffect(() => {
    let alive = true;
    const { x, y } = grid.centerTile;
    // Primero lo que GIBS dice que ya publicó; solo si no responde, se prueba desde hace 6 h (IMERG llega
    // con ~6 h de retraso: probar desde hace 3 h pedía cuadros que aún no existen).
    void fetchLatestFrame()
      .then((known) => known ?? findLatestFrame((t) => probeImage(precipTileUrl(t, RADAR_ZOOM, x, y)), new Date(), { minLagHours: 6, steps: 12 }))
      .then((latest) => {
      if (!alive) return;
      if (!latest) { setStatus("sin_datos"); return; }
      const f = frameTimes(latest, FRAMES);
      setFrames(f);
      setIdx(f.length - 1);
      setStatus("listo");
      // Arranca en movimiento salvo que la persona pida menos movimiento.
      setPlaying(!reducedMotion());
    });
    return () => { alive = false; };
  }, [grid]);

  useEffect(() => {
    let alive = true;
    void fetchNowcast(lat, lng).then((n) => { if (alive) setNowcast(n); });
    return () => { alive = false; };
  }, [lat, lng]);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % frames.length), 700);
    return () => clearInterval(t);
  }, [playing, frames.length]);

  const wind = nowcast?.windMs != null && nowcast.windFromDeg != null ? { ms: nowcast.windMs, from: nowcast.windFromDeg } : null;
  const maxMm = Math.max(1, ...(nowcast?.hours ?? []).map((h) => h.precipMm ?? 0));

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-primary/20 bg-black/30" data-testid="weather-radar">
      <div className="relative h-60 w-full overflow-hidden bg-[#0b1a2a] sm:h-80" aria-label={`Mapa de lluvia de ${city}`} role="img">
        <div className="absolute" style={{ width: grid.width, height: grid.height, left: `calc(50% - ${grid.cityX}px)`, top: `calc(50% - ${grid.cityY}px)` }}>
          {grid.tiles.map((t) => (
            <img key={`b${t.x}-${t.y}`} src={baseTileUrl(RADAR_ZOOM, t.x, t.y)} alt="" aria-hidden="true" draggable={false}
              className="absolute h-64 w-64 max-w-none select-none opacity-70" style={{ left: t.left, top: t.top }} />
          ))}
          {/* Todos los cuadros cargados a la vez; solo uno visible: la animación no espera a la red. */}
          {frames.map((f, fi) => (
            <div key={f} className="absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none" style={{ opacity: fi === idx ? 0.95 : 0 }} data-frame={f}>
              {grid.tiles.map((t) => (
                <img key={`p${t.x}-${t.y}`} src={precipTileUrl(f, RADAR_ZOOM, t.x, t.y)} alt="" aria-hidden="true" draggable={false}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  className="absolute h-64 w-64 max-w-none select-none" style={{ left: t.left, top: t.top }} />
              ))}
            </div>
          ))}
          {grid.tiles.map((t) => (
            <img key={`r${t.x}-${t.y}`} src={bordersTileUrl(RADAR_ZOOM, t.x, t.y)} alt="" aria-hidden="true" draggable={false}
              className="absolute h-64 w-64 max-w-none select-none opacity-60" style={{ left: t.left, top: t.top }} />
          ))}
        </div>
        {wind && <WindParticles ms={wind.ms} fromDeg={wind.from} />}
        {/* La ciudad, al centro */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="absolute -inset-2 rounded-full bg-primary/40 motion-safe:animate-ping" aria-hidden="true" />
          <span className="relative block h-3 w-3 rounded-full border-2 border-white bg-primary" aria-hidden="true" />
        </div>
        <span className="pointer-events-none absolute left-1/2 top-1/2 ml-3 -translate-y-1/2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white">{city}</span>
        <div className="absolute left-2 top-2 rounded-lg bg-black/65 px-2 py-1 text-[11px] text-white" data-testid="radar-frame-time" aria-live="polite">
          {status === "cargando" ? "Cargando radar…" : status === "sin_datos" ? "Sin cuadros de lluvia recientes" : `${hhmm(frames[idx])} · ${ago(frames[idx], now.current)}`}
        </div>
        {wind && (
          <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/65 px-2 py-1 text-[11px] text-white" data-testid="radar-wind">
            <Wind className="h-3 w-3" aria-hidden="true" /> {Math.round(wind.ms * 3.6)} km/h {windFromLabel(wind.from)}
          </div>
        )}
      </div>

      <div className="space-y-3 p-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setPlaying((p) => !p)} disabled={frames.length < 2}
            aria-label={playing ? "Pausar radar" : "Reproducir radar"} data-testid="radar-play"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
            {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
          <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={idx} disabled={frames.length < 2}
            onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
            aria-label="Línea de tiempo del radar" aria-valuetext={frames[idx] ? hhmm(frames[idx]) : undefined}
            className="min-w-0 flex-1 accent-primary" />
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{frames[idx] ? hhmm(frames[idx]) : "—"}</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Ligera</span>
          <span className="h-2 flex-1 rounded-full" style={{ background: "linear-gradient(90deg,#2f9e44,#7bd23f,#f2e830,#f59f1c,#e03131)" }} aria-hidden="true" />
          <span>Fuerte</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Lluvia estimada por satélite cada 30 min; los datos llegan con unas horas de retraso.
        </p>

        {nowcast && nowcast.hours.length > 0 && (
          <div data-testid="radar-nowcast">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Próximas horas en {city}</p>
            <div className="grid grid-cols-6 gap-1.5">
              {nowcast.hours.map((h) => (
                <div key={h.time} className="flex flex-col items-center gap-1">
                  <div className="flex h-10 w-full items-end overflow-hidden rounded bg-white/[0.04]">
                    <div className="w-full rounded-t bg-sky-400/80" style={{ height: `${Math.max(4, ((h.precipMm ?? 0) / maxMm) * 100)}%`, opacity: (h.precipMm ?? 0) > 0 ? 1 : 0.25 }} />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground">{hhmm(h.time)}</span>
                  <span className="text-[10px] tabular-nums">{h.precipMm == null ? "—" : `${h.precipMm} mm`}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-muted-foreground" data-testid="radar-attribution">
          <a href={ATTRIBUTION.precip.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{ATTRIBUTION.precip.label}</a>
          {" · "}
          <a href={ATTRIBUTION.base.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{ATTRIBUTION.base.label}</a>
          {" · "}
          <a href={ATTRIBUTION.metno.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{ATTRIBUTION.metno.label}</a>
          . Imágenes de la NASA; la NASA no respalda a IATOS.
        </p>
      </div>
    </div>
  );
}

/**
 * Partículas de viento con la dirección y velocidad reales de la ciudad (un solo punto: el campo es
 * uniforme, con una leve variación para que se vea natural). Con "reducir movimiento", flechas quietas.
 */
function WindParticles({ ms, fromDeg }: { ms: number; fromDeg: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas?.getContext("2d") ?? null; } catch { ctx = null; }
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 240;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const { dx, dy } = windVector(fromDeg);
    const speed = Math.max(0.4, Math.min(4, ms / 2.5)); // px por cuadro
    if (reducedMotion()) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.2;
      for (let y = 30; y < h; y += 60) for (let x = 30; x < w; x += 60) {
        ctx.beginPath(); ctx.moveTo(x - dx * 10, y - dy * 10); ctx.lineTo(x + dx * 10, y + dy * 10); ctx.stroke();
        ctx.beginPath(); ctx.arc(x + dx * 10, y + dy * 10, 1.6, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill();
      }
      return;
    }
    const n = Math.round(Math.min(260, (w * h) / 900));
    const ps = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, age: Math.random() * 80 }));
    let raf = 0;
    const step = () => {
      ctx!.globalCompositeOperation = "destination-out";
      ctx!.fillStyle = "rgba(0,0,0,0.08)";
      ctx!.fillRect(0, 0, w, h);
      ctx!.globalCompositeOperation = "source-over";
      ctx!.strokeStyle = "rgba(255,255,255,0.75)";
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      for (const p of ps) {
        const wob = Math.sin((p.x + p.y) / 70 + p.age / 25) * 0.35;
        const vx = (dx - dy * wob) * speed;
        const vy = (dy + dx * wob) * speed;
        ctx!.moveTo(p.x, p.y);
        p.x += vx; p.y += vy; p.age += 1;
        ctx!.lineTo(p.x, p.y);
        if (p.age > 90 || p.x < -5 || p.y < -5 || p.x > w + 5 || p.y > h + 5) { p.x = Math.random() * w; p.y = Math.random() * h; p.age = 0; }
      }
      ctx!.stroke();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ms, fromDeg]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" data-testid="radar-wind-canvas" />;
}
