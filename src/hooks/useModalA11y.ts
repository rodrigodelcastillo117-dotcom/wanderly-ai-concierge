import { useEffect, useRef } from "react";

// Comportamiento mínimo de un diálogo modal hecho a mano (sin Radix): al abrir, el foco entra
// (al elemento con data-autofocus o al primero enfocable); Tab y Shift+Tab no salen; Escape
// cierra; al cerrar, el foco regresa a quien lo tenía. Los modales del Fixer y de "Editar con IA"
// no hacían nada de esto: Tab recorría la página tapada y Escape no cerraba.
const FOCUSABLE = "button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function useModalA11y(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const box = ref.current;
      if (!box || box.contains(document.activeElement)) return;
      (box.querySelector<HTMLElement>("[data-autofocus]") ?? box.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      const box = ref.current;
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !box.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !box.contains(active))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open]);

  return ref;
}
