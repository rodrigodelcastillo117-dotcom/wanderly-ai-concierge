// Estado global mínimo del diálogo de límite: cualquier pantalla lo abre con openFreeLimitDialog y
// <FreeLimitDialogHost/> (montado una vez en App) lo muestra. Sin dependencias de React aquí.
import type { FreeLimitInfo } from "@/lib/functionErrors";

let current: FreeLimitInfo | null = null;
const listeners = new Set<() => void>();

export function openFreeLimitDialog(info: FreeLimitInfo) {
  current = info;
  listeners.forEach((l) => l());
}

export function closeFreeLimitDialog() {
  current = null;
  listeners.forEach((l) => l());
}

export function getFreeLimitDialog() {
  return current;
}

export function subscribeFreeLimitDialog(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
