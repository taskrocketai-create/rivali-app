import * as SecureStore from 'expo-secure-store';
const base = process.env.EXPO_PUBLIC_RIVALI_API_URL?.replace(/\/$/, '') ?? '';
const key = 'rivali.raceDayCredential';
export type Credential = { accessToken: string; expiresAt: string };
export type Run = { id: string; session_type: string; report_status: string; status: string; best_lap_sec: number | null; lap_count: number | null; recommendations: { recommendation: string; confidence: string }[] };
export type RaceStatus = { pass: { driverName: string; className: string; intakeComplete: boolean }; sessions: Run[] };
export async function saveCredential(value: Credential) { await SecureStore.setItemAsync(key, JSON.stringify(value)); }
export async function clearCredential() { await SecureStore.deleteItemAsync(key); }
export async function loadCredential(): Promise<Credential | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Credential;
    if (!value.accessToken || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
      await clearCredential(); return null;
    }
    return value;
  } catch { await clearCredential(); return null; }
}
export async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  if (!base.startsWith('https://')) throw new Error('Rivali connection has not been configured for this build.');
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${base}/api/race-day/${path}`, { ...options, headers, signal: controller.signal, redirect: 'error' });
    const payload = await response.json().catch(() => ({ error: 'Rivali returned an unreadable response.' }));
    if (!response.ok) {
      if (response.status === 401) await clearCredential();
      throw new Error(payload.error ?? 'Rivali could not finish this request.');
    }
    return payload as T;
  } finally { clearTimeout(timer); }
}
export function json(body: unknown): RequestInit { return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
export function appendFile(form: FormData, field: string, uri: string, name: string, type: string) {
  // React Native fetch accepts URI-backed multipart parts rather than browser File objects.
  form.append(field, { uri, name, type } as unknown as Blob);
}
export const webDashboard = base ? `${base}/dashboard` : '';
