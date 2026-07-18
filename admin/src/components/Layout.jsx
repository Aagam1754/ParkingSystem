import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

const links = [
  { to: '/', label: 'Basement Map' },
  { to: '/check-in', label: 'Check-in Gate' },
  { to: '/check-out', label: 'Check-out Gate' },
  { to: '/display', label: 'User Display' },
  { to: '/scan', label: 'Manual Desk' },
  { to: '/sessions', label: 'Sessions' },
  { to: '/vehicles', label: 'Vehicles' },
  { to: '/registry', label: 'Companies' },
  { to: '/assistant', label: 'AI Assistant' },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EF</div>
          <h1>Eastface</h1>
          <p>ParkLane control</p>
        </div>

        <nav className="nav">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.to === '/'}>
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto' }}>
          <div className="muted" style={{ marginBottom: 10, fontSize: '0.9rem' }}>
            {user?.fullName || user?.email}
            <br />
            <span style={{ opacity: 0.8 }}>{user?.role}</span>
          </div>
          <button className="btn btn-secondary" onClick={logout} type="button">
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
