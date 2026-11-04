import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { AttendancePage } from './pages/AttendancePage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { LoginPage } from './pages/LoginPage';
import { MobileOnlyPage } from './pages/MobileOnlyPage';
import { OverviewPage } from './pages/OverviewPage';
import { StudentsPage } from './pages/StudentsPage';

const LEADER_ROLES = ['Principal', 'School Admin', 'Super Admin'];

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted" role="status">
        Loading…
      </div>
    );
  }
  if (!user) return <LoginPage />;
  if (!user.roles.some((role) => LEADER_ROLES.includes(role))) return <MobileOnlyPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="attendance" element={<AttendancePage />} />
        <Route path="students" element={<StudentsPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
