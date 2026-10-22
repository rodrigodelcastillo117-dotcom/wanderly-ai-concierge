import { useState } from "react";

const safeHttps = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
};

type Props = {
  name: string;
  url: string | null | undefined;
  /** circle = lista y postal; portrait = retrato de cuerpo entero del Travel Avatar. */
  shape?: "circle" | "portrait";
  className?: string;
  ring?: boolean;
  testId?: string;
};

/**
 * Travel Avatar de una persona. Los avatares de IATOS son de cuerpo entero: en círculo se encuadra
 * la parte de arriba (la cara). Sin avatar (o si la imagen falla) se ve la inicial en dorado.
 */
export function FriendAvatar({ name, url, shape = "circle", className = "w-12 h-12", ring = false, testId }: Props) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : safeHttps(url);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const radius = shape === "circle" ? "rounded-full" : "rounded-[28px]";
  return (
    <div
      className={`relative shrink-0 overflow-hidden ${radius} ${ring ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-background" : ""} bg-gradient-gold ${className}`}
      data-testid={testId}
    >
      {src ? (
        <img
          src={src}
          alt={`Avatar de ${name}`}
          className={`absolute inset-0 w-full h-full object-cover ${shape === "circle" ? "object-[50%_8%]" : "object-top"}`}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          aria-label={`Avatar de ${name}`}
          role="img"
          className={`absolute inset-0 flex items-center justify-center font-display text-primary-foreground ${shape === "portrait" ? "text-6xl" : "text-[0.95em]"}`}
        >
          {initial}
        </span>
      )}
    </div>
  );
}
