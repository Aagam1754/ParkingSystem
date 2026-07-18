import { useEffect, useState } from 'react';
import { SessionsAPI } from '../api';

export default function Sessions() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('active');
  const [error, setError] = useState('');

  async function load(status = filter) {
    try {
      const data = await SessionsAPI.list(status);
      setRows(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load(filter);
  }, [filter]);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Parking sessions</h2>
          <p>Active and historical allotments from plate scans</p>
        </div>
        <div className="actions">
          <button
            className={`btn ${filter === 'active' ? 'btn-primary' : 'btn-secondary'}`}
            type="button"
            onClick={() => setFilter('active')}
          >
            Active
          </button>
          <button
            className={`btn ${filter === '' ? 'btn-primary' : 'btn-secondary'}`}
            type="button"
            onClick={() => setFilter('')}
          >
            All recent
          </button>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Plate</th>
              <th>Type</th>
              <th>Session</th>
              <th>Base</th>
              <th>Slot</th>
              <th>Member</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.plate_normalized}</td>
                <td>{row.vehicle_type}</td>
                <td>
                  <span className={`badge ${row.session_type}`}>{row.session_type}</span>
                </td>
                <td>{row.base_name}</td>
                <td>{row.slot_code || '—'}</td>
                <td>{row.member_name || 'Guest'}</td>
                <td>
                  <span className={`badge ${row.status}`}>{row.status}</span>
                </td>
                <td>{new Date(row.started_at).toLocaleString()}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={8} className="muted">
                  No sessions found
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
