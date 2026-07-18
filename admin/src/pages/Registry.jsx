import { useEffect, useState } from 'react';
import { DashboardAPI } from '../api';

export default function Registry() {
  const [companies, setCompanies] = useState([]);
  const [members, setMembers] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([DashboardAPI.companies(), DashboardAPI.members(), DashboardAPI.incidents()])
      .then(([c, m, i]) => {
        setCompanies(c);
        setMembers(m);
        setIncidents(i);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Companies & members</h2>
          <p>Eastface tenants · Basement 2 & 3 company pools · Basement 1 general</p>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="stats">
        {companies.map((c) => (
          <div className="stat" key={c.id}>
            <span>
              <span className="company-swatch" style={{ background: c.color_hex }} />
              {c.code} · {c.floor_label}
            </span>
            <strong style={{ fontSize: '1.05rem' }}>{c.name}</strong>
            <div className="muted" style={{ marginTop: 8, fontSize: '0.82rem' }}>
              {c.address}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              {c.member_count} members · {c.vehicle_count} vehicles · {c.slot_count} slots
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3>Members</h3>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Code</th>
                <th>Email</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>{m.full_name}</td>
                  <td>{m.company_name}</td>
                  <td>{m.employee_code || '—'}</td>
                  <td>{m.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Incidents</h3>
          </div>
          <div className="stack">
            {incidents.map((i) => (
              <div key={i.id} className="scan-result">
                <strong>
                  {i.type} · {i.severity}
                </strong>
                <div>{i.message}</div>
                <div className="muted">
                  {i.base_name || '—'} · {i.status} · {new Date(i.created_at).toLocaleString()}
                </div>
              </div>
            ))}
            {!incidents.length ? <div className="muted">No incidents yet</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
