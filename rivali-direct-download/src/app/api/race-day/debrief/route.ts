import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { PASS_COOKIE, resolveRaceDayPass } from "@/lib/race-day-pass";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const admin = createAdminClient();
  const pass = await resolveRaceDayPass(admin, cookieStore.get(PASS_COOKIE)?.value);
  if (!pass) return NextResponse.json({ error: "Race Day pass not found." }, { status: 401 });

  const form = await request.formData();
  const sessionId = String(form.get("sessionId") || "");
  const audio = form.get("audio");
  if (!sessionId || !(audio instanceof File)) {
    return NextResponse.json({ error: "A run and audio recording are required." }, { status: 400 });
  }
  if (audio.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "Voice debrief is too large." }, { status: 413 });
  }

  const { data: session } = await admin
    .from("sessions")
    .select("id,user_id,race_day_pass_id")
    .eq("id", sessionId)
    .eq("race_day_pass_id", pass.id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Run not found for this pass." }, { status: 404 });

  const debriefId = crypto.randomUUID();
  const mime = audio.type || "audio/webm";
  const extension = mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : "webm";
  const storagePath = `${pass.user_id}/${sessionId}/${debriefId}.${extension}`;
  const bytes = await audio.arrayBuffer();

  const { error: uploadError } = await admin.storage.from("voice-debriefs").upload(storagePath, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { error: insertError } = await admin.from("voice_debriefs").insert({
    id: debriefId,
    user_id: pass.user_id,
    session_id: sessionId,
    audio_storage_path: storagePath,
    audio_mime_type: mime,
    status: "transcribing",
  });
  if (insertError) {
    await admin.storage.from("voice-debriefs").remove([storagePath]);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await admin.from("voice_debriefs").update({ status: "failed", error: "OPENAI_API_KEY is not configured." }).eq("id", debriefId);
    return NextResponse.json({ error: "Voice transcription is not configured." }, { status: 503 });
  }

  try {
    const transcriptForm = new FormData();
    transcriptForm.append("model", "gpt-4o-mini-transcribe");
    transcriptForm.append("file", new File([bytes], `debrief.${extension}`, { type: mime }));
    transcriptForm.append("prompt", "Dirt oval kart racing debrief. Preserve corner references, tight or loose handling, brake drag, throttle lift or burp, RPM comments, tire feel, setup notes, and track-condition language.");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcriptForm,
    });
    const result = await response.json() as { text?: string; error?: { message?: string } };
    if (!response.ok || !result.text) throw new Error(result.error?.message ?? "Transcription failed.");

    await admin.from("voice_debriefs").update({
      transcript: result.text,
      status: "completed",
      error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", debriefId);

    return NextResponse.json({ ok: true, transcript: result.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    await admin.from("voice_debriefs").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", debriefId);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
