import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import AuthGuard from "./auth/AuthGuard";
import DayPage from "./pages/DayPage";
import LoginPage from "./pages/LoginPage";
import SearchPage from "./pages/SearchPage";
import WeekPage from "./pages/WeekPage";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route path="/" element={<DayPage />} />
            <Route path="/week" element={<WeekPage />} />
            <Route path="/search" element={<SearchPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
