# ParkLane — Smart Parking Allotment System

Admin control room for camera/plate-scan based parking allotment.

## Core flow

1. Vehicle arrives → plate is scanned
2. System checks MySQL (`parking` database)
3. **Registered company vehicle** → allot slot in that company's base
4. **Unregistered vehicle** → allot slot in **Base 1 · General Parking**
5. Live map updates in realtime (Socket.io)

## Demo layout

| Base | Type | Slots |
|---|---|---|
| Base 1 · General Parking | GENERAL | 50 car + 30 bike |
| Base 2 · Nexus Corporate | COMPANY | 50 car + 30 bike |
| Base 3 · Orbit Corporate | COMPANY | 50 car + 30 bike |

## Stack

- **Admin:** React (Vite)
- **API:** Node.js + Express + Socket.io
- **DB:** MySQL database name `parking` (Laragon-compatible)

## Quick start (Laragon / local MySQL)

1. Start MySQL in Laragon
2. Ensure database credentials in `backend/.env` (default DB name: `parking`)
3. Run:

```bash
npm run setup
npm run dev:api
npm run dev:admin
```

- Admin UI: http://localhost:5173
- API: http://localhost:4000
- Login: `admin@parking.local` / `Admin@123`

## Useful modules in admin

- **Live Lot Map** — visual car/bike bays for all 3 bases
- **Plate Scan Desk** — simulate camera entry/exit
- **Sessions** — active allotments
- **Vehicles** — company plate registry
- **Companies & Members** — corporate directory + incidents
