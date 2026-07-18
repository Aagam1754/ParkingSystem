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

## Stack

- Admin: React (Vite)
- Member app: React Native (Expo) in `app/`
- API: Node.js + Express + Socket.io
- ALPR: Python FastAPI + OpenCV + Tesseract
- DB: MySQL database `parking` (Laragon-compatible)

## Screens

- **Basement Map** — whole basement visual by company color
- **Check-in Gate** — webcam auto-scan + success popup
- **Check-out Gate** — webcam auto-scan exit
- **User Display** — realtime allotted slot blink + scanned plate + success popup
- **Smart Assistant** — live parking Q&A / tips (admin)
- **Member app** — current slot, vehicles, in-service / temp plate, history

## Run

```bash
cp backend/.env.example backend/.env
npm run setup
sudo apt-get install -y tesseract-ocr
python3 -m pip install -r alpr-service/requirements.txt

npm run dev:api
npm run dev:alpr
npm run dev:admin
npm run dev:app
```

- Admin: http://localhost:5173
- API: http://localhost:4000
- ALPR: http://localhost:5001
- Member app: Expo (`npm run dev:app`) — see `app/README.md`
- Admin login: `admin@parking.local` / `Admin@123`
- Member login: `priya@yorkie.local` / `Admin@123`

## York IE demo plates

- `GJ01YK1001` (car)
- `GJ01YK2044` (car)
- `GJ01YK1002` (bike)

Sample plate images: `docs/sample-plates/`

Unknown plate → auto guest register → **Basement 1 General**.

## Docs

- `docs/BLUEPRINT.md`
- `docs/PROJECT_HANDOFF.md`
