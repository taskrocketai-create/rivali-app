import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_COOKIE, resolveRaceDayPass } from "@/lib/race-day-pass";

const schema = z.object({
  driverName: z.string().min(1).max(120),
  phone: z.string().max(40).optional().default(""),
  email: z.string().email().optional().or(z.literal("")).default(""),
  kartName: z.string().min(1).max(120),
  chassisMake: z.string().max(120).optional().default(""),
  chassisModel: z.string().max(120).optional().default(""),
  drivingStyle: z.enum(["lift", "burp_throttle", "full_throttle_brake_drag", "other"]),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Complete the required driver information." }, { status: 400 });

  const cookieStore = await cookies();
  const admin = createAdminClient();
  const pass = await resolveRaceDayPass(admin, cookieStore.get(PASS_COOKIE)?.value);
  if (!pass) return NextResponse.json({ error: "Race Day pass not found." }, { status: 401 });

  const values = parsed.data;
  let racerId = pass.racer_id as string | null;
  let kartId = pass.kart_id as string | null;

  if (racerId) {
    const { error } = await admin.from("racers").update({
      name: values.driverName,
      primary_class: pass.class_name,
      updated_at: new Date().toISOString(),
    }).eq("id", racerId).eq("user_id", pass.user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await admin.from("racers").insert({
      user_id: pass.user_id,
      name: values.driverName,
      primary_class: pass.class_name,
      notes: "Created from Rivali Race Day Pass self-intake.",
    }).select("id").single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not save driver." }, { status: 500 });
    racerId = data.id;
  }

  if (kartId) {
    const { error } = await admin.from("karts").update({
      name: values.kartName,
      chassis_make: values.chassisMake || null,
      chassis_model: values.chassisModel || null,
      updated_at: new Date().toISOString(),
    }).eq("id", kartId).eq("user_id", pass.user_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await admin.from("karts").insert({
      user_id: pass.user_id,
      racer_id: racerId,
      name: values.kartName,
      chassis_make: values.chassisMake || null,
      chassis_model: values.chassisModel || null,
    }).select("id").single();
    if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not save kart." }, { status: 500 });
    kartId = data.id;
  }

  const { error: passError } = await admin.from("race_day_passes").update({
    driver_name: values.driverName,
    phone: values.phone || null,
    email: values.email || null,
    driving_style: values.drivingStyle,
    racer_id: racerId,
    kart_id: kartId,
    updated_at: new Date().toISOString(),
  }).eq("id", pass.id);
  if (passError) return NextResponse.json({ error: passError.message }, { status: 500 });

  return NextResponse.json({ ok: true, racerId, kartId });
}
