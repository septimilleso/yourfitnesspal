import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useParams } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext";
import AdminGuard from "./auth/AdminGuard";
import AuthGuard from "./auth/AuthGuard";
import PermissionGuard from "./auth/PermissionGuard";
import AppShell from "./components/AppShell";
import { queryClient } from "./lib/queryClient";
import NativeBridge from "./native/NativeBridge";
import NativeOfflineServices from "./native/NativeOfflineServices";
import AccountPage from "./pages/AccountPage";
import AdminUsersPage from "./pages/admin/AdminUsersPage";
import DayPage from "./pages/DayPage";
import ExercisesPage from "./pages/gym/ExercisesPage";
import GymStartPage from "./pages/gym/GymStartPage";
import GymStatsPage from "./pages/gym/GymStatsPage";
import HistoryPage from "./pages/gym/HistoryPage";
import LocalWorkoutDetailPage from "./pages/gym/LocalWorkoutDetailPage";
import TemplateEditorPage from "./pages/gym/TemplateEditorPage";
import WorkoutDetailPage from "./pages/gym/WorkoutDetailPage";
import WorkoutPage from "./pages/gym/WorkoutPage";
import LoginPage from "./pages/LoginPage";
import ConnectPage from "./pages/ConnectPage";
import DietStatsPage from "./pages/DietStatsPage";
import SearchPage from "./pages/SearchPage";
import SavedWeekDetailPage from "./pages/SavedWeekDetailPage";
import SavedWeeksPage from "./pages/SavedWeeksPage";
import SettingsPage from "./pages/SettingsPage";
import WeekPage from "./pages/WeekPage";

function TemplateEditorRoute() {
  const { id } = useParams();
  return <TemplateEditorPage key={id ?? "new"} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
        <NativeBridge />
        <NativeOfflineServices />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/connect" element={<ConnectPage />} />
          <Route element={<AuthGuard />}>
            <Route element={<PermissionGuard permission="workouts.use" />}>
              <Route path="/gym/workout" element={<WorkoutPage />} />
            </Route>
            <Route element={<AppShell />}>
              <Route path="/" element={<DayPage />} />
              <Route path="/week" element={<WeekPage />} />
              <Route element={<PermissionGuard permission="diary.copy" />}>
                <Route path="/week/saved" element={<SavedWeeksPage />} />
                <Route path="/week/saved/:id" element={<SavedWeekDetailPage />} />
              </Route>
              <Route path="/search" element={<SearchPage />} />
              <Route path="/stats" element={<DietStatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route element={<PermissionGuard permission="workouts.use" />}>
                <Route path="/gym" element={<GymStartPage />} />
                <Route path="/gym/exercises" element={<ExercisesPage />} />
                <Route path="/gym/history" element={<HistoryPage />} />
                <Route path="/gym/history/local/:uuid" element={<LocalWorkoutDetailPage />} />
                <Route path="/gym/history/:id" element={<WorkoutDetailPage />} />
                <Route path="/gym/stats" element={<GymStatsPage />} />
                <Route path="/gym/templates/new" element={<TemplateEditorRoute />} />
                <Route path="/gym/templates/:id" element={<TemplateEditorRoute />} />
              </Route>
              <Route element={<AdminGuard />}>
                <Route path="/admin/users" element={<AdminUsersPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
