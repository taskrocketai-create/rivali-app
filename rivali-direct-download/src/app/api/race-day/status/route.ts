import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_COOKIE, resolveRaceDayPass, raceDayToken } from "@/lib/race-day-pass";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const admin = createAdminClient();
  const pass = await resolveRaceDayPass(admin, raceDayToken(request, cookieStore.get(PASS_COOKIE)?.value));
  if (!pass) return NextResponse.json({ error: "Race Day pass not found." }, { status: 401 });

  const { data: sessions } = await admin
    .from("sessions")
    .select("id,session_date,session_type,status,report_status,best_lap_sec,average_lap_sec,lap_count,created_at,recommendations(recommendation,confidence)")
    .eq("race_day_pass_id", pass.id)
    .order("created_at", { ascending: false })
    .limit(12);

  return NextResponse.json({
    pass: {
      id: pass.id,
      className: pass.class_name,
      driverName: pass.driver_name,
      phone: pass.phone,
      email: pass.email,
      drivingStyle: pass.driving_style,
      intakeComplete: Boolean(pass.racer_id && pass.kart_id),
      raceDay: pass.race_days,
    },
    sessions: (sessions ?? []).map((session) => ({
      ...session,
      recommendations: ["approved", "sent"].includes(session.report_status) ? session.recommendations : [],
    })),
  });
}
