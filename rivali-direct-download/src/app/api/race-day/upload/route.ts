import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_COOKIE, resolveRaceDayPass } from "@/lib/race-day-pass";

export const maxDuration = 60;

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const admin = createAdminClient();
  const pass = await resolveRaceDayPass(admin, cookieStore.get(PASS_COOKIE)?.value);
  if (!pass) return NextResponse.json({ error: "Race Day pass not found." }, { status: 401 });
  if (!pass.racer_id || !pass.kart_id || !pass.driving_style) {
    return NextResponse.json({ error: "Finish driver and kart intake before uploading a run." }, { status: 400 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const sessionType = String(form.get("sessionType") || "practice");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xrk")) {
    return NextResponse.json({ error: "Choose a MyChron .xrk file." }, { status: 400 });
  }
  if (!["practice", "hot laps", "heat", "feature"].includes(sessionType)) {
    return NextResponse.json({ error: "Invalid session type." }, { status: 400 });
  }
  if (file.size > 100 * 1024 * 1024) {
    return NextResponse.json({ error: "The maximum file size is 100 MB." }, { status: 400 });
  }

  const raceDay = relation(pass.race_days as unknown as { id: string; name: string; event_date: string; track_id: string; conditions: Record<string, unknown>; tracks: unknown } | { id: string; name: string; event_date: string; track_id: string; conditions: Record<string, unknown>; tracks: unknown }[]);
  if (!raceDay) return NextResponse.json({ error: "Race Day event not found." }, { status: 404 });
  const track = relation(raceDay.tracks as { id: string; name: string; start_finish?: unknown[]; turns?: Record<string, unknown> } | { id: string; name: string; start_finish?: unknown[]; turns?: Record<string, unknown> }[]);
  const turns = track?.turns ?? {};
  const turnCount = Object.keys(turns).filter((key) => /^[1-4]$/.test(key)).length;
  const metadata = turns._rivali as { groove?: unknown[] } | undefined;
  if (!track?.start_finish || track.start_finish.length < 2 || turnCount < 4 || !metadata?.groove || metadata.groove.length < 2) {
    return NextResponse.json({ error: "This track is not analysis-ready yet. Alan must finish Start/Finish, Turns 1-4, and the preferred groove." }, { status: 409 });
  }

  const sessionId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${pass.user_id}/${sessionId}/${safeName}`;
  const { error: uploadError } = await admin.storage.from("telemetry").upload(storagePath, file, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { error: sessionError } = await admin.from("sessions").insert({
    id: sessionId,
    user_id: pass.user_id,
    racer_id: pass.racer_id,
    kart_id: pass.kart_id,
    track_id: raceDay.track_id,
    session_date: raceDay.event_date,
    session_type: sessionType,
    raw_file_name: file.name,
    raw_storage_path: storagePath,
    setup: {
      class_name: pass.class_name,
      driving_style: pass.driving_style,
      telemetry_attached: true,
      source: "race_day_pass",
    },
    conditions: raceDay.conditions ?? {},
    handling_feedback: {},
    status: "queued",
    race_day_pass_id: pass.id,
    report_status: "processing",
  });
  if (sessionError) {
    await admin.storage.from("telemetry").remove([storagePath]);
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  const { error: jobError } = await admin.from("processing_jobs").insert({
    user_id: pass.user_id,
    session_id: sessionId,
    status: "queued",
  });
  if (jobError) {
    await admin.from("sessions").delete().eq("id", sessionId);
    await admin.storage.from("telemetry").remove([storagePath]);
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sessionId, message: "Run uploaded. Rivali is analyzing it now." });
}
