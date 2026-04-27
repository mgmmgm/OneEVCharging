# OneEV Charging Monitor

A Node.js service that monitors AFCon EV charging stations, exposes a web dashboard, and sends Telegram updates.

## What This Project Does

- Polls AFCon station status on a fixed interval.
- Caches station data in memory.
- Fetches charging metrics (energy, duration, estimated charging speed).
- Serves a dashboard UI with station summaries and live status cards.
- Runs a Telegram bot for status queries and finish-charging notifications.

## Main Features

- Web dashboard at `/` with:
  - Total, Available, Charging, and Done counts
  - Per-station status badge
  - Max power, charging metrics, and done-since time
- API endpoints:
  - `GET /api/stations` (cached snapshot)
  - `POST /api/stations/refresh` (manual refresh + response)
- Telegram bot commands:
  - `/start`
  - `/status`
  - `/subscribe`
  - `/unsubscribe`
- Notification event when a station transitions to `PAUSED` (done charging)

## Tech Stack

- Node.js
- Express
- Axios
- node-telegram-bot-api
- Winston
- dotenv

## Project Structure

- `src/index.js` - application startup and shutdown handling
- `src/config.js` - environment-based configuration
- `src/services/stationMonitor.js` - polling, cache, status transition events
- `src/services/afconAuth.js` - AFCon login and socket-level charging info
- `src/bot/telegramBot.js` - Telegram command and notification handlers
- `src/web/server.js` - Express server and API routes
- `src/web/public/index.html` - dashboard UI
- `src/logger.js` - console + file logging (`app.log`)

## Prerequisites

- Node.js 18+ recommended
- npm
- AFCon EV account credentials
- Optional: Telegram bot token

## Environment Variables

Create a `.env` file in the project root.

Required for AFCon data:

- `AFCONEV_USERNAME`
- `AFCONEV_PASSWORD`

Optional / defaulted:

- `API_BASE_URL` (default: `https://account.afconev.co.il`)
- `POLL_INTERVAL_MS` (default: `300000`)
- `TELEGRAM_BOT_TOKEN` (if missing, bot is disabled)
- `PORT` (default: `3000`)

## Install

```bash
npm install
```

## Run Locally

Standard:

```bash
npm start
```

Development mode (watch):

```bash
npm run dev
```

PowerShell note (if script policy blocks `npm`):

```powershell
npm.cmd start
```

## Access

- Dashboard: `http://localhost:3000`
- Stations API: `http://localhost:3000/api/stations`

## Logging

Logs are written to:

- Console
- `app.log` (with rotation via Winston)

## Railway Deployment Notes

This project is Railway-friendly because it reads `PORT` from environment and starts with:

- `npm start`

Before deploy, set these Railway variables:

- `AFCONEV_USERNAME`
- `AFCONEV_PASSWORD`
- `TELEGRAM_BOT_TOKEN` (optional)
- `POLL_INTERVAL_MS` (optional)

After deployment:

1. Open service settings.
2. Enable Public Networking and generate a Railway domain.
3. Visit the generated URL.

## Git Tips Before First Push

- Keep `.env` out of source control.
- Keep `node_modules` out of source control.
- Consider ignoring `app.log` in `.gitignore` if not already ignored.

## License

ISC
