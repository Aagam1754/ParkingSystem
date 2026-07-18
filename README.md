# Eastface ParkLane — Smart Parking

Realtime webcam check-in / check-out for **Eastface, Ambli Rd, Ahmedabad** with multi-company basement pools.

## Demo building

**Eastface**  
Iscon, Ambli Rd, behind Maruti Suzuki Arena, Ambli, Ahmedabad, Gujarat 380058

### Primary company
**York IE APAC Pvt Ltd** (2nd Floor)  
`2nd floor Eastface, Iscon, Ambli Rd, behind Maruti Suzuki Arena, Ambli, Ahmedabad, Gujarat 380058`

## Basements

| Basement | Kind | Pools |
|---|---|---|
| B1 | GENERAL | General parking only (guests / unknown plates) |
| B2 | MULTI_COMPANY | York IE + Nexus + Orbit |
| B3 | MULTI_COMPANY | York IE + Nexus |

Same company slots share the same color on the map.

## Screens

- **Basement Map** — whole basement visual by company color
- **Check-in Gate** — webcam auto-scan + success popup
- **Check-out Gate** — webcam auto-scan exit
- **User Display** — realtime allotted slot blink + scanned plate + success popup

## Run locally

```bash
cp backend/.env.example backend/.env
npm run setup
sudo apt-get install -y tesseract-ocr
python3 -m pip install -r alpr-service/requirements.txt

npm run dev:api
npm run dev:alpr
npm run dev:admin
```

- Admin: http://localhost:5173
- Login: `admin@parking.local` / `Admin@123`

## Deploy on Render (live admin panel)

This repo includes `render.yaml`. One Node web service serves **admin UI + API + Socket.io**; a Docker service runs **ALPR** for webcam OCR. MySQL must be hosted elsewhere (Render has no managed MySQL).

### 1) Create a MySQL database

Use any MySQL 8 host (Aiven, Railway, TiDB Cloud, FreeSQLDatabase, etc.). Create a database named `parking` (or match your URL path).

Connection string format:

```text
mysql://USER:PASSWORD@HOST:3306/parking
```

Allow remote connections from anywhere (or Render’s egress) and enable SSL if the host requires it.

### 2) Deploy the Blueprint

1. Push this branch to GitHub
2. Open [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect the `parkingsystem` repo and select this branch
4. When prompted for `DATABASE_URL`, paste your MySQL URL
5. Apply — Render creates:
   - `parklane-admin` (Node) — admin panel + API
   - `parklane-alpr` (Docker) — plate OCR

On first boot the API runs `db:ensure` (schema + Eastface demo seed if the DB is empty).

### 3) Open the live admin

- URL: `https://parklane-admin.onrender.com` (or the URL Render shows)
- Login: `admin@parking.local` / `Admin@123`
- Health: `https://<your-service>/api/health`

Optional later (Assistant extras): add `OPENAI_API_KEY` and/or `ELEVENLABS_API_KEY` on `parklane-admin` in the Render env vars UI.

> Free-tier web services sleep after idle time — the first request after sleep can take ~30–60s. Webcam check-in needs both services awake.

## York IE demo plates

- `GJ01YK1001` (car)
- `GJ01YK2044` (car)
- `GJ01YK1002` (bike)

Sample plate images: `docs/sample-plates/`

Unknown plate → auto guest register → **Basement 1 General**.

## Docs

- `docs/BLUEPRINT.md`
- `docs/PROJECT_HANDOFF.md`
