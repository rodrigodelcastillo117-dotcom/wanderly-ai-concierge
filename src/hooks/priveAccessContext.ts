// Contexto del estado Privé (lo llena PriveProvider en usePriveAccess.tsx). Separado para que las piezas
// que solo LEEN el estado si existe (p. ej. el candado de las áreas) no dependan del proveedor.
import { createContext, useContext } from "react";
import type { PriveErrorCode, PriveStatus } from "@/lib/priveApi";
import type { PriveView } from "@/lib/priveView";

export type PriveAccessSnapshot = { status: PriveStatus | null; view: PriveView | null; statusError?: PriveErrorCode | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PriveAccessContext = createContext<any>(undefined);

/** Estado Privé si hay proveedor; null fuera de /prive. */
export function usePriveAccessOptional(): PriveAccessSnapshot | null {
  return (useContext(PriveAccessContext) as PriveAccessSnapshot | undefined) ?? null;
}
