# ParkLane — Smart Parking Allotment System

Realtime webcam number-plate check-in for multi-company basement parking.

## Core flow

1. Webcam shows the vehicle plate
2. Python ALPR reads the plate
3. Node checks MySQL (`parking`)
4. **Registered company vehicle** → first free slot in that company’s pool (FCFS)
5. **Unknown plate** → auto-register guest user + vehicle → general pool slot
6. Live basement map updates over Socket.io

## Basement model

Each basement can host **multiple company slot pools + general slots**:

| Basement | Pools |
|---|---|
| B1 | General + Nexus + Orbit + Pixel |
| B2 | General + Nexus + Orbit |

Allotment inside a pool is **first-come-first-serve** (lowest free slot id).

## Stack

- Admin: React (Vite)
- API: Node.js + Express + Socket.io
- ALPR: Python FastAPI + OpenCV + Tesseract
- DB: MySQL database `parking` (Laragon-compatible)

## Run

```bash
# 1) MySQL up, then:
cp backend/.env.example backend/.env
npm run setup

# 2) Python OCR deps (once)
sudo apt-get install -y tesseract-ocr
python3 -m pip install -r alpr-service/requirements.txt

# 3) Start services
npm run dev:api
npm run dev:alpr
npm run dev:admin
```

- Admin: http://localhost:5173
- API: http://localhost:4000
- ALPR: http://localhost:5001
- Login: `admin@parking.local` / `Admin@123`

## Demo plates

- `MH12AB1234` → Nexus company pool
- `GJ01GH3456` → Orbit company pool
- Any unknown plate → guest register + general slot
