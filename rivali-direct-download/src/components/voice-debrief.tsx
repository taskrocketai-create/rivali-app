"use client";

import { useRef, useState } from "react";
import { Mic, Square, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { RaceSession, VoiceDebrief } from "@/types/domain";

export function VoiceDebriefRecorder({ sessions }: { sessions: RaceSession[] }) {
  const [sessionId, setSessionId] = useState(sessions[0]?.id ?? "");
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("");
  const [latest, setLatest] = useState<VoiceDebrief | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const supabase = createClient();

  async function startRecording() {
    if (!sessionId) return setMessage("Choose a session first.");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setMessage("Voice recording is not supported by this browser.");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      elapsedRef.current = 0;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => void saveRecording(recorder.mimeType || "audio/webm");
      recorder.start(1000);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
      setRecording(true);
      setMessage("Recording trackside debrief...");
    } catch { setMessage("Microphone access was denied or unavailable."); }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }

  async function saveRecording(mimeType: string) {
    setBusy(true);
    setMessage("Uploading and transcribing debrief...");
    let path = "";
    let savedDebrief: VoiceDebrief | null = null;
    try {
      const baseMimeType = mimeType.split(";")[0].toLowerCase();
      const blob = new Blob(chunksRef.current, { type: baseMimeType });
      if (!blob.size) throw new Error("The recording was empty.");
      if (blob.size > 25 * 1024 * 1024) throw new Error("Recording exceeds the 25 MB transcription limit.");
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      const userId = claimsData?.claims?.sub;
      if (claimsError || !userId) throw new Error("Your session expired. Sign in again.");
      const id = crypto.randomUUID();
      const ext = baseMimeType.includes("mp4") ? "m4a" : baseMimeType.includes("mpeg") ? "mp3" : baseMimeType.includes("ogg") ? "ogg" : baseMimeType.includes("wav") ? "wav" : "webm";
      path = `${userId}/${sessionId}/${id}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("voice-debriefs").upload(path, blob, { contentType: baseMimeType, upsert: false });
      if (uploadError) throw uploadError;
      const { data: debrief, error: insertError } = await supabase.from("voice_debriefs").insert({ id, user_id: userId, session_id: sessionId, audio_storage_path: path, audio_mime_type: baseMimeType, duration_seconds: elapsedRef.current, status: "uploaded" }).select("id,session_id,status,transcript,error,created_at").single();
      if (insertError) throw insertError;
      savedDebrief = debrief;
      const response = await fetch("/api/voice-debrief", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ debriefId: id }) });
      const result = await response.json() as { transcript?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Transcription failed.");
      setLatest({ ...debrief, status: "completed", transcript: result.transcript ?? null });
      setMessage("Debrief saved and transcribed.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Could not save debrief.";
      if (!savedDebrief && path) await supabase.storage.from("voice-debriefs").remove([path]);
      if (savedDebrief) {
        setLatest({ ...savedDebrief, status: "failed", error: errorMessage });
        setMessage(`Audio saved. Transcription failed: ${errorMessage}`);
      } else setMessage(errorMessage);
    } finally { setBusy(false); chunksRef.current = []; }
  }

  const mins = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const secs = (elapsed % 60).toString().padStart(2, "0");
  return <div className="card voice-debrief stack">
    <div><div className="eyebrow">TRACKSIDE NOTES</div><h2>Voice debrief</h2><p className="muted">Capture handling, setup, and track-condition feedback immediately after a run.</p></div>
    {message && <div className="notice">{message}</div>}
    <div className="field"><label>Session</label><select value={sessionId} onChange={(event) => setSessionId(event.target.value)} disabled={recording || busy}><option value="">Select a session</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.session_date} · {session.tracks?.name ?? "Track"} · {session.session_type}</option>)}</select></div>
    <button className={`button voice-button ${recording ? "recording" : ""}`} type="button" disabled={busy || !sessions.length} onClick={recording ? stopRecording : startRecording}>{recording ? <><Square size={20} /> Stop · {mins}:{secs}</> : busy ? <><Upload size={20} /> Processing...</> : <><Mic size={20} /> Record debrief</>}</button>
    {latest?.transcript && <div className="transcript"><strong>Transcript</strong><p>{latest.transcript}</p></div>}
  </div>;
}
