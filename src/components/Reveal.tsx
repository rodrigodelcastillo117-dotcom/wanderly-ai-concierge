import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Aparición suave al entrar en pantalla, solo con CSS + IntersectionObserver. Sustituye a
 * framer-motion en la landing: así la primera página no descarga esa librería (~40 kB
 * comprimidos) (E-23). Con "reducir movimiento" o sin IntersectionObserver se muestra directo.
 */
export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => typeof window === "undefined" || typeof window.IntersectionObserver === "undefined");

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal ${shown ? "reveal-in" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
