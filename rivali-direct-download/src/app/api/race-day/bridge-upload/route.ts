import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePassCode } from "@/lib/race-day-pass";

export const runtime = "nodejs";
export const maxDuration = 60;

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export async function POST(request: Request) {
  const passCode = normalizePassCode(request.headers.get("x-rivali-pass-code") ?? "");
  if (passCode.length < 6) return NextResponse.json({ error: "Race Day pass code is required." }, { status: 401 });

  const admin = createAdminClient();
  const { data: pass, error: passError } = await admin
    .from("race_day_passes")
    .select("id,user_id,race_day_id,status,class_name,driving_style,racer_id,kart_id,expires_at,race_days(id,name,event_date,track_id,status,conditions,expires_at,tracks(id,name,start_finish,turns))")
    .eq("code", passCode)
    .maybeSingle();

  if (passError || !pass) return NextResponse.json({ error: "Race Day pass not found." }, { status: 401 });
  if (!["paid", "active"].includes(pass.status) || new Date(pass.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Race Day pass is not active." }, { status: 403 });
  }
  if (!pass.racer_id || !pass.kart_id || !pass.driving_style) {
    return NextResponse.json({ error: "Driver must complete Race Day self-intake before the RS3 Bridge can upload." }, { status: 409 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const sessionType = String(form.get("sessionType") || "practice");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xrk")) {
    return NextResponse.json({ error: "RS3 Bridge must send a MyChron .xrk file." }, { status: 400 });
  }
  if (!["practice", "hot laps", "heat", "feature"].includes(sessionType)) {
    return NextResponse.json({ error: "Invalid session type." }, { status: 400 });
  }
  if (!file.size || file.size > 100 * 1024 * 1024) {
    return NextResponse.json({ error: "XRK files must be between 1 byte and 100 MB." }, { status: 413 });
  }

  const raceDay = one(pass.race_days as unknown as { id: string; event_date: string; track_id: string; conditions: Record<string, unknown>; tracks: unknown } | { id: string; event_date: string; track_id: string; conditions: Record<string, unknown>; tracks: unknown }[]);
  if (!raceDay) return NextResponse.json({ error: "Race Day event not found." }, { status: 404 });
  const track = one(raceDay.tracks as { id: string; name: string; start_finish?: unknown[]; turns?: Record<string, unknown> } | { id: string; name: string; start_finish?: unknown[]; turns?: Record<string, unknown> }[]);
  const turns = track?.turns ?? {};
  const turnCount = Object.keys(turns).filter((key) => /^[1-4]$/.test(key)).length;
  const metadata = turns._rivali as { groove?: unknown[] } | undefined;
  if (!track?.start_finish || track.start_finish.length < 2 || turnCount < 4 || !metadata?.groove || metadata.groove.length < 2) {
    return NextResponse.json({ error: "Track mapping is not analysis-ready." }, { status: 409 });
  }

  const sessionId = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${pass.user_id}/${sessionId}/${safeName}`;
  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage.from("telemetry").upload(storagePath, bytes, {
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
      source: "rs3_bridge",
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

  if (pass.status === "paid") {
    await admin.from("race_day_passes").update({ status: "active", claimed_at: new Date().toISOString() }).eq("id", pass.id);
  }

  return NextResponse.json({ ok: true, sessionId, fileName: file.name, message: "RS3 Bridge upload queued for Rivali analysis." });
}
