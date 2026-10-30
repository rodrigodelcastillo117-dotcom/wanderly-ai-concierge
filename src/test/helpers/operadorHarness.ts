// Arnés del Operador IATOS para Vitest. La lógica vive en supabase/functions/_shared/operador/eval/arnes.ts (la usa
// también la evaluación con IA real en el servidor, operador-eval); aquí solo se le dan vi.fn y el reloj falso de Vitest.
import { vi } from "vitest";
import { arnes as arnesBase } from "../../../supabase/functions/_shared/operador/eval/arnes";

export * from "../../../supabase/functions/_shared/operador/eval/arnes";

export function arnes(o: Parameters<typeof arnesBase>[0]) {
  return arnesBase(o, {
    espia: (f) => vi.fn(f) as never,
    fijarReloj: (inicio) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(inicio); },
  });
}
export type Arnes = ReturnType<typeof arnes>;
