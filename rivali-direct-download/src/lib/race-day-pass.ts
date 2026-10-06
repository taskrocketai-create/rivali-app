import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PASS_COOKIE = "rivali_race_day_pass";

export function normalizePassCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function createPassToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPassToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function resolveRaceDayPass(admin: SupabaseClient, token: string | undefined) {
  if (!token) return null;
  const tokenHash = hashPassToken(token);
  const { data, error } = await admin
    .from("race_day_passes")
    .select("id,user_id,race_day_id,status,class_name,price_cents,driver_name,phone,email,driving_style,racer_id,kart_id,expires_at,race_days(id,name,event_date,track_id,status,conditions,expires_at,tracks(id,name,start_finish,turns))")
    .eq("access_token_hash", tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  if (!["paid", "active"].includes(data.status)) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

// Native clients use the same hashed, expiring Race Day credential as web cookies.
export function raceDayToken(request: Request, cookieToken?: string) {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization);
    return match?.[1];
  }
  return cookieToken;
}
