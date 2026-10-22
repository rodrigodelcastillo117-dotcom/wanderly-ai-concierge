import { QueryClient } from "@tanstack/react-query";

/**
 * Caché de React Query de la app. Hoy ninguna pantalla usa useQuery: solo "Eliminar mi cuenta" la
 * vacía al terminar. Antes el QueryClientProvider vivía en App.tsx y metía @tanstack/react-query
 * (~12 KB gzip) en el paquete inicial de todas las visitas (Rendimiento, cierre 2026-10). Ahora este
 * módulo se carga solo con la pantalla que lo importa. Si una pantalla empieza a usar useQuery,
 * envuélvela en <QueryClientProvider client={queryClient}> (o vuelve a ponerlo en App.tsx y ajusta
 * el presupuesto del paquete inicial en src/test/rendimientoBundle.test.ts).
 */
export const queryClient = new QueryClient();
