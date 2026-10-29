// Título de la pestaña por ruta (auditoría de cuenta #8 y técnica #10): antes casi todas decían
// "IATOS AI". Formato "<Pantalla> · IATOS". Las pantallas que ponen su propio título (Wrapped, Recuerdos,
// Privé) no se tocan aquí (null). La ruta desconocida usa el de la 404.
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export const BRAND_TITLE = "IATOS";
export const HOME_TITLE = "IATOS · Tu concierge de viajes con IA";
export const NOT_FOUND_TITLE = "Página no encontrada · IATOS";

const EXACT: Record<string, string> = {
  "/": HOME_TITLE,
  "/auth": "Inicia sesión · IATOS",
  "/reset-password": "Nueva contraseña · IATOS",
  "/terminos": "Términos y Condiciones · IATOS",
  "/privacidad": "Aviso de Privacidad · IATOS",
  "/reembolsos": "Política de Reembolsos · IATOS",
  "/cookies": "Política de Cookies · IATOS",
  "/ayuda": "Ayuda y preguntas frecuentes · IATOS",
  "/onboarding": "Bienvenida · IATOS",
  "/onboarding/deep": "Tus preferencias de viaje · IATOS",
  "/dashboard": "Inicio · IATOS",
  "/dashboard/planear": "Planear un viaje · IATOS",
  "/dashboard/ruta": "Ruta de varios destinos · IATOS",
  "/dashboard/explorar": "Explorar destinos · IATOS",
  "/dashboard/viajes": "Mis viajes · IATOS",
  "/dashboard/viajes/importar": "Subir un viaje · IATOS",
  "/dashboard/comparar": "Comparar · IATOS",
  "/dashboard/convertidor": "Convertidor de moneda · IATOS",
  "/dashboard/vuelos": "Vuelos · IATOS",
  "/dashboard/hoteles": "Hoteles · IATOS",
  "/dashboard/seguros": "Seguros de viaje · IATOS",
  "/dashboard/beneficios": "Documentos y tarjetas · IATOS",
  "/dashboard/autos": "Autos · IATOS",
  "/dashboard/esim": "eSIM · IATOS",
  "/dashboard/actividades": "Actividades · IATOS",
  "/dashboard/restaurantes": "Restaurantes · IATOS",
  "/dashboard/trenes": "Trenes · IATOS",
  "/dashboard/ferries": "Ferries · IATOS",
  "/dashboard/cruceros": "Cruceros · IATOS",
  "/dashboard/reservas": "Mis reservas · IATOS",
  "/dashboard/descubre": "Descubre · IATOS",
  "/dashboard/cercanos": "Cerca de ti · IATOS",
  "/dashboard/favoritos": "Favoritos · IATOS",
  "/dashboard/social": "Social · IATOS",
  "/dashboard/gastos": "Gastos · IATOS",
  "/dashboard/concierge": "Concierge · IATOS",
  "/dashboard/pro": "Plan IATOS PRO · IATOS",
  "/dashboard/perfil": "Mi perfil · IATOS",
  "/dashboard/admin": "Métricas (administración) · IATOS",
  "/dashboard/admin/operaciones": "Mesa de operaciones · IATOS",
  "/admin/operaciones": "Mesa de operaciones · IATOS",
  "/dashboard/admin/edicion": "Panel editorial · IATOS",
  // La lectura sin conexión vive fuera de PriveRoot (no pone título propio).
  "/prive/edicion/sin-conexion": "Lectura sin conexión · IATOS Privé",
};

const PATTERNS: Array<[RegExp, string]> = [
  [/^\/dashboard\/viajes\/[^/]+\/editar$/, "Editar viaje · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+\/live$/, "Viaje en curso · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+\/mapa$/, "Mapa del viaje · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+\/packing$/, "Equipaje · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+\/clima$/, "Clima del viaje · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+\/traductor$/, "Traductor · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+\/diario$/, "Diario del viaje · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+\/split$/, "Gastos compartidos · IATOS"],
  [/^\/dashboard\/viajes\/[^/]+$/, "Tu viaje · IATOS"],
  [/^\/dashboard\/social\/amigo\/[^/]+$/, "Perfil de amigo · IATOS"],
];

/** Pantallas que ponen su propio título: aquí no se tocan. */
const OWN_TITLE = [/^\/prive(?!\/edicion\/sin-conexion)(\/|$)/, /^\/wrapped(\/|$)/, /^\/dashboard\/recuerdos\/?$/];

/** Título para una ruta; null = la pantalla pone el suyo. Una ruta desconocida da el de la 404. */
export function titleForPath(pathname: string): string | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (OWN_TITLE.some((r) => r.test(p))) return null;
  if (EXACT[p]) return EXACT[p];
  for (const [re, t] of PATTERNS) if (re.test(p)) return t;
  return NOT_FOUND_TITLE;
}

/** Pone el título de la pestaña al cambiar de ruta. Va dentro del Router, antes de <Routes>. */
export function RouteTitle(): null {
  const { pathname } = useLocation();
  useEffect(() => {
    const t = titleForPath(pathname);
    if (t) document.title = t;
  }, [pathname]);
  return null;
}
