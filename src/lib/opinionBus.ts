// Abrir "¿Algo no se entiende? Cuéntanos" desde cualquier pantalla. Vive aparte de lib/opinion (que trae
// el cliente de Supabase y el envío) para que el enlace del pie y Ayuda no carguen nada más.
// El diálogo lo monta un anfitrión (OpinionHost): el del layout principal o, en las pantallas sin él,
// el de StandaloneOpinion. Si hay más de uno montado, abre solo el último: nunca dos diálogos.
type Listener = () => void;
const listeners: Listener[] = [];

export function openOpinion(): void {
  listeners[listeners.length - 1]?.();
}

export function onOpenOpinion(l: Listener): () => void {
  listeners.push(l);
  return () => {
    const i = listeners.lastIndexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
}
