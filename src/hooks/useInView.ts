import { useEffect, useState, type RefObject } from "react";

/**
 * true en cuanto el elemento entra (o está por entrar) en pantalla, y se queda en true.
 * Sirve para no pedir recursos de tarjetas que el usuario nunca ve (N-04). Sin
 * IntersectionObserver (navegadores viejos) se considera visible.
 */
export function useInView<T extends Element>(ref: RefObject<T>, rootMargin = "200px"): boolean {
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, inView]);
  return inView;
}
