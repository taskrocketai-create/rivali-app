# Rivali native iOS app

Expo SDK 57 / React Native client for the existing Next.js backend. This is a native screen implementation; it does not load the site inside a WebView.

Implemented: existing-account email/password sign-in with Keychain-backed session persistence and foreground token refresh; run history and approved reports; native WebRTC Ask Doug calls with authenticated server-minted ephemeral credentials; Race Day code authentication, intake, Files picker XRK upload, microphone debrief recording and transcription. The original red/silver/black artwork and compact microphone controls are retained.

## Configure

Copy `.env.example` to `.env.local`, then set the HTTPS backend URL and the Rivali project's publishable Supabase URL/key. No service-role or OpenAI secret belongs in this app. Native auth uses existing Supabase users and existing RLS policies. Deploy the backend changes on this branch before testing native Race Day access or Doug calls. The backend must be reachable without a Vercel dashboard sign-in wall. Do not put a Vercel protection-bypass secret into an Expo public variable.

## Validate / build

```sh
npm ci
npm run typecheck
npm run lint
npm run export:ios
npx expo-doctor
npx eas-cli@latest init
npx eas-cli@latest build --platform ios --profile ios-simulator
npx eas-cli@latest build --platform ios --profile production
```

The simulator profile validates native compilation without Apple signing; its artifact cannot be installed on a physical iPhone or uploaded to TestFlight. Production builds need the Apple distribution certificate and provisioning profile. Use the existing Expo account `taskrocket`. Apple login / 2FA must be handled in Expo's local terminal or account UI, never by pasting a password into chat.

Create the App Store Connect app for `com.taskrocket.rivali`, put its numeric Apple ID into `submit.production.ios.ascAppId`, and authorize EAS Submit with an App Store Connect API key or the documented Apple app-specific password flow. Then submit a successful production build to TestFlight with `npx eas-cli@latest submit --platform ios --profile production --id BUILD_ID`. Do not submit for public App Store review as part of this task.

## Limits and device acceptance

- This is an initial native client, not complete feature parity. Track mapping, admin report approval, setup editing, comparison charts, and realtime data-changing Doug tools remain in the web app.
- Native Doug discusses the selected server-owned run and approved recommendations. It has no knowledge retrieval or database-writing tools yet; its instructions prohibit invented setup numbers or unsupported driver-versus-kart percentages. Do not present this build as the final knowledge-grounded coaching release.
- Simulator or Metro export success is not evidence that microphone, earbud audio, Files/iCloud upload, login restoration, or live calls work on hardware. Test those on iPhone/iPad before distribution. Test revoked/expired credentials, permission denial, airplane mode, call cancellation, backgrounding, and server failure.
- iOS permission requests are only triggered by user actions. Calls stop on close, cancellation, screen unmount, or app background. No background microphone service is configured.
- The repository's branded R icon is 128×128. It is preserved as supplied; a higher-resolution source is desirable for release artwork.

Official references checked 2026-10-06: https://docs.expo.dev/versions/v57.0.0/ ; https://docs.expo.dev/build/setup/ ; https://docs.expo.dev/submit/ios/ ; https://supabase.com/docs/guides/auth/quickstarts/react-native ; https://developers.openai.com/api/docs/guides/voice-webrtc ; https://github.com/expo/config-plugins/tree/main/packages/react-native-webrtc
