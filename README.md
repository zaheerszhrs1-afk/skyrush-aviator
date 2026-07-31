# B9T9 — Aviator-style game platform

Production domain: `https://b9t9.games`

A first-reveal real-time crash-game structure inspired by the supplied layout, with original branding and artwork.

## Included in this first structure

- React + Vite + TypeScript responsive frontend
- Node.js + Express + Socket.IO authoritative game server
- Waiting, running and crashed round states
- Two independent bet slots
- Manual bet and cash-out
- Auto bet and auto cash-out controls in the UI
- Live multiplier history
- Live all-bets list and masked usernames
- Demo PKR wallet per browser connection
- Lightweight real-time chat
- Original SVG plane and game graphics

## Important scope note

This is a development/demo structure. Wallets, bets and chat are currently held in memory and reset when the server restarts. Real-money deposits, withdrawals, KYC, admin controls, PostgreSQL, Redis, authentication and production-grade provably-fair verification belong to the next phases.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

- Web: http://localhost:5173
- Server health: http://localhost:4000/health

## Production build

```bash
npm run build
npm run start
```

The server serves the built frontend from `apps/web/dist` after `npm run build`.

## AWS / VPS deployment direction

Use an Ubuntu VPS/EC2 instance with Node.js 22, Nginx and PM2 or Docker. Keep port 4000 private and proxy HTTPS/WebSocket traffic through Nginx.

## Deploy on Railway

This repository is configured as one Railway service. The Express/Socket.IO server builds and serves the Vite frontend, so do not create separate frontend and backend services.

1. Push the project files to the root of a GitHub repository.
2. In Railway, create a new project and choose **Deploy from GitHub repo**.
3. Select the repository. Railway will read `railway.json` and run:
   - Build: `npm run build`
   - Start: `npm run start`
   - Healthcheck: `/health`
4. Open the Railway service, go to **Settings → Networking**, and generate a public domain.
5. Do not manually set `PORT`; Railway supplies it automatically.
6. No Railway variables are required for the default single-service deployment. Leave `VITE_SOCKET_URL` and `CLIENT_ORIGIN` unset so the frontend and Socket.IO server use the same public domain.

After deployment, verify:

- App: `https://YOUR-DOMAIN.up.railway.app`
- Health: `https://YOUR-DOMAIN.up.railway.app/health`

### Runtime limitation

The current game, wallet, bet and chat state is stored in server memory. It resets whenever the Railway service restarts or redeploys. Keep the service at one replica until persistent storage and shared state (for example PostgreSQL and Redis) are implemented.
