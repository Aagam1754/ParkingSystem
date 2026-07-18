# ParkLane Member App (Expo SDK 54)

React Native companion for corporate members — current slot, vehicles, in-service / temp plate, and session history.

Uses the same Express API as the admin panel (`/api/auth`, `/api/me/*`).

## Setup

```bash
# from repo root
npm install --prefix app

# ensure API is running
npm run dev:api
```

## Run

```bash
npm run dev:app
# or: npm start --prefix app
```

Then open in Expo Go, iOS Simulator, or Android emulator.

### API URL

Default:

| Environment | URL |
|---|---|
| iOS simulator | `http://localhost:4000` |
| Android emulator | `http://10.0.2.2:4000` |
| Physical device | set `EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000` |

Example:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000 npm run dev:app
```

## Demo login

| Email | Password |
|---|---|
| `aisha@nexus.local` | `Admin@123` |
| `meera@orbit.local` | `Admin@123` |
| `neha@pixel.local` | `Admin@123` |

Admins (`admin@parking.local`) are rejected — use the web control panel.

## Screens

1. **Current slot** — open parking session for this member
2. **My vehicles** — mark `IN_SERVICE` / `ACTIVE`, claim temp plate
3. **History** — past sessions
4. **Profile** — company info + sign out
