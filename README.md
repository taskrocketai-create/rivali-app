# Rivali | Turn Data Into Speed

Rivali is a motorsports telemetry and race-day analysis application focused on dirt oval kart racing. It combines AiM MyChron XRK session data, kart setup, track conditions, and contextual knowledge to support driver and crew-chief review.

## Repository layout

The application lives in [`rivali-direct-download/`](./rivali-direct-download/). See its [README](./rivali-direct-download/README.md) for architecture, local setup, deployment, telemetry worker, MVP features, and validation limitations.

- `rivali-direct-download/src/`: Next.js/React application
- `rivali-direct-download/worker/`: Python XRK processing worker
- `rivali-direct-download/supabase/`: database migrations
- `rivali-direct-download/knowledge/`: racing knowledge resources

## Reproducible development checks

From `rivali-direct-download/`:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

These are documented commands, not a claim that they have passed in this environment. Telemetry decoding also requires the Python worker dependencies described in the application README.

## CC-CLI engineering task candidate

**Task:** Improve reliability of XRK telemetry processing when a session contains incomplete or inconsistent timing/track-section data.

**Investigation:** Trace the worker's parsing and lap/section summarization paths; identify where malformed or missing section data can produce incorrect summaries or uncaught failures.

**Expected approach:** Add focused regression tests, preserve valid-session behavior, distinguish recoverable missing data from hard errors, and document any remaining calibration limitations. Validate with representative fixtures where available; do not invent measured racing results.

This is a proposed task scope, not a claim that a defect has already been reproduced or fixed.

## License

See [LICENSE](./LICENSE) (MIT). Before making this repository public, review source files, history, sample data, credentials, and third-party asset rights. A license does not remove confidentiality or privacy obligations.
