import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { AssignmentsPage } from './pages/AssignmentsPage';
import { AttendancePage } from './pages/AttendancePage';
import { ClassDetailPage } from './pages/ClassDetailPage';
import { ClassesPage } from './pages/ClassesPage';
import { ExamsPage } from './pages/ExamsPage';
import { LeaderLeavePage, TeacherLeavePage } from './pages/LeavePages';
import { LoginPage } from './pages/LoginPage';
import { MobileOnlyPage } from './pages/MobileOnlyPage';
import { NewPasswordPage } from './pages/NewPasswordPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { StudentsPage } from './pages/StudentsPage';
import { StudentDetailPage } from './pages/StudentDetailPage';
import { TeachersPage } from './pages/TeachersPage';
import {
  MarkSheetPage,
  MarksListPage,
  MyClassesPage,
  SlipTestPage,
  TeacherAttendancePage,
} from './pages/teacher/TeacherPages';

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
  // Still on the first password from the school: nothing else works until it is changed.
  if (user.mustChangePassword) return <NewPasswordPage />;

  if (user.roles.some((role) => LEADER_ROLES.includes(role))) {
    return (
      <Routes>
        <Route element={<Layout variant="leader" />}>
          <Route index element={<OverviewPage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="classes/:classId" element={<ClassDetailPage />} />
          <Route path="assignments" element={<AssignmentsPage />} />
          <Route path="exams" element={<ExamsPage />} />
          <Route path="teachers" element={<TeachersPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="students/:studentId" element={<StudentDetailPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="leave" element={<LeaderLeavePage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Teachers see only their own classes, subjects and sections; the API enforces the same limits.
  if (user.roles.includes('Teacher')) {
    return (
      <Routes>
        <Route element={<Layout variant="teacher" />}>
          <Route index element={<MyClassesPage />} />
          <Route path="attendance" element={<TeacherAttendancePage />} />
          <Route path="marks" element={<MarksListPage />} />
          <Route path="marks/:assessmentId" element={<MarkSheetPage />} />
          <Route path="slip-tests" element={<SlipTestPage />} />
          <Route path="leave" element={<TeacherLeavePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return <MobileOnlyPage />;
}
