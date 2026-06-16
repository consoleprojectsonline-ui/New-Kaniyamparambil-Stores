import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "@/pages/auth/LoginPage";
import RegisterPage from "@/pages/auth/RegisterPage";

// Placeholder for app layout — to be built in next phase
function AppPlaceholder() {
  return (
    <div className="flex items-center justify-center h-screen bg-background">
      <div className="text-center">
        <div className="text-page-title font-semibold text-text-primary mb-2">
          New Kaniyamparambil Stores
        </div>
        <p className="text-text-secondary text-sm">Dashboard coming soon…</p>
      </div>
    </div>
  );
}

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/app/*"    element={<AppPlaceholder />} />
        <Route path="*"         element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
