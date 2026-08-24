import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import ScrollToTop from "@/components/ScrollToTop";
import { lazyWithRetry } from "@/lib/lazyRetry";
import Landing from "./pages/Landing";
import { Navigate } from "react-router-dom";

// Code-splitting: todo lo que no es la landing se carga bajo demanda por ruta.
// El bundle único pesaba >4.4MB; esto reparte el peso en chunks por página.
const Auth = lazyWithRetry(() => import("./pages/Auth"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const Onboarding = lazyWithRetry(() => import("./pages/Onboarding"));
const OnboardingDeep = lazyWithRetry(() => import("./pages/OnboardingDeep"));
const DashboardHome = lazyWithRetry(() => import("./pages/DashboardHome"));
const PlanTrip = lazyWithRetry(() => import("./pages/PlanTrip"));
const TripDetail = lazyWithRetry(() => import("./pages/TripDetail"));
const EditTrip = lazyWithRetry(() => import("./pages/EditTrip"));
const Trips = lazyWithRetry(() => import("./pages/Trips"));
const MultiDestRoute = lazyWithRetry(() => import("./pages/MultiDestRoute"));
const Profile = lazyWithRetry(() => import("./pages/Profile"));
const Discover = lazyWithRetry(() => import("./pages/Discover"));
const Pro = lazyWithRetry(() => import("./pages/Pro"));
const Concierge = lazyWithRetry(() => import("./pages/Concierge"));
const Cercanos = lazyWithRetry(() => import("./pages/Cercanos"));
const Favoritos = lazyWithRetry(() => import("./pages/Favoritos"));
const Social = lazyWithRetry(() => import("./pages/Social"));
const Gastos = lazyWithRetry(() => import("./pages/Gastos"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound.tsx"));
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

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

const queryClient = new QueryClient();

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner theme="dark" />
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
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
            <Route path="/dashboard/viajes" element={<ProtectedRoute><Trips /></ProtectedRoute>} />
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
            <Route path="/dashboard/smart-spend" element={<Navigate to="/dashboard/gastos" replace />} />
            <Route path="/dashboard/gastos" element={<ProtectedRoute><Gastos /></ProtectedRoute>} />
            <Route path="/dashboard/concierge" element={<ProtectedRoute><Concierge /></ProtectedRoute>} />
            <Route path="/dashboard/pro" element={<ProtectedRoute><Pro /></ProtectedRoute>} />
            <Route path="/dashboard/perfil" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/dashboard/members" element={<Navigate to="/dashboard/concierge?tab=members" replace />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
