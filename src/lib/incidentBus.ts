// Abrir "Tengo un problema" desde cualquier pantalla (menú «Más», menú lateral, dentro del viaje). Vive aparte
// de lib/incident (que trae el cliente de Supabase) para que los botones no carguen nada más. El diálogo lo
// monta IncidentHost (en DashboardLayout). Si hay más de uno montado, abre solo el último.
export type OpenIncidentOptions = { tripId?: string | null };
type Listener = (o: OpenIncidentOptions) => void;
const listeners: Listener[] = [];

export function openIncident(o: OpenIncidentOptions = {}): void {
  listeners[listeners.length - 1]?.(o);
}

export function onOpenIncident(l: Listener): () => void {
  listeners.push(l);
  return () => {
    const i = listeners.lastIndexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export const INCIDENT_CTA = "Tengo un problema";
