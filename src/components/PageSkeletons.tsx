// Esqueletos de carga con la forma real de cada pantalla (antes: un círculo girando a mitad de
// una pantalla negra). Se detienen con "reducir movimiento" (motion-safe).
const Block = ({ className = "" }: { className?: string }) => (
  <div className={`rounded-2xl bg-white/[0.05] motion-safe:animate-pulse ${className}`} />
);

export function TripDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando tu viaje" role="status">
      <div className="h-[46vh] min-h-[320px] max-h-[520px] bg-white/[0.03] motion-safe:animate-pulse" />
      <div className="max-w-5xl space-y-5 p-4 sm:p-6 md:p-12">
        <Block className="h-6 w-56" />
        <Block className="h-44 w-full" />
        <Block className="h-28 w-full" />
        <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Block key={i} className="h-20" />)}
        </div>
      </div>
    </div>
  );
}

export function TripCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5" aria-busy="true" aria-label="Cargando tus viajes">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="glass-card rounded-2xl overflow-hidden">
          <div className="h-44 bg-white/[0.04] motion-safe:animate-pulse" />
          <div className="p-5 space-y-3">
            <Block className="h-3 w-20" />
            <Block className="h-7 w-2/3" />
            <Block className="h-4 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
