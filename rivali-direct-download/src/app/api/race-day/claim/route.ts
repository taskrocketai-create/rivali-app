import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_COOKIE, createPassToken, hashPassToken, normalizePassCode } from "@/lib/race-day-pass";

const schema = z.object({ code: z.string().min(6).max(20) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the Race Day code." }, { status: 400 });

  const admin = createAdminClient();
  const code = normalizePassCode(parsed.data.code);
  const { data: pass, error } = await admin
    .from("race_day_passes")
    .select("id,status,class_name,price_cents,driver_name,racer_id,kart_id,expires_at,race_days(id,name,event_date,status,expires_at,tracks(id,name))")
    .eq("code", code)
    .maybeSingle();

  if (error || !pass) return NextResponse.json({ error: "That Race Day code was not found." }, { status: 404 });
  if (!["paid", "active"].includes(pass.status)) return NextResponse.json({ error: "That Race Day pass is not active." }, { status: 403 });
  if (new Date(pass.expires_at).getTime() < Date.now()) return NextResponse.json({ error: "That Race Day pass has expired." }, { status: 403 });

  const token = createPassToken();
  const { error: updateError } = await admin
    .from("race_day_passes")
    .update({
      status: "active",
      access_token_hash: hashPassToken(token),
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", pass.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const response = NextResponse.json({
    ok: true,
    pass: {
      className: pass.class_name,
      driverName: pass.driver_name,
      intakeComplete: Boolean(pass.racer_id && pass.kart_id),
      raceDay: pass.race_days,
    },
  });
  response.cookies.set(PASS_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(pass.expires_at),
  });
  return response;
}
