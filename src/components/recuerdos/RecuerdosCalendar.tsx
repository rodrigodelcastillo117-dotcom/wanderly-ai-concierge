// Calendario mensual de Recuerdos: miniatura en los días con fotos (y cuántas hay); al tocar un día se
// abre el visor con sus fotos.
import { ChevronLeft, ChevronRight, Play, Star } from "lucide-react";
import { dayLabel, monthGrid, monthLabel, thumbOf, WEEKDAYS_ES, type RecuerdoItem } from "@/lib/recuerdos/model";

export function RecuerdosCalendar({ year, month, items, today, onMonth, onOpenDay, thumbUrl }: {
  year: number;
  month: number;
  items: RecuerdoItem[];
  today: string;
  onMonth: (delta: number) => void;
  onOpenDay: (day: string) => void;
  thumbUrl: (it: RecuerdoItem) => string | null;
}) {
  const cells = monthGrid(year, month, items);
  const inMonth = cells.filter((c) => c.inMonth).reduce((n, c) => n + c.items.length, 0);
  return (
    <section aria-label={`Calendario de ${monthLabel(year, month)}`} className="rounded-2xl border border-border bg-surface/40 p-3 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => onMonth(-1)} aria-label="Mes anterior" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/5">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="text-center">
          <h2 className="font-display text-xl md:text-2xl" data-testid="recuerdos-month">{monthLabel(year, month)}</h2>
          <p className="text-xs text-muted-foreground">{inMonth ? `${inMonth.toLocaleString("es-MX")} ${inMonth === 1 ? "recuerdo" : "recuerdos"}` : "Sin fotos este mes"}</p>
        </div>
        <button type="button" onClick={() => onMonth(1)} aria-label="Mes siguiente" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/5">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="mx-auto grid max-w-2xl grid-cols-7 gap-1 md:gap-2" role="grid">
        {WEEKDAYS_ES.map((d, i) => (
          <div key={i} role="columnheader" className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{d}</div>
        ))}
        {cells.map((c) => {
          const first = c.items.find((i) => i.mediaType === "foto" || i.thumbPath) ?? c.items[0];
          const url = first ? thumbUrl(first) : null;
          const n = c.items.length;
          const isToday = c.day === today;
          const dayNum = Number(c.day.slice(8, 10));
          if (!n) {
            return (
              <div key={c.day} role="gridcell" className={`flex aspect-square items-start justify-start rounded-lg p-1 text-xs ${c.inMonth ? "text-muted-foreground" : "text-muted-foreground/30"} ${isToday ? "ring-1 ring-primary/60" : ""}`}>
                {dayNum}
              </div>
            );
          }
          return (
            <button key={c.day} type="button" role="gridcell" onClick={() => onOpenDay(c.day)}
              aria-label={`${dayLabel(c.day)}: ${n} ${n === 1 ? "recuerdo" : "recuerdos"}`}
              className={`group relative aspect-square overflow-hidden rounded-lg bg-black/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${c.inMonth ? "" : "opacity-50"}`}>
              {url ? <img src={url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105" />
                : first && thumbOf(first) == null ? <span className="absolute inset-0 flex items-center justify-center"><Play className="h-5 w-5 text-white/70" aria-hidden="true" /></span> : null}
              <span className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-1 pt-0.5 text-[11px] font-semibold text-white">{dayNum}</span>
              {n > 1 && <span className="absolute bottom-0.5 right-0.5 rounded-full bg-black/70 px-1.5 text-[10px] font-semibold text-white">{n}</span>}
              {c.items.some((i) => i.favorite) && <Star className="absolute bottom-0.5 left-0.5 h-3 w-3 fill-primary text-primary" aria-hidden="true" />}
              {first?.mediaType === "video" && url && <Play className="absolute right-1 top-1 h-3 w-3 text-white" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
