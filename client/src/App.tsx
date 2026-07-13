import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./routes/Login";
import AppLayout from "./components/AppLayout";
import BrandMark from "./components/BrandMark";

const OverviewTab = lazy(() => import("./routes/OverviewTab"));
const SheetsTab = lazy(() => import("./routes/SheetsTab"));
const TrackingTab = lazy(() => import("./routes/TrackingTab"));
const ActivityTab = lazy(() => import("./routes/ActivityTab"));
const SheetDetail = lazy(() => import("./routes/SheetDetail"));
const SettingsLayout = lazy(() => import("./routes/settings/SettingsLayout"));
const AppearancePage = lazy(() => import("./routes/settings/AppearancePage"));
const NotificationsPage = lazy(() => import("./routes/settings/NotificationsPage"));
const IntegrationsPage = lazy(() => import("./routes/settings/IntegrationsPage"));
const AccountPage = lazy(() => import("./routes/settings/AccountPage"));
const ReportsPage = lazy(() => import("./routes/settings/ReportsPage"));
const SharesPage = lazy(() => import("./routes/settings/SharesPage"));
const ShareView = lazy(() => import("./routes/ShareView"));
import { PrefsProvider, usePrefs } from "./providers/PrefsProvider";
import { MotionProvider } from "./providers/MotionProvider";
import { installSoundUnlock } from "./lib/sound";
import { getMe } from "./lib/auth";
import { User } from "./types";

function LandingRedirect() {
  const { prefs } = usePrefs();
  return <Navigate to={prefs.landingTab} replace />;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    getMe().then(setUser);
    installSoundUnlock();
  }, []);

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex items-center gap-2 opacity-60">
          <BrandMark className="h-5 w-5 animate-pulse" />
          <span className="font-mono text-sm text-ink-400">loading…</span>
        </div>
      </div>
    );
  }

  return (
    <PrefsProvider>
      <MotionProvider>
        <BrowserRouter>
          <Suspense fallback={null}>
        <Routes>
          {/* Public share boards render with or without a session. */}
          <Route path="/share/:token" element={<ShareView />} />
          <Route
            path="/login"
            element={user ? <LandingRedirect /> : <Login />}
          />
          {user ? (
            <Route element={<AppLayout user={user} />}>
              <Route path="/overview" element={<OverviewTab />} />
              <Route path="/sheets" element={<SheetsTab />} />
              <Route path="/tracking" element={<TrackingTab />} />
              <Route path="/activity" element={<ActivityTab />} />
              <Route path="/history/:id" element={<SheetDetail />} />
              <Route path="/settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="/settings/appearance" replace />} />
                <Route path="appearance" element={<AppearancePage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="shares" element={<SharesPage />} />
                <Route path="account" element={<AccountPage user={user} />} />
              </Route>
            </Route>
          ) : (
            <Route path="*" element={<Navigate to="/login" replace />} />
          )}
          <Route
            path="*"
            element={user ? <LandingRedirect /> : <Navigate to="/login" replace />}
          />
        </Routes>
          </Suspense>
        </BrowserRouter>
      </MotionProvider>
    </PrefsProvider>
  );
}
