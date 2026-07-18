# ParkLane — System Blueprint (Final / Current)

This is the architecture blueprint of the project **as implemented now**.  
Share with teammates/agents together with `docs/PROJECT_HANDOFF.md`.

---

## 1. Product goal

Build a smart parking system that:

1. Scans a vehicle number plate (webcam / gate camera / manual)
2. Verifies the plate in MySQL (`parking`)
3. Allots a parking slot automatically
4. Shows live basement occupancy on an admin screen

### Allotment rule

| Vehicle type | Slot pool |
|---|---|
| Registered company vehicle | That company’s slots inside a basement (FCFS) |
| Unknown / guest vehicle | Auto-register as guest → **General** slots (FCFS) |
| Company pool full | Overflow to General |

---

## 2. High-level architecture

```text
┌──────────────────────┐
│  Webcam / Camera     │
│  (Admin browser)     │
└──────────┬───────────┘
           │ frame (base64)
           ▼
┌──────────────────────┐     ┌──────────────────────┐
│  React Admin Panel   │────▶│  Express API (:4000)  │
│  Live map + scan UI  │◀────│  Auth · Sessions ·    │
└──────────────────────┘ WS  │  Allotment · Registry │
                             └──────────┬───────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
           ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
           │ Python ALPR  │    │ MySQL        │    │ Socket.io    │
           │ (:5001)      │    │ DB: parking  │    │ live events  │
           │ OpenCV +     │    │              │    │              │
           │ Tesseract    │    │              │    │              │
           └──────────────┘    └──────────────┘    └──────────────┘
```

### Planned later
```text
React Native App (members/guests)
        │
        ▼
   same Express API + MySQL
```

---

## 3. System modules

| ID | Module | Responsibility |
|---|---|---|
| M1 | **ALPR Ingest** | Read plate from webcam frame / image |
| M2 | **Auth** | Admin login, JWT, role checks |
| M3 | **Registry** | Companies, members, vehicles, guests |
| M4 | **Allotment Engine** | Decide pool + FCFS free slot |
| M5 | **Sessions** | Check-in / check-out lifecycle |
| M6 | **Basement Occupancy** | Slot state + live map projection |
| M7 | **Admin UI** | Control room screens |
| M8 | **Realtime** | Socket.io occupancy/session events |
| M9 | **Incidents / Audit** | Guest register, lot full, overrides |
| M10 | **Mobile App** | Not built yet |

---

## 4. Basement + company model

### Concept
One **basement** can host:

- General parking slots
- Multiple company slot pools
- Car + bike slots in each pool

### Example (seeded)

**Basement B1**
- General: cars + bikes
- Nexus pool
- Orbit pool
- Pixel pool

**Basement B2**
- General
- Nexus
- Orbit

### Slot ownership

```text
slots.owner_type = GENERAL | COMPANY
slots.company_id = NULL (general) OR <company_id>
slots.vehicle_type = CAR | BIKE
slots.status = FREE | OCCUPIED | RESERVED | OUT_OF_SERVICE
```

### FCFS meaning
When allotting inside a pool, pick the free slot with the **lowest slot id**  
(ordered by basement preference, then id).

---

## 5. End-to-end flows

### A) Registered company entry (happy path)

```text
Camera frame
   → Python OCR → plate MH12AB1234
   → API finds vehicle in Nexus
   → pick first free Nexus slot in preferred basement
   → create parking_session (COMPANY)
   → mark slot OCCUPIED
   → emit realtime update
   → Admin map highlights slot
```

### B) Guest / unknown plate

```text
Camera frame
   → OCR → unknown plate
   → create GUEST user
   → create guest vehicle (is_guest=1)
   → pick first free GENERAL slot
   → session_type = GUEST
   → map updates
```

### C) Exit

```text
Plate scanned/entered for exit
   → find open session
   → free slot
   → close session
   → realtime update
```

### D) Company pool full

```text
Company slots all OCCUPIED
   → overflow to GENERAL pool (if available)
   → note stored on session
```

---

## 6. Data model (blueprint)

### Entities

```text
companies
  └── users (members/admins/guests)
  └── vehicles
  └── slots (company pools)

bases (basements)
  └── slots (general + company)
  └── company_base_allocations (quota metadata)
  └── parking_sessions
```

### Critical tables

| Table | Purpose |
|---|---|
| `companies` | Nexus, Orbit, Pixel, ... |
| `users` | Admins + corporate members + guests |
| `bases` | Basement B1, B2, ... |
| `company_base_allocations` | Soft quota per company per basement |
| `slots` | Actual parkable bays |
| `vehicles` | Plates linked to company/guest |
| `vehicle_authorizations` | Who may use which vehicle |
| `alpr_events` | Every scan observation |
| `parking_sessions` | Check-in lifecycle |
| `slot_assignments` | Active slot ↔ session link |
| `incidents` | Lot full / guest registered / etc |
| `audit_logs` | Admin actions |

### Session types
- `COMPANY`
- `GENERAL`
- `GUEST`

### User roles
- `SUPER_ADMIN`
- `LOT_ADMIN`
- `SECURITY_OPERATOR`
- `CORPORATE_MEMBER`
- `GUEST`

---

## 7. Allotment engine blueprint

**File:** `backend/src/services/allotment.js`

```text
INPUT:
  plate, vehicleType, preferredBaseId?, confidence, source

STEPS:
  1. normalize plate
  2. reject if already has open session
  3. write alpr_event
  4. lookup vehicle
     - if company vehicle → target = company pool
     - else ensure guest user+vehicle → target = general pool
  5. pickFreeSlotFCFS(target)
  6. if company miss → try general overflow
  7. if still none → DENIED + LOT_FULL incident
  8. else create session, occupy slot, assignment row
  9. return allotment result + emit socket events
```

---

## 8. ALPR blueprint

**Service:** `alpr-service/` (Python FastAPI `:5001`)

```text
Admin webcam
  → capture JPEG frame (base64)
  → POST /api/alpr/scan (Node, auth)
  → Node proxies to Python /scan
  → OpenCV preprocess + Tesseract OCR
  → return plate + confidence + candidates
  → Node may fuzzy-match against registered plates
  → UI shows plate (editable)
  → Check-in calls /api/alpr/check-in
```

### Practical note
OCR can misread. UI always allows manual confirm/edit before check-in.  
Manual Scan Desk is the reliable demo fallback.

---

## 9. Admin UI blueprint

### Information architecture

1. **Live Basement Map**
   - Basement tabs (B1/B2)
   - Groups: General / each company
   - Car grid + bike grid
   - Occupied slots show plate
2. **Webcam Scan**
   - Camera preview + guide box
   - Scan frame / auto-scan
   - Detected plate editor
   - Check-in / check-out
3. **Manual Scan Desk**
   - Type plate or pick demo plate
4. **Sessions**
5. **Vehicles**
6. **Companies & Members**

### Visual direction
Dark control-room UI (existing theme in `admin/src/index.css`):
- deep green/black base
- lime/mint accent
- expressive fonts (Syne + DM Sans)
- no generic purple SaaS look

---

## 10. API blueprint (v1)

```text
Auth
  POST /api/auth/login
  GET  /api/auth/me

ALPR
  POST /api/alpr/scan
  POST /api/alpr/check-in
  POST /api/alpr/check-out

Sessions
  GET  /api/sessions
  POST /api/sessions/entry-scan
  POST /api/sessions/exit-scan
  POST /api/sessions/demo-random-entry

Bases
  GET  /api/bases
  GET  /api/bases/:id/occupancy

Vehicles / Registry
  GET/POST /api/vehicles
  PATCH    /api/vehicles/:id/status
  GET      /api/dashboard/overview
  GET      /api/dashboard/companies
  GET      /api/dashboard/members
  GET      /api/dashboard/incidents
```

Realtime events:
- `occupancy.updated`
- `session.updated`

---

## 11. Runtime topology

| Service | Port | Command |
|---|---|---|
| MySQL | 3306 | Laragon / local MySQL |
| Express API | 4000 | `npm run dev:api` |
| Python ALPR | 5001 | `npm run dev:alpr` |
| React Admin | 5173 | `npm run dev:admin` |

DB: **`parking`**

---

## 12. Security blueprint (current + next)

### Current
- JWT bearer auth on protected routes
- Role checks for scan/check-in
- Password hashing (bcrypt)
- Plate normalization
- Open-session uniqueness per plate

### Next (not fully built)
- Admin MFA
- Refresh-token rotation
- Stronger audit on every override
- Service key for camera gate devices
- Private storage for plate snapshot images

---

## 13. Build phases

### Phase A — Done
- DB + seed
- Auth
- Admin shell
- Allotment + sessions

### Phase B — Done
- Multi-company basement pools
- Guest auto-register
- Live map by pool
- Webcam + Python OCR path

### Phase C — Next
- React Native member/guest app
- In-service / alternate vehicle claim
- Operator approval queue

### Phase D — Polish
- Better ALPR model
- Overstay jobs
- Analytics dashboards
- Hardware barrier stubs

---

## 14. Demo blueprint (90 seconds)

1. Login admin  
2. Show B1 map with General + company pools  
3. Webcam / manual check-in `MH12AB1234` → Nexus slot  
4. Check-in unknown plate → Guest + General slot  
5. Show live occupancy change  
6. Check-out → slot frees  

---

## 15. Non-goals for current hackathon MVP

- Full payment gateway
- Trained custom YOLO plate detector (optional later)
- Multi-city multi-tenant SaaS billing
- Physical boom-barrier hardware control (stub only later)

---

## 16. Source-of-truth files

| Concern | File |
|---|---|
| Schema | `backend/src/db/schema.sql` |
| Seed | `backend/src/db/seed.js` |
| Allotment rules | `backend/src/services/allotment.js` |
| ALPR API routes | `backend/src/routes/alpr.js` |
| Python OCR | `alpr-service/app.py` |
| Live map UI | `admin/src/pages/LiveMap.jsx` |
| Webcam UI | `admin/src/pages/WebcamScan.jsx` |
| Teammate onboarding | `docs/PROJECT_HANDOFF.md` |
| This blueprint | `docs/BLUEPRINT.md` |

---

## 17. Blueprint status

**Status:** FINAL for current admin + ALPR milestone  
**Branch:** `cursor/admin-panel-parking-b166`  
**Next blueprint extension:** Mobile app + exception workflows

If implementation and this document disagree, update this blueprint after verifying branch code.
