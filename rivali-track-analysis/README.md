# Rivali track test

A separate native build profile provides the small testing flow: sign in, choose the original MyChron `.xrk` file, run analysis, view and share a report. Internet is required for upload and analysis. Pending uploads and the latest ten reports remain on the phone; completed reports are also stored privately in the owner's Supabase `telemetry` folder.

The Python FastAPI service verifies the user's Supabase session and owner-prefixed object path, reads the XRK, and saves measured results. It does not enqueue the production worker, require a race-day code, infer setup advice, or estimate driver-versus-kart percentages. Missing or implausible lap timing is flagged. Channel ranges are raw recorded ranges, not causal diagnoses. Files are limited to 20 MB.

## Deployment

Deploy this directory to the Vercel FastAPI project `rivali-track-analysis`, with production `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. No service-role key is used. Existing owner-folder storage RLS must permit select/insert/update. The private `telemetry` bucket must allow `application/json` for reports alongside `application/octet-stream` and `application/x-binary` for XRK files. An XRK upload succeeding does not verify the report MIME allowance. Dependency versions are locked in `uv.lock`.

From `rivali-native`, run:

```
npx eas-cli@latest build --platform ios --profile track-test --auto-submit-with-profile production --non-interactive
```

The profile uses the existing Rivali App Store listing and signing credentials. It includes `EXPO_PUBLIC_RIVALI_MODE=track-test` and the analysis service URL. Production builds retain the regular Rivali home screen. This build adds Expo FileSystem, so install the new native build rather than publishing an OTA change to an older binary.

## Validation

Native: `npm run typecheck`, `npm run lint`, `npx expo-doctor`, and an iOS `expo export` with the track-test mode environment set.
Backend: `PYTHONPATH=rivali-track-analysis pytest rivali-track-analysis/tests`. The optional personal fixture is outside Git at `../track-test-fixture/a_0394.xrk`; that test skips when unavailable. The fixture contains 13 GPS channels and no usable completed lap timing. Storage/auth HTTP is mocked in these tests; phone upload, real account sign-in, and Share-sheet behavior need device testing.

Track test: install the TestFlight build, sign in, choose a fresh XRK in Files, run analysis using internet, compare lap timing to Race Studio 3, share the report, force-close/reopen, and open the saved report offline. Interrupt an upload and retry to check recovery. Try an invalid file and confirm a useful error without an invented report.
