# ParkLane — Project Handoff Document

Use this document to onboard another teammate/agent onto the same codebase and continue development without losing context.

---

## 1. One-line product

**ParkLane** is a smart parking allotment system that scans vehicle number plates (webcam/ALPR), checks MySQL, and allots slots in a multi-company basement using first-come-first-serve (FCFS). Unknown vehicles are auto-registered as guests.

---

## 2. Repo / branch / PR

| Item | Value |
|---|---|
| Repo | `https://github.com/Aagam1754/ParkingSystem` |
| Working branch | `cursor/admin-panel-parking-b166` |
| Base branch | `main` |
| PR | `https://github.com/Aagam1754/ParkingSystem/pull/1` |
| DB name | `parking` (MySQL / Laragon compatible) |

Always pull latest from `cursor/admin-panel-parking-b166` before coding.

---

## 3. Current stack

| Layer | Tech |
|---|---|
| Admin UI | React + Vite (`admin/`) |
| Backend API | Node.js + Express + Socket.io (`backend/`) |
| ALPR / OCR | Python FastAPI + OpenCV + Tesseract (`alpr-service/`) |
| Database | MySQL database name **`parking`** |
| Auth | JWT (`admin@parking.local` / `Admin@123`) |
| Mobile app | **Not started yet** (planned React Native after admin is solid) |

---

## 4. Core business rules (locked)

1. Vehicle arrives → plate is scanned (webcam / manual / demo).
2. System normalizes plate and looks it up in DB.
3. If plate belongs to a **registered company vehicle**:
   - Allot the first free slot from that **company’s pool** (FCFS).
   - Prefer selected basement if provided; else any basement with free company slots.
   - If company pool is full → overflow into **general** pool.
4. If plate is **unknown**:
   - Auto-create **GUEST user + guest vehicle**.
   - Allot first free **GENERAL** slot (FCFS).
5. One open parking session per plate at a time.
6. Exit scan frees the slot and closes the session.
7. Live map updates over Socket.io.

### Basement model (important)

A basement is shared. It contains multiple slot pools:

- `GENERAL` slots (`company_id = NULL`)
- `COMPANY` slots (`company_id = <company>`)

Current seed:

| Basement | Pools |
|---|---|
| **B1** | General + Nexus + Orbit + Pixel |
| **B2** | General + Nexus + Orbit |

Members of a company can have multiple vehicles, but allotment is still FCFS into that company’s free slots (no personal reserved slot locking in v1).

---

## 5. Folder structure

```text
ParkingSystem/
  admin/                 # React admin panel
  backend/               # Express API
  alpr-service/          # Python plate OCR service
  docs/                  # Project docs (this file)
  package.json           # Root scripts
  README.md
```

### Backend modules

```text
backend/src/
  db/            schema.sql, init.js, seed.js, pool.js
  routes/        auth, bases, sessions, vehicles, dashboard, alpr
  services/      allotment.js   ← core check-in logic
  middleware/    auth.js (JWT + roles)
  utils/         plates.js, plateMatch.js
  index.js
```

### Admin pages

| Route | Page | Purpose |
|---|---|---|
| `/` | Live Basement Map | Visual slots by company pool |
| `/webcam` | Webcam Scan | Realtime camera → OCR → check-in |
| `/scan` | Manual Scan Desk | Type/select plate and allot |
| `/sessions` | Sessions | Active/history sessions |
| `/vehicles` | Vehicles | Register company vehicles |
| `/registry` | Companies & Members | Companies, members, incidents |

---

## 6. How to run (local / Laragon)

### Prerequisites
- Node.js 18+
- MySQL (Laragon OK)
- Python 3.10+
- Tesseract OCR

### Setup

```bash
git checkout cursor/admin-panel-parking-b166
git pull

cp backend/.env.example backend/.env
# ensure:
# DB_NAME=parking
# DB_USER=root
# DB_PASSWORD=   (Laragon default often empty)
# PYTHON_ALPR_URL=http://127.0.0.1:5001

npm run setup
# runs: install backend+admin, db init, seed

sudo apt-get install -y tesseract-ocr   # Linux
# Windows: install Tesseract and ensure it's on PATH

python3 -m pip install -r alpr-service/requirements.txt
```

### Start (3 terminals)

```bash
npm run dev:api      # http://localhost:4000
npm run dev:alpr     # http://localhost:5001
npm run dev:admin    # http://localhost:5173
```

### Login
- Email: `admin@parking.local`
- Password: `Admin@123`

---

## 7. Important env vars

`backend/.env`:

```env
PORT=4000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=parking
JWT_SECRET=parkai-admin-dev-secret-change-me
JWT_EXPIRES_IN=8h
CLIENT_ORIGIN=*
PYTHON_ALPR_URL=http://127.0.0.1:5001
```

---

## 8. Key APIs

Base: `/api`

### Auth
- `POST /api/auth/login` `{ email, password }` → `{ token, user }`
- `GET /api/auth/me` (Bearer token)

### ALPR / check-in
- `POST /api/alpr/scan` `{ imageBase64 }` → `{ plate, confidence, candidates }`
- `POST /api/alpr/check-in` `{ plate?, imageBase64?, vehicleType, baseId?, source }`
- `POST /api/alpr/check-out` `{ plate }`

### Sessions (manual/demo)
- `POST /api/sessions/entry-scan`
- `POST /api/sessions/exit-scan`
- `POST /api/sessions/demo-random-entry`
- `GET /api/sessions?status=active`

### Basement / map
- `GET /api/bases`
- `GET /api/bases/:id/occupancy` → groups by company/general pools

### Registry
- `GET/POST /api/vehicles`
- `GET /api/dashboard/overview`
- `GET /api/dashboard/companies`
- `GET /api/dashboard/members`

### Realtime (Socket.io)
- Events: `occupancy.updated`, `session.updated`

### Python ALPR direct
- `GET http://localhost:5001/health`
- `POST http://localhost:5001/scan` `{ imageBase64 }`
- `POST http://localhost:5001/demo-plate-image` `{ plate }`

---

## 9. Database essentials

Main tables:
- `companies`
- `users` (roles include `CORPORATE_MEMBER`, `GUEST`, admins)
- `bases` (basements B1/B2)
- `company_base_allocations` (quota metadata)
- `slots` (`owner_type`: GENERAL/COMPANY, `company_id`, `vehicle_type`: CAR/BIKE, `status`)
- `vehicles` (`is_guest`, `company_id`, `plate_normalized`)
- `vehicle_authorizations`
- `alpr_events`
- `parking_sessions` (`session_type`: COMPANY/GENERAL/GUEST, `is_open`)
- `slot_assignments`
- `incidents`
- `audit_logs`

### Seed demo plates
| Plate | Owner | Company |
|---|---|---|
| MH12AB1234 | Aisha Khan | Nexus |
| MH12CD5678 | Aisha Khan | Nexus (bike) |
| MH14EF9012 | Rohan Mehta | Nexus |
| GJ01GH3456 | Meera Shah | Orbit |
| GJ01JK7890 | Vikram Patel | Orbit (bike) |
| DL08LM2468 | Vikram Patel | Orbit |
| KA03NP1122 | Neha Rao | Pixel |

Unknown plate example: `TN09ZZ4321` → guest + general slot.

Re-seed anytime:

```bash
npm run db:init
npm run db:seed
```

---

## 10. Allotment algorithm (where to edit)

File: `backend/src/services/allotment.js`

Functions:
- `processEntryScan()` — main check-in
- `processExitScan()` — checkout
- `pickFreeSlotFCFS()` — FCFS picker
- `ensureGuestVehicle()` — guest auto-register

OCR fuzzy correction against known plates:
- `backend/src/utils/plateMatch.js`
- used in `backend/src/routes/alpr.js`

---

## 11. What is already done

- [x] MySQL schema + seed for multi-company basements
- [x] JWT admin auth
- [x] Express API modules
- [x] FCFS company/general allotment
- [x] Guest auto-registration on unknown plate
- [x] Live basement map (grouped by company pools)
- [x] Manual scan desk
- [x] Webcam scan UI (getUserMedia → frame → OCR → check-in)
- [x] Python ALPR service
- [x] Socket.io live updates
- [x] Demo simulate entry

---

## 12. What is NOT done yet (good split for teammate)

Priority order suggested:

1. **React Native user app**
   - Member login
   - My vehicles / mark in-service / temp plate
   - Current allotted slot screen
   - History
2. **Stronger ALPR**
   - Better model (EasyOCR/PaddleOCR/commercial ALPR)
   - Camera gate simulation polish
3. **Exception flows**
   - Car in service + alternate vehicle claim
   - Operator approve/deny queue
   - MFA for admin
4. **Ops polish**
   - Overstay jobs
   - Analytics charts
   - Blacklist plates
   - Barrier/hardware integration stubs
5. **Payments** (defer unless required by hackathon)

---

## 13. Suggested teammate ownership split

| Person | Own |
|---|---|
| A | Backend allotment, schema, ALPR integration |
| B | Admin UI / live map / webcam UX |
| C | React Native app |
| D | Demo script, seed data, pitch deck |

Shared contracts = this doc + `/api/*` routes + enums in schema.

---

## 14. Coding conventions for this repo

- Keep module boundaries (don’t dump all logic in `index.js`).
- Prefer editing `allotment.js` for parking rules, not random route files.
- DB name must remain `parking` unless team agrees to change.
- Do not commit `backend/.env`.
- After schema changes: update `schema.sql` + `seed.js`, then `db:init` + `db:seed`.
- Admin visual style: dark industrial control-room (existing CSS variables in `admin/src/index.css`). Don’t restyle to generic purple SaaS.
- For webcam: always allow manual plate confirm/edit (OCR can misread).

---

## 15. Demo script (hackathon)

1. Open admin → login.
2. Show **Live Basement Map** (B1 pools: General/Nexus/Orbit/Pixel).
3. Open **Webcam Scan** → allow camera.
4. Show registered plate `MH12AB1234` → check-in → lands in Nexus pool (`B1N-Cxx`).
5. Show unknown plate → guest created → general pool (`B1G-Cxx`).
6. Map updates live.
7. Check out plate → slot frees.

Backup if camera/OCR fails: use **Manual Scan Desk** or type plate in Webcam page and click Check in.

---

## 16. Quick verification commands

```bash
curl http://localhost:4000/api/health
curl http://localhost:5001/health

# login
curl -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@parking.local","password":"Admin@123"}'

# company check-in
curl -X POST http://localhost:4000/api/alpr/check-in \
  -H "Authorization: Bearer <TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"plate":"MH12AB1234","vehicleType":"CAR","baseId":1}'

# guest check-in
curl -X POST http://localhost:4000/api/alpr/check-in \
  -H "Authorization: Bearer <TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"plate":"TN09ZZ4321","vehicleType":"CAR","baseId":1}'
```

---

## 17. Message to paste into friend’s agent

You can paste this block:

```text
We are building ParkLane, a smart parking system.
Repo: https://github.com/Aagam1754/ParkingSystem
Branch: cursor/admin-panel-parking-b166
Read docs/PROJECT_HANDOFF.md fully before changing code.

Current state:
- Admin React app + Express API + Python ALPR are implemented
- MySQL DB name is `parking`
- Basements contain multiple company slot pools + general slots
- Plate scan → DB verify → company FCFS slot OR guest register + general slot
- Webcam scan page exists at /webcam
- Mobile React Native app is NOT started yet

Login: admin@parking.local / Admin@123
Run: npm run setup && npm run dev:api && npm run dev:alpr && npm run dev:admin

Do not invent a different architecture. Extend the existing modules.
Follow PROJECT_HANDOFF.md business rules and folder structure.
```

---

## 18. Contact / continuity notes

- Project codename in UI: **ParkLane**
- Latest implemented feature set: webcam ALPR + multi-company basement FCFS + guest auto-register
- Next major milestone: React Native user app on the same API

If anything in code conflicts with this doc, **trust the code + latest branch**, then update this handoff doc.
