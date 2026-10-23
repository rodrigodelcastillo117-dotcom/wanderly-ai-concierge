import { Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { LazyToaster } from "@/components/ui/toaster-lazy";
import { AuthProvider } from "@/contexts/AuthContext";
import { OnboardingProvider } from "@/hooks/useOnboardingStatus";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import ScrollToTop from "@/components/ScrollToTop";
import { CookieBanner } from "@/components/CookieBanner";
import { ReferralCapture } from "@/components/ReferralCapture";
import { lazyWithRetry } from "@/lib/lazyRetry";
import Landing from "./pages/Landing";
import { FreeLimitDialogLazyHost } from "@/components/FreeLimitDialogLazy";
import { Navigate } from "react-router-dom";
import { loadAuth, loadConcierge, loadDashboardHome, loadTripDetail, loadTrips } from "@/lib/routeChunks";

// Code-splitting: todo lo que no es la landing se carga bajo demanda por ruta.
// El bundle único pesaba >4.4MB; esto reparte el peso en chunks por página.
const Auth = lazyWithRetry(loadAuth);
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const Onboarding = lazyWithRetry(() => import("./pages/Onboarding"));
const OnboardingDeep = lazyWithRetry(() => import("./pages/OnboardingDeep"));
const DashboardHome = lazyWithRetry(loadDashboardHome);
const PlanTrip = lazyWithRetry(() => import("./pages/PlanTrip"));
const ExploreDestinations = lazyWithRetry(() => import("./pages/ExploreDestinations"));
const TripDetail = lazyWithRetry(loadTripDetail);
const EditTrip = lazyWithRetry(() => import("./pages/EditTrip"));
const Trips = lazyWithRetry(loadTrips);
const ImportPastTrip = lazyWithRetry(() => import("./pages/ImportPastTrip"));
const MultiDestRoute = lazyWithRetry(() => import("./pages/MultiDestRoute"));
const Profile = lazyWithRetry(() => import("./pages/Profile"));
const Discover = lazyWithRetry(() => import("./pages/Discover"));
const Pro = lazyWithRetry(() => import("./pages/Pro"));
const AdminMetrics = lazyWithRetry(() => import("./pages/AdminMetrics"));
const Concierge = lazyWithRetry(loadConcierge);
const Cercanos = lazyWithRetry(() => import("./pages/Cercanos"));
const Favoritos = lazyWithRetry(() => import("./pages/Favoritos"));
const Social = lazyWithRetry(() => import("./pages/Social"));
const FriendProfile = lazyWithRetry(() => import("./pages/FriendProfile"));
const Gastos = lazyWithRetry(() => import("./pages/Gastos"));
// Recuerdos: fotos y videos por fecha y viaje (calendario y álbumes).
const Recuerdos = lazyWithRetry(() => import("./pages/Recuerdos"));
// IATOS Wrapped ("Tu año en viajes"): pantalla completa tipo stories, su propio chunk.
const Wrapped = lazyWithRetry(() => import("./pages/Wrapped"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound.tsx"));
// ── IATOS Privé · catálogo (grupo catalog). El hub /prive y su candado los pone el grupo ui. ──
const PriveDestinationPage = lazyWithRetry(() => import("./pages/prive/PriveDestinationPage"));
const PriveUniversePage = lazyWithRetry(() => import("./pages/prive/PriveUniversePage"));
const PriveExperiencePage = lazyWithRetry(() => import("./pages/prive/PriveExperiencePage"));
const PriveRequestsPage = lazyWithRetry(() => import("./pages/prive/PriveRequestsPage"));
// ── IATOS Privé · seis áreas (Documento B §4). EXPLORE y MY PRIVÉ son de prive-ux; THE KEY de privekey;
// DROPS e INSIDER de privevalor (mientras tanto, páginas "en preparación" con la misma ruta). ──
const PriveExplorePage = lazyWithRetry(() => import("./pages/prive/PriveExplorePage"));
const PriveMyPage = lazyWithRetry(() => import("./pages/prive/PriveMyPage"));
const PriveKeyPage = lazyWithRetry(() => import("./pages/prive/PriveKeyPage"));
const PriveDropsPage = lazyWithRetry(() => import("./pages/prive/PriveDropsPage"));
const PriveInsiderPage = lazyWithRetry(() => import("./pages/prive/PriveInsiderPage"));
// ── THE PRIVATE EDITION (equipo edition): revista de Privé, lectura sin conexión y panel editorial ──
const EditionRoot = lazyWithRetry(() => import("./pages/prive/edition/EditionRoot"));
const EditionLatestIssue = lazyWithRetry(() => import("./pages/prive/edition/LatestIssuePage"));
const EditionArticle = lazyWithRetry(() => import("./pages/prive/edition/ArticlePage"));
const EditionMine = lazyWithRetry(() => import("./pages/prive/edition/MyEditionPage"));
const EditionWorldBrief = lazyWithRetry(() => import("./pages/prive/edition/WorldBriefPage"));
const EditionOpportunities = lazyWithRetry(() => import("./pages/prive/edition/OpportunitiesPage"));
const EditionFlight = lazyWithRetry(() => import("./pages/prive/edition/FlightEditionPage"));
const EditionLibrary = lazyWithRetry(() => import("./pages/prive/edition/LibraryPage"));
const EditionOffline = lazyWithRetry(() => import("./pages/prive/edition/EditionOfflinePage"));
const EditionAdmin = lazyWithRetry(() => import("./pages/prive/edition/EditionAdminPage"));
// ── fin IATOS Privé · catálogo ──
const LiveTrip = lazyWithRetry(() => import("./pages/LiveTrip"));
const TripMap = lazyWithRetry(() => import("./pages/TripMap"));
const TripPacking = lazyWithRetry(() => import("./pages/TripPacking"));
const TripWeather = lazyWithRetry(() => import("./pages/TripWeather"));
const TripTranslator = lazyWithRetry(() => import("./pages/TripTranslator"));
const TripJournal = lazyWithRetry(() => import("./pages/TripJournal"));
const TripSplit = lazyWithRetry(() => import("./pages/TripSplit"));
const Compare = lazyWithRetry(() => import("./pages/Compare"));
const Currency = lazyWithRetry(() => import("./pages/Currency"));
const TripFlights = lazyWithRetry(() => import("./pages/TripFlights"));
const TripHotels = lazyWithRetry(() => import("./pages/TripHotels"));
const Insurance = lazyWithRetry(() => import("./pages/Insurance"));
const Benefits = lazyWithRetry(() => import("./pages/Benefits"));
const TripCars = lazyWithRetry(() => import("./pages/TripCars"));
const TripESIM = lazyWithRetry(() => import("./pages/TripESIM"));
const TripActivities = lazyWithRetry(() => import("./pages/TripActivities"));
const Restaurantes = lazyWithRetry(() => import("./pages/Restaurantes"));
const Trenes = lazyWithRetry(() => import("./pages/Trenes"));
const Ferries = lazyWithRetry(() => import("./pages/Ferries"));
const Cruceros = lazyWithRetry(() => import("./pages/Cruceros"));
const Reservas = lazyWithRetry(() => import("./pages/Reservas"));
const Terminos = lazyWithRetry(() => import("./pages/Legal").then((m) => ({ default: m.Terminos })));
const Privacidad = lazyWithRetry(() => import("./pages/Legal").then((m) => ({ default: m.Privacidad })));
const Cookies = lazyWithRetry(() => import("./pages/Legal").then((m) => ({ default: m.Cookies })));
const Reembolsos = lazyWithRetry(() => import("./pages/Legal").then((m) => ({ default: m.Reembolsos })));
// IATOS Privé: cada pantalla en su propio chunk (la ceremonia y la bienvenida no pesan en el hub ni
// en el resto de la app). PriveRoot trae el estado Privé, la tipografía y el CSS propio.
const PriveRoot = lazyWithRetry(() => import("./pages/prive/PriveRoot"));
const PriveHub = lazyWithRetry(() => import("./pages/prive/PriveHub"));
const PriveInvitation = lazyWithRetry(() => import("./pages/prive/PriveInvitation"));
const PriveMembership = lazyWithRetry(() => import("./pages/prive/PriveMembership"));
const PriveReset = lazyWithRetry(() => import("./pages/prive/PriveReset"));

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

const App = () => (
  <AppErrorBoundary>
      <LazyToaster />
      <Sonner theme="dark" />
      <BrowserRouter>
        <ScrollToTop />
        <CookieBanner />
        <ReferralCapture />
        <FreeLimitDialogLazyHost />
        <AuthProvider>
          <OnboardingProvider>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/terminos" element={<Terminos />} />
            <Route path="/privacidad" element={<Privacidad />} />
            <Route path="/reembolsos" element={<Reembolsos />} />
            <Route path="/cookies" element={<Cookies />} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/onboarding/deep" element={<ProtectedRoute><OnboardingDeep /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
            <Route path="/dashboard/planear" element={<ProtectedRoute><PlanTrip /></ProtectedRoute>} />
            <Route path="/dashboard/ruta" element={<ProtectedRoute><MultiDestRoute /></ProtectedRoute>} />
            <Route path="/dashboard/explorar" element={<ProtectedRoute><ExploreDestinations /></ProtectedRoute>} />
            <Route path="/dashboard/viajes" element={<ProtectedRoute><Trips /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/importar" element={<ProtectedRoute><ImportPastTrip /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id" element={<ProtectedRoute><TripDetail /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/editar" element={<ProtectedRoute><EditTrip /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/live" element={<ProtectedRoute><LiveTrip /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/mapa" element={<ProtectedRoute><TripMap /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/packing" element={<ProtectedRoute><TripPacking /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/clima" element={<ProtectedRoute><TripWeather /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/traductor" element={<ProtectedRoute><TripTranslator /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/diario" element={<ProtectedRoute><TripJournal /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/split" element={<ProtectedRoute><TripSplit /></ProtectedRoute>} />
            <Route path="/dashboard/comparar" element={<ProtectedRoute><Compare /></ProtectedRoute>} />
            <Route path="/dashboard/convertidor" element={<ProtectedRoute><Currency /></ProtectedRoute>} />
            <Route path="/dashboard/vuelos" element={<ProtectedRoute><TripFlights /></ProtectedRoute>} />
            <Route path="/dashboard/hoteles" element={<ProtectedRoute><TripHotels /></ProtectedRoute>} />
            <Route path="/dashboard/seguros" element={<ProtectedRoute><Insurance /></ProtectedRoute>} />
            <Route path="/dashboard/beneficios" element={<ProtectedRoute><Benefits /></ProtectedRoute>} />
            <Route path="/dashboard/autos" element={<ProtectedRoute><TripCars /></ProtectedRoute>} />
            <Route path="/dashboard/esim" element={<ProtectedRoute><TripESIM /></ProtectedRoute>} />
            <Route path="/dashboard/actividades" element={<ProtectedRoute><TripActivities /></ProtectedRoute>} />
            <Route path="/dashboard/restaurantes" element={<ProtectedRoute><Restaurantes /></ProtectedRoute>} />
            <Route path="/dashboard/trenes" element={<ProtectedRoute><Trenes /></ProtectedRoute>} />
            <Route path="/dashboard/ferries" element={<ProtectedRoute><Ferries /></ProtectedRoute>} />
            <Route path="/dashboard/cruceros" element={<ProtectedRoute><Cruceros /></ProtectedRoute>} />
            <Route path="/dashboard/reservas" element={<ProtectedRoute><Reservas /></ProtectedRoute>} />
            <Route path="/dashboard/descubre" element={<ProtectedRoute><Discover /></ProtectedRoute>} />
            <Route path="/dashboard/cercanos" element={<ProtectedRoute><Cercanos /></ProtectedRoute>} />
            <Route path="/dashboard/favoritos" element={<ProtectedRoute><Favoritos /></ProtectedRoute>} />
            <Route path="/dashboard/social" element={<ProtectedRoute><Social /></ProtectedRoute>} />
            <Route path="/dashboard/social/amigo/:id" element={<ProtectedRoute><FriendProfile /></ProtectedRoute>} />
            <Route path="/dashboard/smart-spend" element={<Navigate to="/dashboard/gastos" replace />} />
            <Route path="/dashboard/gastos" element={<ProtectedRoute><Gastos /></ProtectedRoute>} />
            <Route path="/dashboard/recuerdos" element={<ProtectedRoute><Recuerdos /></ProtectedRoute>} />
            <Route path="/dashboard/concierge" element={<ProtectedRoute><Concierge /></ProtectedRoute>} />
            <Route path="/dashboard/pro" element={<ProtectedRoute><Pro /></ProtectedRoute>} />
            <Route path="/dashboard/admin" element={<ProtectedRoute><AdminMetrics /></ProtectedRoute>} />
            {/* Panel editorial de THE PRIVATE EDITION: el servidor exige public.admins en cada RPC. */}
            <Route path="/dashboard/admin/edicion" element={<ProtectedRoute><EditionAdmin /></ProtectedRoute>} />
            <Route path="/dashboard/perfil" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/wrapped" element={<ProtectedRoute><Wrapped /></ProtectedRoute>} />
            <Route path="/wrapped/:year" element={<ProtectedRoute><Wrapped /></ProtectedRoute>} />
            <Route path="/dashboard/members" element={<Navigate to="/dashboard/concierge?tab=members" replace />} />
            {/* THE PRIVATE EDITION sin conexión: fuera de ProtectedRoute (en modo avión la sesión no se puede
                renovar). No llama a la red; solo lee las copias que este usuario guardó en este dispositivo. */}
            <Route path="/prive/edicion/sin-conexion" element={<EditionOffline />} />
            {/* Sin sesión de IATOS, ProtectedRoute manda a /auth y regresa aquí. El #t=… de la
                invitación ya se quitó de la URL (priveSession.ts) y no viaja en state.from. */}
            <Route path="/prive" element={<ProtectedRoute><PriveRoot /></ProtectedRoute>}>
              <Route index element={<PriveHub />} />
              <Route path="invitacion" element={<PriveInvitation />} />
              {/* MY PRIVÉ: /prive/mi; /prive/membresia se conserva (mismas secciones, enlaces viejos y correos). */}
              <Route path="mi" element={<PriveMyPage />} />
              <Route path="membresia" element={<PriveMembership />} />
              <Route path="explorar" element={<PriveExplorePage />} />
              <Route path="key" element={<PriveKeyPage />} />
              <Route path="drops" element={<PriveDropsPage />} />
              <Route path="insider" element={<PriveInsiderPage />} />
              <Route path="insider/:destino" element={<PriveInsiderPage />} />
              <Route path="restablecer" element={<PriveReset />} />
              {/* ── IATOS Privé · catálogo (grupo catalog): dentro de PriveRoot (sesión, candado y estilo);
                  el servidor exige la sesión Privé en cada RPC ── */}
              <Route path="destino/:slug" element={<PriveDestinationPage />} />
              <Route path="universo/:key" element={<PriveUniversePage />} />
              <Route path="experiencia/:slug" element={<PriveExperiencePage />} />
              <Route path="solicitudes" element={<PriveRequestsPage />} />
              {/* ── fin IATOS Privé · catálogo ── */}
              {/* ── THE PRIVATE EDITION (equipo edition) ── */}
              <Route path="edicion" element={<EditionRoot />}>
                <Route index element={<EditionLatestIssue />} />
                <Route path="numero/:issue" element={<EditionLatestIssue />} />
                <Route path="articulo/:slug" element={<EditionArticle />} />
                <Route path="mi-edicion" element={<EditionMine />} />
                <Route path="briefing" element={<EditionWorldBrief />} />
                <Route path="oportunidades" element={<EditionOpportunities />} />
                <Route path="vuelo" element={<EditionFlight />} />
                <Route path="biblioteca" element={<EditionLibrary />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </OnboardingProvider>
        </AuthProvider>
      </BrowserRouter>
  </AppErrorBoundary>
);

export default App;
