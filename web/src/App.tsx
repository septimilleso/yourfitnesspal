import { BrowserRouter, Route, Routes } from "react-router-dom";

import AuthGuard from "./auth/AuthGuard";
import DayPage from "./pages/DayPage";
import LoginPage from "./pages/LoginPage";
import SearchPage from "./pages/SearchPage";
import WeekPage from "./pages/WeekPage";

function App() {
  return (
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
  );
}

export default App;
