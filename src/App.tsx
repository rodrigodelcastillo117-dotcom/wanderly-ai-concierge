import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import ScrollToTop from "@/components/ScrollToTop";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import DashboardHome from "./pages/DashboardHome";
import PlanTrip from "./pages/PlanTrip";
import TripDetail from "./pages/TripDetail";
import EditTrip from "./pages/EditTrip";
import Trips from "./pages/Trips";
import MultiDestRoute from "./pages/MultiDestRoute";
import Profile from "./pages/Profile";
import Discover from "./pages/Discover";
import { Pro } from "./pages/SoonPages";
import Concierge from "./pages/Concierge";
import Cercanos from "./pages/Cercanos";
import Favoritos from "./pages/Favoritos";
import Social from "./pages/Social";
import { Navigate } from "react-router-dom";
import Gastos from "./pages/Gastos";
import NotFound from "./pages/NotFound.tsx";
import LiveTrip from "./pages/LiveTrip";
import TripMap from "./pages/TripMap";
import TripPacking from "./pages/TripPacking";
import TripWeather from "./pages/TripWeather";
import TripTranslator from "./pages/TripTranslator";
import TripJournal from "./pages/TripJournal";
import TripSplit from "./pages/TripSplit";
import Compare from "./pages/Compare";
import Currency from "./pages/Currency";
import TripFlights from "./pages/TripFlights";
import TripHotels from "./pages/TripHotels";
import Insurance from "./pages/Insurance";
import Benefits from "./pages/Benefits";
import TripCars from "./pages/TripCars";
import TripESIM from "./pages/TripESIM";
import TripActivities from "./pages/TripActivities";
import Restaurantes from "./pages/Restaurantes";
import Trenes from "./pages/Trenes";
import Ferries from "./pages/Ferries";
import Cruceros from "./pages/Cruceros";
import Reservas from "./pages/Reservas";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner theme="dark" />
      <BrowserRouter>
        <ScrollToTop />
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
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

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
