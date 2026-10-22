// AUD-SEG-03. Sin dependencias de Deno (se prueba con Vitest: src/test/audSeguridadEdge.test.ts).
// packing_lists tiene UNA fila por viaje (UNIQUE trip_id) y RLS de lectura "solo la mía". Antes la función
// hacía upsert con user_id = quien llama: un colaborador que generaba su lista se quedaba con la fila del
// dueño (el dueño dejaba de verla). Ahora: el dueño siempre puede (re)generar; un colaborador solo si no
// hay lista o si la que hay es suya.
export function canWritePackingList(existing: { user_id: string } | null, callerId: string, ownerId: string): boolean {
  if (callerId === ownerId) return true;
  return existing === null || existing.user_id === callerId;
}
