import { useEffect, useState } from 'react';
import { DashboardAPI, VehiclesAPI } from '../api';

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    plate: '',
    vehicleType: 'CAR',
    companyId: '',
    ownerUserId: '',
    make: '',
    model: '',
    color: '',
  });

  async function load() {
    const [v, c, m] = await Promise.all([
      VehiclesAPI.list(),
      DashboardAPI.companies(),
      DashboardAPI.members(),
    ]);
    setVehicles(v);
    setCompanies(c);
    setMembers(m);
    if (!form.companyId && c[0]) {
      setForm((f) => ({ ...f, companyId: String(c[0].id) }));
    }
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function onCreate(e) {
    e.preventDefault();
    setError('');
    try {
      await VehiclesAPI.create({
        plate: form.plate,
        vehicleType: form.vehicleType,
        companyId: form.companyId ? Number(form.companyId) : null,
        ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null,
        make: form.make,
        model: form.model,
        color: form.color,
      });
      setForm((f) => ({ ...f, plate: '', make: '', model: '', color: '' }));
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h2>Vehicle registry</h2>
          <p>Registered plates allot into their company base; others use general parking</p>
        </div>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3>All vehicles</h3>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Plate</th>
                <th>Type</th>
                <th>Company</th>
                <th>Owner</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td>{v.plate_raw}</td>
                  <td>{v.vehicle_type}</td>
                  <td>{v.company_name || '—'}</td>
                  <td>{v.owner_name || '—'}</td>
                  <td>
                    <span className={`badge ${v.status}`}>{v.status}</span>
                    {v.active_session_id ? (
                      <span className="badge OCCUPIED" style={{ marginLeft: 6 }}>
                        PARKED
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>Register vehicle</h3>
          </div>
          <form className="form" onSubmit={onCreate}>
            <label>
              Plate
              <input
                value={form.plate}
                onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })}
                required
              />
            </label>
            <label>
              Type
              <select
                value={form.vehicleType}
                onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
              >
                <option value="CAR">Car</option>
                <option value="BIKE">Bike</option>
              </select>
            </label>
            <label>
              Company
              <select
                value={form.companyId}
                onChange={(e) => setForm({ ...form, companyId: e.target.value })}
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner member
              <select
                value={form.ownerUserId}
                onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
              >
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} · {m.company_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Make
              <input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
            </label>
            <label>
              Model
              <input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              />
            </label>
            <label>
              Color
              <input
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </label>
            <button className="btn btn-primary" type="submit">
              Save vehicle
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
