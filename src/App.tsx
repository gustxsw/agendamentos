import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";

// Layouts
import MainLayout from "./layouts/MainLayout";
import AuthLayout from "./layouts/AuthLayout";

// Pages
import LoginPage from "./pages/LoginPage";
import RoleSelectionPage from "./pages/RoleSelectionPage";
import RegisterPage from "./pages/RegisterPage";
import ClientHomePage from "./pages/client/ClientHomePage";
import ProfessionalsPage from "./pages/client/ProfessionalsPage";
import ProfessionalHomePage from "./pages/professional/ProfessionalHomePage";
import UnifiedConsultationPage from "./pages/professional/UnifiedConsultationPage";
import AgendaPage from "./pages/professional/AgendaPage";
import PatientsPage from "./pages/professional/PatientsPage";
import AdminHomePage from "./pages/admin/AdminHomePage";
import ManageUsersPage from "./pages/admin/ManageUsersPage";
import ManageServicesPage from "./pages/admin/ManageServicesPage";
import ReportsPage from "./pages/admin/ReportsPage";

// Enhanced pages
import MedicalRecordsPage from "./pages/professional/MedicalRecordsPage";
import ProfilePage from "./pages/professional/ProfilePage";
import EnhancedAgendaPage from "./pages/professional/EnhancedAgendaPage";
import EnhancedPatientsPage from "./pages/professional/EnhancedPatientsPage";
import EnhancedReportsPage from "./pages/professional/EnhancedReportsPage";
import DocumentsPage from "./pages/professional/DocumentsPage";
import EnhancedAdminReportsPage from "./pages/admin/EnhancedReportsPage";

// 🔥 NEW: Clinic pages
import ClinicHomePage from "./pages/clinic/ClinicHomePage";
import ClinicProfessionalsPage from "./pages/clinic/ClinicProfessionalsPage";
import ClinicConsultationPage from "./pages/clinic/ClinicConsultationPage";
import ClinicAgendaPage from "./pages/clinic/ClinicAgendaPage";
import ClinicPatientsPage from "./pages/clinic/ClinicPatientsPage";
import ClinicMedicalRecordsPage from "./pages/clinic/ClinicMedicalRecordsPage";
import ClinicReportsPage from "./pages/clinic/ClinicReportsPage";
import ClinicProfilePage from "./pages/clinic/ClinicProfilePage";

// Route guards
const ProtectedRoute = ({
  children,
  allowedRoles,
}: {
  children: React.ReactNode;
  allowedRoles: string[];
}) => {
  const { user, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (
    allowedRoles.length > 0 &&
    user &&
    !allowedRoles.includes(user.currentRole || "")
  ) {
    // Redirect to appropriate home page based on current role
    if (user.currentRole === "client") {
      return <Navigate to="/client" replace />;
    } else if (user.currentRole === "professional") {
      return <Navigate to="/professional" replace />;
    } else if (user.currentRole === "clinic") {
      return <Navigate to="/clinic" replace />;
    } else if (user.currentRole === "admin") {
      return <Navigate to="/admin" replace />;
    }
  }

  return <>{children}</>;
};

function App() {
  const { user, isAuthenticated, isLoading } = useAuth();

  // Show loading while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* ROOT ROUTE - SEMPRE LOGIN */}
      <Route path="/" element={<LoginPage />} />

      {/* Auth routes */}
      <Route element={<AuthLayout />}>
        <Route path="/select-role" element={<RoleSelectionPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Client routes */}
      <Route
        element={
          <ProtectedRoute allowedRoles={["client"]}>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/client" element={<ClientHomePage />} />
        <Route path="/client/professionals" element={<ProfessionalsPage />} />
      </Route>

      {/* Professional routes */}
      <Route
        element={
          <ProtectedRoute allowedRoles={["professional"]}>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/professional" element={<ProfessionalHomePage />} />
        <Route
          path="/professional/register-consultation"
          element={<UnifiedConsultationPage />}
        />
        <Route path="/professional/agenda" element={<EnhancedAgendaPage />} />
        <Route path="/professional/patients" element={<EnhancedPatientsPage />} />
        <Route path="/professional/medical-records" element={<MedicalRecordsPage />} />
        <Route path="/professional/medical-records/:patientId" element={<MedicalRecordsPage />} />
        <Route path="/professional/documents" element={<DocumentsPage />} />
        <Route path="/professional/reports" element={<EnhancedReportsPage />} />
        <Route path="/professional/profile" element={<ProfilePage />} />
      </Route>

      {/* 🔥 NEW: Clinic routes */}
      <Route
        element={
          <ProtectedRoute allowedRoles={["clinic"]}>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/clinic" element={<ClinicHomePage />} />
        <Route path="/clinic/professionals" element={<ClinicProfessionalsPage />} />
        <Route path="/clinic/register-consultation" element={<ClinicConsultationPage />} />
        <Route path="/clinic/agenda" element={<ClinicAgendaPage />} />
        <Route path="/clinic/patients" element={<ClinicPatientsPage />} />
        <Route path="/clinic/medical-records" element={<ClinicMedicalRecordsPage />} />
        <Route path="/clinic/medical-records/:patientId" element={<ClinicMedicalRecordsPage />} />
        <Route path="/clinic/reports" element={<ClinicReportsPage />} />
        <Route path="/clinic/profile" element={<ClinicProfilePage />} />
      </Route>

      {/* Admin routes */}
      <Route
        element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminHomePage />} />
        <Route path="/admin/users" element={<ManageUsersPage />} />
        <Route path="/admin/services" element={<ManageServicesPage />} />
        <Route path="/admin/reports" element={<EnhancedAdminReportsPage />} />
      </Route>

      {/* CATCH-ALL - QUALQUER ROTA DESCONHECIDA VAI PARA LOGIN */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;