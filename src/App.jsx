import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './features/auth/AuthProvider'
import { CenterProvider } from './features/centers/CenterProvider'
import LoginPage from './features/auth/LoginPage'
import AppShell from './components/AppShell'
import Spinner from './components/Spinner'
import DayViewPage from './pages/DayViewPage'
import RosterPage from './pages/RosterPage'
import ShiftsPage from './pages/ShiftsPage'
import ImportsPage from './pages/ImportsPage'
import DataHealthPage from './pages/DataHealthPage'

function AuthedApp() {
  const { session, loading } = useAuth()

  if (loading) return <Spinner label="Checking session…" />
  if (!session) return <LoginPage />

  return (
    <CenterProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/day" replace />} />
          <Route path="day" element={<DayViewPage />} />
          <Route path="roster" element={<RosterPage />} />
          <Route path="shifts" element={<ShiftsPage />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="health" element={<DataHealthPage />} />
          <Route path="*" element={<Navigate to="/day" replace />} />
        </Route>
      </Routes>
    </CenterProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthedApp />
    </AuthProvider>
  )
}
