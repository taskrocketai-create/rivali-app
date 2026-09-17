# Rivali — Turn Data Into Speed

Rivali is a hosted crew-chief application for dirt oval kart racers. It connects MyChron `.xrk` telemetry with the driver, kart, setup, weather, humidity, track condition, GPS line, and historical results.

## Architecture

- **Next.js 16 / React 19** — responsive web product and Vercel deployment
- **Supabase Auth** — email/password accounts
- **Supabase Postgres** — racer, kart, track, setup, session, telemetry, and recommendation history
- **Supabase Storage** — private raw `.xrk` files
- **Python worker** — proven `daq_tools` XRK decoding and oval corner analysis
- **Leaflet + Esri World Imagery** — satellite GPS trace and track marker editor

The web app never contains a Supabase secret key. Browser access uses the publishable key and is restricted by row-level security. Only the background worker uses the secret key.

## Local setup

1. Create a new Supabase project for Rivali.
2. Run `supabase/migrations/202609170001_initial_rivali_schema.sql` in the Supabase SQL editor.
3. In Supabase Auth URL Configuration, set the Site URL to your local or Vercel URL and add `https://YOUR_DOMAIN/auth/confirm` as a redirect URL.
4. Copy `.env.example` to `.env.local` and enter the project URL and publishable key.
5. Run `npm install` and `npm run dev`.

## Vercel

Push this directory to a new GitHub repository, import it into Vercel, and configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Do not configure `SUPABASE_SECRET_KEY` as a public variable or expose it to the browser.

## Telemetry worker

XRK decoding depends on Python data tooling and should not run inside a short Vercel request. Deploy `worker/` as one continuously running worker on Render, Railway, Fly.io, or another container host. Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` there.

```bash
cd worker
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python run_worker.py
```

Start with one worker instance. Job claiming is atomic, but one instance keeps operations and debugging simple for the first release.

## Current MVP

- Account creation, login, protected dashboard, and sign out
- Private user-owned records enforced by RLS
- Driver, kart, and track entry
- Conditions and setup capture at upload time
- Private `.xrk` upload and processing queue
- Lap summary, GPS trace, channel manifest, and oval corner summary
- Satellite trace view with saved start/finish and Turn 1–4 zones
- Session status and history
- Continuously editable knowledge base with source files, URLs, evidence levels, confidence, applicability, dispute/archive states, tags, and full-text indexing
- Recommendation evidence that links applicable active knowledge without treating opinions as measured facts

## Validation boundary

The XRK reader and lap summary were previously tested on a real public AiM sample. Oval splitting is mechanically tested, but its current radius threshold still needs calibration against a real dirt-oval `.xrk` file before recommendations should rely on its corner labels without review.

