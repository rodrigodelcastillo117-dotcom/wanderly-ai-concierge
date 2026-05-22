import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import DashboardHome from "./pages/DashboardHome";
import PlanTrip from "./pages/PlanTrip";
import TripDetail from "./pages/TripDetail";
import EditTrip from "./pages/EditTrip";
import Trips from "./pages/Trips";
import Profile from "./pages/Profile";
import Discover from "./pages/Discover";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner theme="dark" />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardHome /></ProtectedRoute>} />
            <Route path="/dashboard/planear" element={<ProtectedRoute><PlanTrip /></ProtectedRoute>} />
            <Route path="/dashboard/viajes" element={<ProtectedRoute><Trips /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id" element={<ProtectedRoute><TripDetail /></ProtectedRoute>} />
            <Route path="/dashboard/viajes/:id/editar" element={<ProtectedRoute><EditTrip /></ProtectedRoute>} />
            <Route path="/dashboard/descubre" element={<ProtectedRoute><Discover /></ProtectedRoute>} />
            <Route path="/dashboard/perfil" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
