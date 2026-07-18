import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import LiveMap from './pages/LiveMap';
import CheckIn from './pages/CheckIn';
import CheckOut from './pages/CheckOut';
import UserDisplay from './pages/UserDisplay';
import ScanDesk from './pages/ScanDesk';
import Sessions from './pages/Sessions';
import Vehicles from './pages/Vehicles';
import Registry from './pages/Registry';
import Assistant from './pages/Assistant';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">Loading ParkLane…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route index element={<LiveMap />} />
            <Route path="check-in" element={<CheckIn />} />
            <Route path="check-out" element={<CheckOut />} />
            <Route path="display" element={<UserDisplay />} />
            <Route path="webcam" element={<Navigate to="/check-in" replace />} />
            <Route path="scan" element={<ScanDesk />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="vehicles" element={<Vehicles />} />
            <Route path="registry" element={<Registry />} />
            <Route path="assistant" element={<Assistant />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
