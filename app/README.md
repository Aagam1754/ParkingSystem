# ParkLane Member App (Expo SDK 54)

Corporate-member companion for the Eastface parking system. Uses the **same Express API + allotment engine** as the admin panel.

Members do **not** run ALPR / gate cameras — they see allotment results and manage vehicles.

## Features

| Screen | Behavior (mirrors admin logic) |
|---|---|
| Login | JWT for `CORPORATE_MEMBER` only |
| Current slot | Open session after gate check-in; auto-refresh every 4s |
| Assist | Same `/api/assistant` as admin — free-bay navigate + ElevenLabs slot voice, GPS proximity, live tips |
| (background) | Local notification when gate allotment confirms you parked in a slot |
| My vehicles | ACTIVE ↔ IN_SERVICE; claim / retire TEMP_SERVICE plates |
| History | Sessions with COMPANY / GENERAL / GUEST pool types |
| Profile | Building, company, employee code |

### Allotment rules (same as admin)

1. ACTIVE company plate → company basement pool (FCFS)
2. Company pool full → Basement 1 GENERAL overflow
3. Unknown plate → guest + GENERAL (gate only)
4. IN_SERVICE plate → **rejected at gate** — use claimed temp plate (ACTIVE company vehicle)

## Setup

```bash
npm install --prefix app
npm run dev:api
npm run db:seed   # if needed
npm run dev:app
```

### API URL (physical device)

Set in `app/.env`:

```env
EXPO_PUBLIC_API_URL=http://192.168.x.x:4000
# or a Cloudflare / ngrok HTTPS tunnel to :4000
```

## Demo logins (password `Admin@123`)

| Email | Company | Demo plates |
|---|---|---|
| `priya@yorkie.local` | York IE | `GJ01YK1001`, `GJ01YK1002` |
| `aisha@nexus.local` | Nexus | `MH12AB1234`, `MH12CD5678` |
| `meera@orbit.local` | Orbit | `GJ01GH3456` |

## End-to-end test

1. Login as Priya in the app
2. Admin Manual Desk / Check-in: `GJ01YK1001` → York company slot (B2Y/B3Y)
3. App **Current slot** shows bay + `COMPANY` pool
4. Mark car IN_SERVICE → Claim temp plate → admin check-in temp → company slot
5. History lists sessions; check-out at gate frees the bay
