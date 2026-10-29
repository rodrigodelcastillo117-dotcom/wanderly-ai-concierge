// CANDADO DE CALIDAD (29-oct-2026, tras la queja de Carlo): la lista de "lo que no se toca" en forma que
// las pruebas pueden comprobar. Es la misma lista de docs/iatos/LO_QUE_NO_SE_TOCA.md.
//
// Regla: aquí solo se AGREGA. Quitar una fila es quitarle a un usuario algo que ya usa; eso necesita la
// aprobación del dueño (capturas antes/después) y se anota en el documento.

/** Cada ruta de src/App.tsx: qué página monta y si exige sesión o ser administrador. */
export type RutaCandado = {
  /** Patrón exacto como está en App.tsx (rutas anidadas con su ruta completa). */
  path: string;
  /** URL de ejemplo para rutas con parámetros. */
  ejemplo?: string;
  /** Módulo de la página que debe montarse (la prueba compara la función real, no un texto). */
  pagina: () => Promise<Record<string, unknown>>;
  /** Exportación del módulo (por omisión `default`). */
  exportacion?: string;
  protegida: boolean;
  admin?: boolean;
};

export type RedireccionCandado = { path: string; destino: string };

export const RUTAS: RutaCandado[] = [
  // Públicas
  { path: "/", pagina: () => import("@/pages/Landing"), protegida: false },
  { path: "/auth", pagina: () => import("@/pages/Auth"), protegida: false },
  { path: "/reset-password", pagina: () => import("@/pages/ResetPassword"), protegida: false },
  { path: "/terminos", pagina: () => import("@/pages/Legal"), exportacion: "Terminos", protegida: false },
  { path: "/privacidad", pagina: () => import("@/pages/Legal"), exportacion: "Privacidad", protegida: false },
  { path: "/reembolsos", pagina: () => import("@/pages/Legal"), exportacion: "Reembolsos", protegida: false },
  { path: "/cookies", pagina: () => import("@/pages/Legal"), exportacion: "Cookies", protegida: false },
  { path: "/ayuda", pagina: () => import("@/pages/Legal"), exportacion: "Ayuda", protegida: false },
  { path: "/prive/edicion/sin-conexion", pagina: () => import("@/pages/prive/edition/EditionOfflinePage"), protegida: false },
  // Con sesión
  { path: "/onboarding", pagina: () => import("@/pages/Onboarding"), protegida: true },
  { path: "/onboarding/deep", pagina: () => import("@/pages/OnboardingDeep"), protegida: true },
  { path: "/dashboard", pagina: () => import("@/pages/DashboardHome"), protegida: true },
  { path: "/dashboard/planear", pagina: () => import("@/pages/PlanTrip"), protegida: true },
  { path: "/dashboard/ruta", pagina: () => import("@/pages/MultiDestRoute"), protegida: true },
  { path: "/dashboard/explorar", pagina: () => import("@/pages/ExploreDestinations"), protegida: true },
  { path: "/dashboard/viajes", pagina: () => import("@/pages/Trips"), protegida: true },
  { path: "/dashboard/viajes/importar", pagina: () => import("@/pages/ImportPastTrip"), protegida: true },
  { path: "/dashboard/viajes/:id", ejemplo: "/dashboard/viajes/v-1", pagina: () => import("@/pages/TripDetail"), protegida: true },
  { path: "/dashboard/viajes/:id/editar", ejemplo: "/dashboard/viajes/v-1/editar", pagina: () => import("@/pages/EditTrip"), protegida: true },
  { path: "/dashboard/viajes/:id/live", ejemplo: "/dashboard/viajes/v-1/live", pagina: () => import("@/pages/LiveTrip"), protegida: true },
  { path: "/dashboard/viajes/:id/mapa", ejemplo: "/dashboard/viajes/v-1/mapa", pagina: () => import("@/pages/TripMap"), protegida: true },
  { path: "/dashboard/viajes/:id/packing", ejemplo: "/dashboard/viajes/v-1/packing", pagina: () => import("@/pages/TripPacking"), protegida: true },
  { path: "/dashboard/viajes/:id/clima", ejemplo: "/dashboard/viajes/v-1/clima", pagina: () => import("@/pages/TripWeather"), protegida: true },
  { path: "/dashboard/viajes/:id/traductor", ejemplo: "/dashboard/viajes/v-1/traductor", pagina: () => import("@/pages/TripTranslator"), protegida: true },
  { path: "/dashboard/viajes/:id/diario", ejemplo: "/dashboard/viajes/v-1/diario", pagina: () => import("@/pages/TripJournal"), protegida: true },
  { path: "/dashboard/viajes/:id/split", ejemplo: "/dashboard/viajes/v-1/split", pagina: () => import("@/pages/TripSplit"), protegida: true },
  { path: "/dashboard/comparar", pagina: () => import("@/pages/Compare"), protegida: true },
  { path: "/dashboard/convertidor", pagina: () => import("@/pages/Currency"), protegida: true },
  { path: "/dashboard/vuelos", pagina: () => import("@/pages/TripFlights"), protegida: true },
  { path: "/dashboard/hoteles", pagina: () => import("@/pages/TripHotels"), protegida: true },
  { path: "/dashboard/seguros", pagina: () => import("@/pages/Insurance"), protegida: true },
  { path: "/dashboard/beneficios", pagina: () => import("@/pages/Benefits"), protegida: true },
  { path: "/dashboard/autos", pagina: () => import("@/pages/TripCars"), protegida: true },
  { path: "/dashboard/esim", pagina: () => import("@/pages/TripESIM"), protegida: true },
  { path: "/dashboard/actividades", pagina: () => import("@/pages/TripActivities"), protegida: true },
  { path: "/dashboard/restaurantes", pagina: () => import("@/pages/Restaurantes"), protegida: true },
  { path: "/dashboard/trenes", pagina: () => import("@/pages/Trenes"), protegida: true },
  { path: "/dashboard/ferries", pagina: () => import("@/pages/Ferries"), protegida: true },
  { path: "/dashboard/cruceros", pagina: () => import("@/pages/Cruceros"), protegida: true },
  { path: "/dashboard/reservas", pagina: () => import("@/pages/Reservas"), protegida: true },
  { path: "/dashboard/descubre", pagina: () => import("@/pages/Discover"), protegida: true },
  { path: "/dashboard/cercanos", pagina: () => import("@/pages/Cercanos"), protegida: true },
  { path: "/dashboard/favoritos", pagina: () => import("@/pages/Favoritos"), protegida: true },
  { path: "/dashboard/social", pagina: () => import("@/pages/Social"), protegida: true },
  { path: "/dashboard/social/amigo/:id", ejemplo: "/dashboard/social/amigo/a-1", pagina: () => import("@/pages/FriendProfile"), protegida: true },
  { path: "/dashboard/gastos", pagina: () => import("@/pages/Gastos"), protegida: true },
  { path: "/dashboard/recuerdos", pagina: () => import("@/pages/Recuerdos"), protegida: true },
  { path: "/dashboard/concierge", pagina: () => import("@/pages/Concierge"), protegida: true },
  { path: "/dashboard/pro", pagina: () => import("@/pages/Pro"), protegida: true },
  { path: "/dashboard/perfil", pagina: () => import("@/pages/Profile"), protegida: true },
  { path: "/wrapped", pagina: () => import("@/pages/Wrapped"), protegida: true },
  { path: "/wrapped/:year", ejemplo: "/wrapped/2026", pagina: () => import("@/pages/Wrapped"), protegida: true },
  // Administración (sesión + public.admins)
  { path: "/dashboard/admin", pagina: () => import("@/pages/AdminMetrics"), protegida: true, admin: true },
  { path: "/dashboard/admin/operaciones", pagina: () => import("@/pages/AdminOperations"), protegida: true, admin: true },
  { path: "/admin/operaciones", pagina: () => import("@/pages/AdminOperations"), protegida: true, admin: true },
  { path: "/dashboard/admin/edicion", pagina: () => import("@/pages/prive/edition/EditionAdminPage"), protegida: true, admin: true },
  // IATOS Privé (dentro de PriveRoot, que exige sesión)
  { path: "/prive", pagina: () => import("@/pages/prive/PriveHub"), protegida: true },
  { path: "/prive/invitacion", pagina: () => import("@/pages/prive/PriveInvitation"), protegida: true },
  { path: "/prive/mi", pagina: () => import("@/pages/prive/PriveMyPage"), protegida: true },
  { path: "/prive/membresia", pagina: () => import("@/pages/prive/PriveMembership"), protegida: true },
  { path: "/prive/explorar", pagina: () => import("@/pages/prive/PriveExplorePage"), protegida: true },
  { path: "/prive/key", pagina: () => import("@/pages/prive/PriveKeyPage"), protegida: true },
  { path: "/prive/drops", pagina: () => import("@/pages/prive/PriveDropsPage"), protegida: true },
  { path: "/prive/insider", pagina: () => import("@/pages/prive/PriveInsiderPage"), protegida: true },
  { path: "/prive/insider/:destino", ejemplo: "/prive/insider/paris", pagina: () => import("@/pages/prive/PriveInsiderPage"), protegida: true },
  { path: "/prive/restablecer", pagina: () => import("@/pages/prive/PriveReset"), protegida: true },
  { path: "/prive/destino/:slug", ejemplo: "/prive/destino/monaco", pagina: () => import("@/pages/prive/PriveDestinationPage"), protegida: true },
  { path: "/prive/universo/:key", ejemplo: "/prive/universo/gastronomia", pagina: () => import("@/pages/prive/PriveUniversePage"), protegida: true },
  { path: "/prive/experiencia/:slug", ejemplo: "/prive/experiencia/cena", pagina: () => import("@/pages/prive/PriveExperiencePage"), protegida: true },
  { path: "/prive/solicitudes", pagina: () => import("@/pages/prive/PriveRequestsPage"), protegida: true },
  { path: "/prive/edicion", pagina: () => import("@/pages/prive/edition/LatestIssuePage"), protegida: true },
  { path: "/prive/edicion/numero/:issue", ejemplo: "/prive/edicion/numero/7", pagina: () => import("@/pages/prive/edition/LatestIssuePage"), protegida: true },
  { path: "/prive/edicion/articulo/:slug", ejemplo: "/prive/edicion/articulo/monaco", pagina: () => import("@/pages/prive/edition/ArticlePage"), protegida: true },
  { path: "/prive/edicion/mi-edicion", pagina: () => import("@/pages/prive/edition/MyEditionPage"), protegida: true },
  { path: "/prive/edicion/briefing", pagina: () => import("@/pages/prive/edition/WorldBriefPage"), protegida: true },
  { path: "/prive/edicion/oportunidades", pagina: () => import("@/pages/prive/edition/OpportunitiesPage"), protegida: true },
  { path: "/prive/edicion/vuelo", pagina: () => import("@/pages/prive/edition/FlightEditionPage"), protegida: true },
  { path: "/prive/edicion/biblioteca", pagina: () => import("@/pages/prive/edition/LibraryPage"), protegida: true },
  // Cualquier otra dirección
  { path: "*", ejemplo: "/no-existe-esta-pagina", pagina: () => import("@/pages/NotFound"), protegida: false },
];

/** Enlaces viejos (correos, marcadores) que deben seguir llegando a su pantalla. */
export const REDIRECCIONES: RedireccionCandado[] = [
  { path: "/faq", destino: "/ayuda" },
  { path: "/precios", destino: "/ayuda#planes" },
  { path: "/dashboard/smart-spend", destino: "/dashboard/gastos" },
  { path: "/dashboard/members", destino: "/dashboard/concierge?tab=members" },
];

/** Menú lateral (escritorio): cada destino debe seguir ahí. */
export const MENU_LATERAL = [
  "/dashboard", "/dashboard/viajes", "/dashboard/cercanos", "/dashboard/favoritos", "/dashboard/recuerdos",
  "/dashboard/social", "/dashboard/gastos", "/dashboard/reservas", "/dashboard/beneficios", "/dashboard/concierge",
] as const;

/** Fuera de la lista del menú lateral, pero en la misma barra: Planear (botón dorado), PRO, Privé y Ayuda. */
export const MENU_LATERAL_EXTRAS = ["/dashboard/planear", "/dashboard/pro", "/prive", "/ayuda"] as const;

/** Barra inferior del celular: Inicio, Viajes, Planear (botón dorado del centro), Concierge y "Más". */
export const BARRA_INFERIOR = ["/dashboard", "/dashboard/viajes", "/dashboard/planear", "/dashboard/concierge"] as const;

/** Hoja "Más" del celular. */
export const MENU_MAS = [
  "/dashboard/cercanos", "/dashboard/favoritos", "/dashboard/recuerdos", "/dashboard/social", "/dashboard/gastos",
  "/dashboard/reservas", "/dashboard/beneficios", "/dashboard/pro", "/prive", "/dashboard/perfil", "/ayuda",
] as const;

/** Herramientas de Iato (concierge-chat/toolDefs.ts). Si una desaparece, Iato deja de poder hacerla. */
export const HERRAMIENTAS_IATO = [
  "check_flight_status", // ¿mi vuelo va a tiempo?
  "search_flights", // vuelos con precio real
  "search_hotels", // hoteles con precio real
  "search_places", // lugares y restaurantes (Google)
  "search_nearby", // cerca de mí (hospital, policía, restaurantes)
  "web_search", // dato práctico con fuente
  "get_travel_advisory", // avisos de viaje (Departamento de Estado)
  "get_weather", // clima (MET Norway / NASA POWER)
  "get_local_time", // hora local
  "search_events", // eventos
  "search_tours", // tours y experiencias (Viator)
  "search_attractions", // ranking de la ciudad (TripAdvisor)
  "search_members_venues", // lugares solo para miembros
  "search_prive", // catálogo de IATOS Privé
] as const;

/** Pestañas de Iato (Concierge): chat, Solo para miembros y Mis solicitudes (mesa de operaciones). */
export const PESTANAS_IATO = ["chat", "members", "solicitudes"] as const;
