import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import Layout from './components/Layout.jsx'
import { Login, Register } from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Transfer from './pages/Transfer.jsx'
import History from './pages/History.jsx'
import Beneficiaries from './pages/Beneficiaries.jsx'
import Security from './pages/Security.jsx'
import Notifications from './pages/Notifications.jsx'
import Ops from './pages/Ops.jsx'
import { Spinner } from './components/ui.jsx'

function Guard({ role }) {
  const { user, ready } = useAuth()
  if (!ready) return <div className="flex h-full items-center justify-center"><Spinner /></div>
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/ops' : '/'} replace />
  return <Layout />
}

function Routed() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={user.role === 'admin' ? '/ops' : '/'} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route element={<Guard role="customer" />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transfer" element={<Transfer />} />
        <Route path="/history" element={<History />} />
        <Route path="/beneficiaries" element={<Beneficiaries />} />
        <Route path="/security" element={<Security />} />
        <Route path="/notifications" element={<Notifications />} />
      </Route>
      <Route element={<Guard role="admin" />}>
        <Route path="/ops" element={<Ops />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return <AuthProvider><Routed /></AuthProvider>
}
