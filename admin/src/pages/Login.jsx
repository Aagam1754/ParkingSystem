import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('admin@parking.local');
  const [password, setPassword] = useState('Admin@123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand-mark">PL</div>
        <h1 className="brand-title">ParkLane</h1>
        <p className="sub">
          Admin control for plate-scan entry, company allotment, and live bay status across three
          bases.
        </p>

        <form className="form" onSubmit={onSubmit}>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button className="btn btn-primary" disabled={loading} type="submit">
            {loading ? 'Signing in…' : 'Enter control room'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16, fontSize: '0.85rem' }}>
          Demo: admin@parking.local / Admin@123
        </p>
      </div>
    </div>
  );
}
