"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Flag, Gauge, Mic2, ShieldCheck, Upload, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import styles from "./report-service.module.css";

type Recommendation = {
  recommendation?: string | null;
  confidence?: string | null;
  evidence?: unknown;
};

type Session = {
  id: string;
  session_date: string;
  session_type: string;
  status: string;
  best_lap_sec?: number | null;
  average_lap_sec?: number | null;
  consistency_stdev_sec?: number | null;
  lap_count?: number | null;
  setup?: Record<string, unknown> | null;
  conditions?: Record<string, unknown> | null;
  raw_file_name?: string | null;
  tracks?: { id: string; name: string } | null;
  racers?: { id: string; name: string } | null;
  karts?: { id: string; name: string } | null;
  recommendations?: Recommendation[] | Recommendation | null;
};

type Telemetry = {
  session_id: string;
  laps?: unknown[] | null;
  channel_manifest?: string[] | null;
  corner_analysis?: Record<string, unknown> | null;
};

type Debrief = {
  session_id: string;
  status: string;
  transcript?: string | null;
  created_at: string;
};

type RaceDay = {
  eventName: string;
  trackName: string;
  date: string;
  airTempF: string;
  trackTempF: string;
  humidityPct: string;
  barometerInHg: string;
  wind: string;
  cloudCover: string;
  trackCondition: string;
  surfaceNotes: string;
};

type ClientInfo = {
  clientName: string;
  teamName: string;
  phone: string;
  email: string;
  kartNumber: string;
  className: string;
};

const blankRaceDay: RaceDay = {
  eventName: "",
  trackName: "",
  date: new Date().toISOString().slice(0, 10),
  airTempF: "",
  trackTempF: "",
  humidityPct: "",
  barometerInHg: "",
  wind: "",
  cloudCover: "",
  trackCondition: "",
  surfaceNotes: "",
};

const blankClient: ClientInfo = {
  clientName: "",
  teamName: "",
  phone: "",
  email: "",
  kartNumber: "",
  className: "",
};

function hasChannel(channels: string[], terms: string[]) {
  return channels.some((channel) => terms.some((term) => channel.toLowerCase().includes(term)));
}

function confidenceFor(session: Session, telemetry?: Telemetry, debrief?: Debrief) {
  const channels = telemetry?.channel_manifest ?? [];
  const lapCount = Number(session.lap_count ?? telemetry?.laps?.length ?? 0);
  const hasGps = hasChannel(channels, ["gps latitude", "gps lat", "latitude"]);
  const hasSpeed = hasChannel(channels, ["gps speed", "speed"]);
  const hasRpm = hasChannel(channels, ["rpm"]);
  const hasG = hasChannel(channels, ["lateral", "accel", "g force", "g-force"]);
  const hasSteering = hasChannel(channels, ["steer"]);
  const hasBrake = hasChannel(channels, ["brake"]);
  const hasSetup = Boolean(session.setup && Object.values(session.setup).some((value) => value != null && value !== ""));
  const hasDebrief = Boolean(debrief?.transcript?.trim());

  let dataScore = 20;
  if (lapCount >= 3) dataScore += 20;
  if (lapCount >= 6) dataScore += 10;
  if (hasGps) dataScore += 20;
  if (hasSpeed) dataScore += 15;
  if (hasRpm) dataScore += 10;
  if (hasG) dataScore += 5;
  dataScore = Math.min(100, dataScore);

  const rec = Array.isArray(session.recommendations) ? session.recommendations[0] : session.recommendations;
  let interpretationScore = Math.round(dataScore * 0.72);
  if (hasDebrief) interpretationScore += 10;
  if (hasSetup) interpretationScore += 5;
  if (rec?.confidence === "high") interpretationScore += 10;
  else if (rec?.confidence === "medium") interpretationScore += 5;
  if (!hasSteering) interpretationScore -= 4;
  if (!hasBrake) interpretationScore -= 3;
  interpretationScore = Math.max(0, Math.min(100, interpretationScore));

  const level = interpretationScore >= 75 ? "High" : interpretationScore >= 45 ? "Medium" : "Low";
  const dataLevel = dataScore >= 75 ? "High" : dataScore >= 45 ? "Medium" : "Low";
  const missing = [!hasSteering ? "steering angle" : null, !hasBrake ? "brake pressure" : null, !hasG ? "G-force" : null].filter(Boolean) as string[];

  return {
    dataScore,
    dataLevel,
    interpretationScore,
    level,
    safe: interpretationScore >= 45,
    missing,
    hasDebrief,
    hasSetup,
    recommendation: rec?.recommendation ?? null,
  };
}

export function ReportServiceClient({ sessions, telemetry, debriefs }: { sessions: Session[]; telemetry: Telemetry[]; debriefs: Debrief[] }) {
  const supabase = createClient();
  const completed = sessions.filter((session) => session.status === "completed");
  const [selectedId, setSelectedId] = useState(completed[0]?.id ?? sessions[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [raceDay, setRaceDay] = useState<RaceDay>(blankRaceDay);
  const [raceDayStarted, setRaceDayStarted] = useState(false);
  const [client, setClient] = useState<ClientInfo>(blankClient);

  const session = sessions.find((item) => item.id === selectedId) ?? completed[0] ?? sessions[0];
  const sessionTelemetry = telemetry.find((item) => item.session_id === session?.id);
  const debrief = debriefs.find((item) => item.session_id === session?.id);
  const confidence = useMemo(() => (session ? confidenceFor(session, sessionTelemetry, debrief) : null), [session, sessionTelemetry, debrief]);

  useEffect(() => {
    const saved = window.localStorage.getItem("rivali-active-raceday");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as RaceDay;
        setRaceDay({ ...blankRaceDay, ...parsed });
        setRaceDayStarted(true);
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const existingClient = (session.setup?.client_info ?? {}) as Partial<ClientInfo>;
    setClient({
      ...blankClient,
      clientName: existingClient.clientName ?? session.racers?.name ?? "",
      teamName: existingClient.teamName ?? "",
      phone: existingClient.phone ?? "",
      email: existingClient.email ?? "",
      kartNumber: existingClient.kartNumber ?? "",
      className: existingClient.className ?? String(session.setup?.class_name ?? ""),
    });
    setRaceDay((current) => ({ ...current, trackName: current.trackName || session.tracks?.name || "" }));
  }, [session]);

  function updateRaceDay(field: keyof RaceDay, value: string) {
    setRaceDay((current) => ({ ...current, [field]: value }));
  }

  function updateClient(field: keyof ClientInfo, value: string) {
    setClient((current) => ({ ...current, [field]: value }));
  }

  async function startRaceDay() {
    setRaceDayStarted(true);
    window.localStorage.setItem("rivali-active-raceday", JSON.stringify(raceDay));
    setMessage(`Race day started${raceDay.trackName ? ` at ${raceDay.trackName}` : ""}. This context will carry into each report.`);
  }

  async function saveClientInfo() {
    if (!session) return;
    setBusy(true);
    setMessage("");
    try {
      const setup = { ...(session.setup ?? {}), class_name: client.className || session.setup?.class_name || null, client_info: client };
      const conditions = {
        ...(session.conditions ?? {}),
        race_day: raceDay,
        air_temp_f: Number(raceDay.airTempF) || session.conditions?.air_temp_f || null,
        humidity_pct: Number(raceDay.humidityPct) || session.conditions?.humidity_pct || null,
        track_condition: raceDay.trackCondition || session.conditions?.track_condition || null,
      };
      const { error } = await supabase.from("sessions").update({ setup, conditions }).eq("id", session.id);
      if (error) throw error;
      setMessage("Client and race-day context saved to this report.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save client information.");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!session || !confidence) return;
    setBusy(true);
    setMessage("");
    try {
      const nextSetup = {
        ...(session.setup ?? {}),
        class_name: client.className || session.setup?.class_name || null,
        client_info: client,
        report_review: {
          status: confidence.safe ? "approved" : "approved_observation_only",
          approved_at: new Date().toISOString(),
          interpretation_confidence: confidence.interpretationScore,
          data_quality_confidence: confidence.dataScore,
          recommendation_safe: confidence.safe,
        },
      };
      const nextConditions = { ...(session.conditions ?? {}), race_day: raceDay };
      const { error } = await supabase.from("sessions").update({ setup: nextSetup, conditions: nextConditions }).eq("id", session.id);
      if (error) throw error;
      setMessage(confidence.safe ? "Approved. This personalized report is cleared for client delivery." : "Approved as observation-only. Rivali will not present setup recommendations as conclusions.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not approve this report.");
    } finally {
      setBusy(false);
    }
  }

  if (!session || !confidence) {
    return <div className={styles.empty}><h1>Rivali Report Service</h1><p>Start the race day, then import the first MyChron session.</p></div>;
  }

  const recommendationText = confidence.safe
    ? confidence.recommendation ?? "No grounded recommendation has been generated yet."
    : "More data is needed before Rivali makes a setup interpretation. The client report should describe only the measured behavior and the limits of the available data.";

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <div><div className={styles.eyebrow}>RIVALI RACING DATA</div><h1>Three-minute report service</h1><p>Start the race day once, then move each client from MyChron data to a personalized approved report in under three minutes.</p></div>
        <div className={styles.goal}>TARGET <strong>&lt; 3:00</strong></div>
      </section>

      <section className={styles.intakeShell}>
        <div className={styles.intakeHead}><div><Flag size={19} /><div><span>START OF RACE DAY</span><strong>{raceDayStarted ? "Race day active" : "Set today’s shared context once"}</strong></div></div><button className={styles.compactButton} type="button" onClick={() => void startRaceDay()}>{raceDayStarted ? "Update Race Day" : "Start Race Day"}</button></div>
        <div className={styles.intakeGrid}>
          <label>Event<input value={raceDay.eventName} onChange={(e) => updateRaceDay("eventName", e.target.value)} placeholder="Saturday Night Race" /></label>
          <label>Track<input value={raceDay.trackName} onChange={(e) => updateRaceDay("trackName", e.target.value)} placeholder="Track name" /></label>
          <label>Date<input type="date" value={raceDay.date} onChange={(e) => updateRaceDay("date", e.target.value)} /></label>
          <label>Track condition<input value={raceDay.trackCondition} onChange={(e) => updateRaceDay("trackCondition", e.target.value)} placeholder="Tacky / drying / slick" /></label>
          <label>Air temp °F<input inputMode="decimal" value={raceDay.airTempF} onChange={(e) => updateRaceDay("airTempF", e.target.value)} /></label>
          <label>Track temp °F<input inputMode="decimal" value={raceDay.trackTempF} onChange={(e) => updateRaceDay("trackTempF", e.target.value)} /></label>
          <label>Humidity %<input inputMode="decimal" value={raceDay.humidityPct} onChange={(e) => updateRaceDay("humidityPct", e.target.value)} /></label>
          <label>Barometer inHg<input inputMode="decimal" value={raceDay.barometerInHg} onChange={(e) => updateRaceDay("barometerInHg", e.target.value)} /></label>
          <label>Wind<input value={raceDay.wind} onChange={(e) => updateRaceDay("wind", e.target.value)} placeholder="8 mph W" /></label>
          <label>Cloud cover<input value={raceDay.cloudCover} onChange={(e) => updateRaceDay("cloudCover", e.target.value)} placeholder="Clear / 40% / overcast" /></label>
          <label className={styles.span2}>Surface / prep notes<input value={raceDay.surfaceNotes} onChange={(e) => updateRaceDay("surfaceNotes", e.target.value)} placeholder="Moisture, bite, groove movement, recent prep" /></label>
        </div>
      </section>

      <section className={styles.flow} aria-label="Report workflow">
        <div className={styles.step}><Upload size={18} /><span>1</span><strong>Import run</strong><small>MyChron XRK</small></div>
        <div className={styles.step}><UserRound size={18} /><span>2</span><strong>Client info</strong><small>Personalize report</small></div>
        <div className={styles.step}><Mic2 size={18} /><span>3</span><strong>Driver debrief</strong><small>Voice first</small></div>
        <div className={styles.step}><Gauge size={18} /><span>4</span><strong>Analyze</strong><small>Data before AI</small></div>
        <div className={styles.step}><ShieldCheck size={18} /><span>5</span><strong>Approve & send</strong><small>Confidence gate</small></div>
      </section>

      <div className={styles.selectRow}><label htmlFor="report-session">Current run</label><select id="report-session" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setMessage(""); }}>{sessions.map((item) => <option key={item.id} value={item.id}>{item.racers?.name ?? "Driver"} · {item.tracks?.name ?? "Track"} · {item.session_type} · {item.session_date}</option>)}</select></div>

      <section className={styles.clientShell}>
        <div className={styles.intakeHead}><div><UserRound size={19} /><div><span>CLIENT INFO</span><strong>Personalize this report</strong></div></div><button className={styles.compactButton} type="button" disabled={busy} onClick={() => void saveClientInfo()}>{busy ? "Saving…" : "Save Client"}</button></div>
        <div className={styles.clientGrid}>
          <label>Driver / client name<input value={client.clientName} onChange={(e) => updateClient("clientName", e.target.value)} /></label>
          <label>Team<input value={client.teamName} onChange={(e) => updateClient("teamName", e.target.value)} placeholder="Optional" /></label>
          <label>Kart #<input value={client.kartNumber} onChange={(e) => updateClient("kartNumber", e.target.value)} /></label>
          <label>Class<input value={client.className} onChange={(e) => updateClient("className", e.target.value)} /></label>
          <label>Phone<input type="tel" value={client.phone} onChange={(e) => updateClient("phone", e.target.value)} placeholder="For report text" /></label>
          <label>Email<input type="email" value={client.email} onChange={(e) => updateClient("email", e.target.value)} placeholder="Optional" /></label>
        </div>
        <div className={styles.privacy}>Client contact, setup, and debrief information are private report data. Setup information is optional and is not shared with other racers.</div>
      </section>

      {message && <div className={styles.notice}>{message}</div>}

      <section className={`${styles.summary} ${styles[confidence.level.toLowerCase()]}`}>
        <div className={styles.summaryHead}><div><div className={styles.eyebrow}>RIVALI REPORT READY</div><h2>{client.clientName || session.racers?.name || "Driver"}{client.kartNumber ? ` · #${client.kartNumber}` : ""}{client.className ? ` · ${client.className}` : ""}</h2><p className={styles.reportMeta}>{raceDay.eventName || raceDay.trackName || session.tracks?.name || "Race Day"}{client.teamName ? ` · ${client.teamName}` : ""}</p></div><div className={styles.confidenceRing}><strong>{confidence.interpretationScore}%</strong><span>{confidence.level}</span></div></div>

        <div className={styles.metrics}><div><span>Best lap</span><strong>{session.best_lap_sec != null ? `${session.best_lap_sec.toFixed(3)}s` : "—"}</strong></div><div><span>Clean laps</span><strong>{session.lap_count ?? "—"}</strong></div><div><span>Data quality</span><strong>{confidence.dataScore}% · {confidence.dataLevel}</strong></div><div><span>Interpretation</span><strong>{confidence.interpretationScore}% · {confidence.level}</strong></div></div>

        <div className={styles.grid}>
          <div className={styles.card}><h3>Evidence check</h3><p><b>Driver debrief:</b> {confidence.hasDebrief ? "Included" : "Not captured"}</p><p><b>Setup:</b> {confidence.hasSetup ? "Included" : "Not provided"}</p><p><b>Missing channels:</b> {confidence.missing.length ? confidence.missing.join(", ") : "None material"}</p><p><b>Track conditions:</b> {raceDay.trackCondition || String(session.conditions?.track_condition ?? "Not recorded")}</p></div>
          <div className={styles.card}><h3>Interpretation rule</h3>{confidence.safe ? <p>Rivali has enough supporting evidence to present a ranked interpretation, with the confidence level shown to the client.</p> : <p className={styles.warning}><AlertTriangle size={17} /> The evidence is not strong enough for a setup diagnosis. Do not fill the gap with invented advice.</p>}</div>
        </div>

        <div className={styles.readout}><span>{confidence.safe ? "Grounded recommendation" : "Observation-only report"}</span><p>{recommendationText}</p></div>
        {debrief?.transcript && <details className={styles.details}><summary>Driver debrief transcript</summary><p>{debrief.transcript}</p></details>}
        <div className={styles.actions}><button className={styles.secondary} type="button">Edit report</button><button className={styles.secondary} type="button">Reject / re-run</button><button className={styles.primary} type="button" disabled={busy} onClick={() => void approve()}>{busy ? "Approving…" : confidence.safe ? "Approve & Send" : "Approve Observation-Only"}</button></div>
      </section>
    </div>
  );
}
