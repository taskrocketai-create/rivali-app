"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Gauge, LoaderCircle, Mic, Square, Upload, UserRound } from "lucide-react";
import styles from "./race-day.module.css";

type SessionRow = {
  id: string;
  session_date: string;
  session_type: string;
  status: string;
  report_status: string;
  best_lap_sec: number | null;
  average_lap_sec: number | null;
  lap_count: number | null;
  created_at: string;
  recommendations?: { recommendation: string; confidence: string }[];
};

type RaceDayInfo = {
  name?: string;
  event_date?: string;
  tracks?: { name?: string } | { name?: string }[] | null;
};

type PassStatus = {
  pass: {
    id: string;
    className: string;
    driverName?: string | null;
    phone?: string | null;
    email?: string | null;
    drivingStyle?: string | null;
    intakeComplete: boolean;
    raceDay?: RaceDayInfo | RaceDayInfo[] | null;
  };
  sessions: SessionRow[];
};

function one<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function RaceDayClient() {
  const [status, setStatus] = useState<PassStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [recording, setRecording] = useState(false);
  const [debriefTranscript, setDebriefTranscript] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const raceDay = one(status?.pass.raceDay);
  const track = one(raceDay?.tracks);
  const latest = status?.sessions?.[0];
  const approvedRecommendation = latest?.recommendations?.[0];

  async function refresh() {
    const response = await fetch("/api/race-day/status", { cache: "no-store" });
    if (!response.ok) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setStatus(await response.json());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (status) void refresh();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [Boolean(status)]);

  async function claim(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/race-day/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not open this Race Day pass.");
      await refresh();
      setMessage("Race Day pass unlocked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open this Race Day pass.");
    } finally {
      setWorking(false);
    }
  }

  async function saveIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/race-day/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          driverName: form.get("driverName"),
          phone: form.get("phone"),
          email: form.get("email"),
          kartName: form.get("kartName"),
          chassisMake: form.get("chassisMake"),
          chassisModel: form.get("chassisModel"),
          drivingStyle: form.get("drivingStyle"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save your information.");
      await refresh();
      setMessage("Driver and kart saved. You are ready to upload runs.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your information.");
    } finally {
      setWorking(false);
    }
  }

  async function uploadRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/race-day/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not upload this run.");
      event.currentTarget.reset();
      await refresh();
      setMessage("Run uploaded. Rivali is analyzing it now.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload this run.");
    } finally {
      setWorking(false);
    }
  }

  async function startDebrief() {
    if (!latest) return setMessage("Upload the run before recording the debrief.");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return setMessage("Voice recording is not supported in this browser.");
    }
    setMessage("");
    setDebriefTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const form = new FormData();
        form.append("sessionId", latest.id);
        form.append("audio", blob, recorder.mimeType.includes("mp4") ? "debrief.m4a" : "debrief.webm");
        setWorking(true);
        setMessage("Transcribing your debrief...");
        try {
          const response = await fetch("/api/race-day/debrief", { method: "POST", body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Could not transcribe the debrief.");
          setDebriefTranscript(result.transcript ?? "");
          setMessage("Debrief saved with this run.");
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not save the debrief.");
        } finally {
          setWorking(false);
        }
      };
      recorder.start();
      setRecording(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Microphone access failed.");
    }
  }

  function stopDebrief() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  const reportLabel = useMemo(() => {
    if (!latest) return "No runs yet";
    if (latest.report_status === "pending_approval") return "Waiting for Alan's approval";
    if (latest.report_status === "approved") return "Approved";
    if (latest.report_status === "sent") return "Report sent";
    if (latest.status === "failed") return "Analysis needs attention";
    return "Rivali is processing";
  }, [latest]);

  if (loading) {
    return <div className={styles.center}><LoaderCircle className={styles.spin} /> Loading Race Day...</div>;
  }

  if (!status) {
    return (
      <section className={styles.heroCard}>
        <div className={styles.eyebrow}>RIVALI RACE DAY</div>
        <h1>Enter your pass code</h1>
        <p>Your pass is tied to today&apos;s track and class. Once you are in, your driver and kart information stay with you for the day.</p>
        <form onSubmit={claim} className={styles.codeForm}>
          <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="RIVALI CODE" autoCapitalize="characters" required minLength={6} />
          <button disabled={working}>{working ? "Opening..." : "Open Race Day"}</button>
        </form>
        {message && <div className={styles.notice}>{message}</div>}
      </section>
    );
  }

  return (
    <div className={styles.stack}>
      <section className={styles.eventCard}>
        <div>
          <div className={styles.eyebrow}>TODAY&apos;S PASS</div>
          <h1>{raceDay?.name ?? "Rivali Race Day"}</h1>
          <p>{track?.name ?? "Track"} · {status.pass.className}</p>
        </div>
        <div className={styles.passBadge}><CheckCircle2 /> ACTIVE</div>
      </section>

      {message && <div className={styles.notice}>{message}</div>}

      {!status.pass.intakeComplete ? (
        <form onSubmit={saveIntake} className={styles.card}>
          <div className={styles.cardHeading}><UserRound /><div><span>STEP 1</span><h2>Driver and kart</h2></div></div>
          <div className={styles.grid}>
            <label>Driver name<input name="driverName" required defaultValue={status.pass.driverName ?? ""} /></label>
            <label>Phone<input name="phone" type="tel" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Kart name<input name="kartName" required placeholder="Primary kart" /></label>
            <label>Chassis make<input name="chassisMake" /></label>
            <label>Chassis model<input name="chassisModel" /></label>
          </div>
          <label>How do you normally drive this class through the corner?
            <select name="drivingStyle" required defaultValue="">
              <option value="" disabled>Select one</option>
              <option value="lift">Lift</option>
              <option value="burp_throttle">Burp the throttle</option>
              <option value="full_throttle_brake_drag">Stay full throttle and drag the brake</option>
              <option value="other">Other / varies</option>
            </select>
          </label>
          <button className={styles.primary} disabled={working}>{working ? "Saving..." : "Save and continue"}</button>
        </form>
      ) : (
        <form onSubmit={uploadRun} className={styles.card}>
          <div className={styles.cardHeading}><Upload /><div><span>NEXT RUN</span><h2>Send Rivali the MyChron file</h2></div></div>
          <p className={styles.muted}>After you come off the track, choose the latest .xrk file. Rivali will analyze it automatically and put the report into Alan&apos;s approval queue.</p>
          <div className={styles.grid}>
            <label>Session type
              <select name="sessionType" defaultValue="practice">
                <option value="practice">Practice</option>
                <option value="hot laps">Hot laps</option>
                <option value="heat">Heat</option>
                <option value="feature">Feature</option>
              </select>
            </label>
            <label>MyChron file<input name="file" type="file" accept=".xrk" required /></label>
          </div>
          <button className={styles.primary} disabled={working}>{working ? "Uploading..." : "Upload and analyze"}</button>
        </form>
      )}

      {status.pass.intakeComplete && latest && (
        <section className={styles.card}>
          <div className={styles.cardHeading}><Mic /><div><span>AFTER THE RUN</span><h2>Tell Rivali what the kart did</h2></div></div>
          <p className={styles.muted}>Give Rivali 20 to 40 seconds. Mention entry, center, exit, whether T1-2 or T3-4 was worse, and anything that changed late in the run.</p>
          <button className={styles.primary} type="button" disabled={working} onClick={() => recording ? stopDebrief() : void startDebrief()}>
            {recording ? <><Square size={16} /> Stop and save debrief</> : <><Mic size={17} /> Record voice debrief</>}
          </button>
          {debriefTranscript && <div className={styles.transcript}><strong>Rivali heard:</strong><p>{debriefTranscript}</p></div>}
        </section>
      )}

      {approvedRecommendation && (
        <section className={styles.card}>
          <div className={styles.cardHeading}><CheckCircle2 /><div><span>APPROVED REPORT</span><h2>Rivali report is ready</h2></div></div>
          <p>{approvedRecommendation.recommendation}</p>
          <p className={styles.muted}>Interpretation confidence: {approvedRecommendation.confidence}. This is the version Alan approved for you.</p>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.cardHeading}><Gauge /><div><span>REPORT STATUS</span><h2>{reportLabel}</h2></div></div>
        {!status.sessions.length ? <p className={styles.muted}>Your first run will appear here after upload.</p> : (
          <div className={styles.runList}>
            {status.sessions.map((session) => (
              <div className={styles.run} key={session.id}>
                <div><strong>{session.session_type}</strong><small>{new Date(session.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></div>
                <div><strong>{session.best_lap_sec ? session.best_lap_sec.toFixed(3) : "..."}</strong><small>best lap</small></div>
                <div><strong>{session.report_status.replaceAll("_", " ")}</strong><small>{session.status}</small></div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
