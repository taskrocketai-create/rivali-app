import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({ debriefId: z.string().uuid() });
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid debrief request." }, { status: 400 });

  const { data: debrief, error: readError } = await supabase
    .from("voice_debriefs")
    .select("id,audio_storage_path,audio_mime_type")
    .eq("id", parsed.data.debriefId)
    .eq("user_id", userId)
    .single();
  if (readError || !debrief) return NextResponse.json({ error: "Debrief not found." }, { status: 404 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 503 });

  await supabase.from("voice_debriefs").update({ status: "transcribing", error: null }).eq("id", debrief.id);
  try {
    const { data: audio, error: downloadError } = await supabase.storage
      .from("voice-debriefs")
      .download(debrief.audio_storage_path);
    if (downloadError) throw downloadError;

    const extension = debrief.audio_mime_type.includes("mp4") ? "m4a" : debrief.audio_mime_type.includes("mpeg") ? "mp3" : debrief.audio_mime_type.includes("ogg") ? "ogg" : debrief.audio_mime_type.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("file", new File([audio], `debrief.${extension}`, { type: debrief.audio_mime_type }));
    form.append("prompt", "Dirt oval kart racing debrief. Preserve racing terms, kart setup details, lap times, tire pressures, gearing, handling balance, driver feedback, and track conditions.");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const result = (await response.json()) as { text?: string; error?: { message?: string } };
    if (!response.ok || !result.text) throw new Error(result.error?.message ?? "Transcription failed.");

    const { error: updateError } = await supabase
      .from("voice_debriefs")
      .update({ transcript: result.text, status: "completed", error: null, updated_at: new Date().toISOString() })
      .eq("id", debrief.id);
    if (updateError) throw updateError;
    return NextResponse.json({ transcript: result.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    await supabase.from("voice_debriefs").update({ status: "failed", error: message, updated_at: new Date().toISOString() }).eq("id", debrief.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
