import { useState } from "react";
import { Plane } from "lucide-react";
import { airlineCode, airlineLogoUrl, airlineName } from "@/lib/airlines";

/**
 * Logo de la aerolínea en una ficha blanca (logotipo con object-contain: nunca se estira ni se usa
 * como portada). Sale del CDN de Travelpayouts (pics.avs.io), sin llamadas a funciones. Si no se
 * reconoce la aerolínea o el logo no carga, un avión de la marca (nunca un ícono roto).
 */
export function AirlineLogo({ airline, logoUrl, size = 40, shape = "wide", className = "" }: {
  /** Nombre, código IATA o número de vuelo ("Aeroméxico", "AM", "AM 401"). */
  airline?: string | null;
  /** Logo que ya trae el resultado (p. ej. Google Flights): tiene prioridad. */
  logoUrl?: string | null;
  /** Alto de la ficha en px. */
  size?: number;
  /** wide: logotipo horizontal (ficha de 3:1); square: ficha cuadrada para espacios muy chicos. */
  shape?: "wide" | "square";
  className?: string;
}) {
  const code = airlineCode(airline);
  const width = shape === "wide" ? size * 3 : size;
  const fromCdn = code ? airlineLogoUrl(code, shape === "wide" ? 240 : 120, shape === "wide" ? 80 : 120, true) : null;
  const given = typeof logoUrl === "string" && /^https:\/\//.test(logoUrl) ? logoUrl : null;
  const [failed, setFailed] = useState<string[]>([]);
  // En la ficha ancha manda el logotipo horizontal del CDN (se lee mejor); el del resultado es respaldo.
  const order = shape === "wide" ? [fromCdn, given] : [given, fromCdn];
  const src = order.find((u) => u && !failed.includes(u)) ?? null;
  const label = airlineName(code) ?? (airline ? String(airline) : "Aerolínea");
  const pad = Math.max(3, Math.round(size * 0.12));
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-black/5 shadow-[0_6px_18px_-8px_rgba(0,0,0,0.6)] overflow-hidden ${className}`}
      style={{ width, height: size, padding: src ? pad : 0 }}
      data-testid="airline-logo"
      data-code={code ?? ""}
    >
      {src ? (
        <img
          src={src}
          alt={`Logo de ${label}`}
          width={width - pad * 2}
          height={size - pad * 2}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-contain"
          onError={() => setFailed((f) => [...f, src])}
        />
      ) : (
        <span className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#2a2418] to-[#0f0d0a]" aria-label={label} role="img">
          <Plane className="w-1/2 h-1/2 text-primary" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

export default AirlineLogo;
