"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { CheckCircle2, RotateCcw, Pencil, Send } from "lucide-react";
import styles from "./report-service.module.css";

type TracePoint = { lat: number; lng: number; time?: number; speed_mph?: number };
type Lap = { lap_number?: number; lap_time_sec?: number; duration_sec?: number };
type Track = {
  id: string;
  name: string;
  start_finish?: { lat: number; lng: number }[] | null;
  turns?: Record<string, { lat: number; lng: number; radius_m?: number }> | null;
};
type Recommendation = { recommendation: string; confidence: string; evidence?: unknown[] };
type Session = {
  id: string;
  session_date: string;
  session_type: string;
  status: string;
  best_lap_sec: number | null;
  average_lap_sec: number | null;
  consistency_stdev_sec: number | null;
  lap_count: number | null;
  setup: Record<string, unknown>;
  conditions: Record<string, unknown>;
  raw_file_name: string;
  tracks: Track | null;
  racers: { id: string; name: string } | null;
  karts: { id: string; name: string } | null;
  recommendations?: Recommendation[];
};
type Telemetry = {
  session_id: string;
  laps: Lap[] | null;
  gps_trace: TracePoint[] | null;
  channel_manifest: string[] | null;
  corner_analysis: { diagnostic?: string; turns?: Record<string, unknown>; lap_timing?: { source?: string; diagnostic?: string } } | null;
};
type Debrief = { session_id: string; transcript: string | null; created_at: string };
type ConfidenceBand = "high" | "medium" | "low";

const importantChannels = [
  ["GPS", ["gps latitude", "gps longitude"]],
  ["Speed", ["gps speed", "speed"]],
  ["RPM", ["rpm"]],
  ["Lateral G", ["lateral g", "lat accel", "gps lateral"]],
  ["Brake", ["brake"]],
  ["Steering", ["steering"]],
  ["Tire temp", ["tire temp", "tyre temp"]],
] as const;

function hasChannel(manifest: string[], needles: readonly string[]) {
  const normalized = manifest.map((value) => value.toLowerCase());
  return needles.some((needle) => normalized.some((value) => value.includes(needle)));
}

function scoreBand(score: number): ConfidenceBand {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function bandLabel(band: ConfidenceBand) {
  return band[0].toUpperCase() + band.slice(1);
}

function confidenceClass(band: ConfidenceBand) {
  return band === "high" ? styles.high : band === "medium" ? styles.medium : styles.low;
}

function summarizeIssue(session: Session, telemetry?: Telemetry) {
  const turnData = telemetry?.corner_analysis?.turns;
  if (turnData && Object.keys(turnData).length) return "Corner-speed and line consistency";
  if ((session.consistency_stdev_sec ?? 0) > 0.35) return "Lap-to-lap consistency";
  if (session.status !== "completed") return "Analysis still processing";
  return "Run performance review";
}

export function ReportServiceClient({
  sessions,
  telemetry,
  debriefs,
}: {
  sessions: Session[];
  telemetry: Telemetry[];
  debriefs: Debrief[];
}) {
  const completed = useMemo(() => sessions.filter((session) => session.status === "completed"), [sessions]);
  const [sessionId, setSessionId] = useState(completed[0]?.id ?? sessions[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const session = sessions.find((item) => item.id === sessionId) ?? completed[0] ?? sessions[0];
  const sessionTelemetry = telemetry.find((item) => item.session_id === session?.id);
  const debrief = debriefs.find((item) => item.session_id === session?.id);
  const recommendation = session?.recommendations?.[0];
  const manifest = sessionTelemetry?.channel_manifest ?? [];

  const dataScore = useMemo(() => {
    if (!session) return 0;
    let score = 0;
    if (session.status === "completed") score += 25;
    if ((session.lap_count ?? 0) >= 5) score += 20;
    if ((session.lap_count ?? 0) >= 8) score += 5;
    if (hasChannel(manifest, ["gps latitude", "latitude"]) && hasChannel(manifest, ["gps longitude", "longitude"])) score += 20;
    if (hasChannel(manifest, ["speed"])) score += 10;
    if (hasChannel(manifest, ["rpm"])) score += 10;
    if (hasChannel(manifest, ["lateral g", "lat accel", "gps lateral"])) score += 10;
    return Math.min(100, score);
  }, [manifest, session]);

  const interpretationScore = useMemo(() => {
    if (!session) return 0;
    let score = Math.round(dataScore * 0.62);
    if (debrief?.transcript) score += 12;
    if (recommendation?.confidence === "high") score += 18;
    else if (recommendation?.confidence === "medium") score += 10;
    else if (recommendation?.confidence === "low") score += 2;
    if (!hasChannel(manifest, ["steering"])) score -= 5;
    if (!hasChannel(manifest, ["brake"])) score -= 4;
    return Math.max(0, Math.min(100, score));
  }, [dataScore, debrief?.transcript, manifest, recommendation?.confidence, session]);

  const dataBand = scoreBand(dataScore);
  const interpretationBand = scoreBand(interpretationScore);
  const safeToPublish = dataScore >= 50 && interpretationScore >= 50 && Boolean(recommendation?.recommendation);
  const missingChannels = importantChannels.filter(([, needles]) => !hasChannel(manifest, needles)).map(([label]) => label);
  const issue = session ? summarizeIssue(session, sessionTelemetry) : "No session selected";

  if (!session) {
    return <div className={`${styles.card} ${styles.empty}`}>Upload and process a MyChron session to build the first Rivali report.</div>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <div>
          <div className={styles.eyebrow}>RIVALI REPORT SERVICE</div>
          <h1>Report Ready</h1>
          <p className="muted">Review the evidence, confidence and track location before anything goes to the racer.</p>
        </div>
        <div className={`field ${styles.select}`}>
          <label>Run</label>
          <select value={session.id} onChange={(event) => { setSessionId(event.target.value); setMessage(""); }}>
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.session_date} · {item.racers?.name ?? "Driver"} · {item.tracks?.name ?? "Track"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

      <div className={styles.grid}>
        <TrackReportMap session={session} telemetry={sessionTelemetry} />

        <div className={styles.stack}>
          <section className={`${styles.card} ${styles.summary}`}>
            <div>
              <div className={styles.eyebrow}>BIGGEST ISSUE</div>
              <h2 className={styles.headline}>{issue}</h2>
            </div>

            <div className={styles.statusLine}>
              <span className={styles.pill}>{session.racers?.name ?? "Driver"}</span>
              <span className={styles.pill}>{session.tracks?.name ?? "Track"}</span>
              <span className={styles.pill}>{session.setup?.class_name ? String(session.setup.class_name) : session.session_type}</span>
            </div>

            <div className={styles.confidenceGrid}>
              <div className={styles.confidence}>
                <span>Data Quality Confidence</span>
                <strong className={confidenceClass(dataBand)}>{bandLabel(dataBand)} · {dataScore}%</strong>
              </div>
              <div className={styles.confidence}>
                <span>Interpretation Confidence</span>
                <strong className={confidenceClass(interpretationBand)}>{bandLabel(interpretationBand)} · {interpretationScore}%</strong>
              </div>
            </div>

            <div className={`${styles.safe} ${safeToPublish ? styles.safeYes : styles.safeNo}`}>
              Recommendation safe to publish: {safeToPublish ? "YES" : "NO"}
            </div>

            <div className={styles.lapTable}>
              <div className={styles.lapStat}><span>Best lap</span><strong>{session.best_lap_sec?.toFixed(3) ?? "—"}</strong></div>
              <div className={styles.lapStat}><span>Average</span><strong>{session.average_lap_sec?.toFixed(3) ?? "—"}</strong></div>
              <div className={styles.lapStat}><span>Clean laps</span><strong>{session.lap_count ?? "—"}</strong></div>
            </div>

            <div className={styles.section}>
              <h3>Rivali interpretation</h3>
              <p>{safeToPublish
                ? recommendation?.recommendation
                : "More data is needed before making a setup interpretation. Rivali will report what was observed without inventing a cause or setup change."}</p>
            </div>

            {debrief?.transcript && (
              <div className={styles.section}>
                <h3>Driver debrief</h3>
                <p className={styles.debrief}>“{debrief.transcript}”</p>
              </div>
            )}

            <div className={styles.section}>
              <h3>Available channels</h3>
              <div className={styles.channels}>
                {importantChannels.map(([label, needles]) => {
                  const present = hasChannel(manifest, needles);
                  return <span key={label} className={`${styles.chip} ${present ? "" : styles.missing}`}>{present ? "✓" : "✕"} {label}</span>;
                })}
              </div>
            </div>

            <div className={styles.section}>
              <h3>Factors affecting confidence</h3>
              <div className={styles.facts}>
                <div className={styles.fact}><span>Driver debrief</span><strong>{debrief?.transcript ? "Included" : "Missing"}</strong></div>
                <div className={styles.fact}><span>Missing channels</span><strong>{missingChannels.length ? missingChannels.join(", ") : "None critical"}</strong></div>
                <div className={styles.fact}><span>Timing source</span><strong>{sessionTelemetry?.corner_analysis?.lap_timing?.source ?? "Unknown"}</strong></div>
              </div>
            </div>

            <div className={styles.actions}>
              <button className="button" type="button" onClick={() => setMessage("Edit workflow is next. No report has been sent.")}><Pencil size={17}/> Edit</button>
              <button className="button" type="button" onClick={() => setMessage("Re-analysis requested in preview only. The current worker has not been re-queued.")}><RotateCcw size={17}/> Re-run</button>
              <button
                className={`button primary ${styles.primary}`}
                type="button"
                disabled={!safeToPublish}
                onClick={() => setMessage("Approval UI is working. Racer delivery is intentionally not faked until phone/email delivery fields and the send endpoint are connected.")}
              >
                {safeToPublish ? <><Send size={18}/> Approve & Send</> : <><CheckCircle2 size={18}/> More data required</>}
              </button>
            </div>
            <div className={styles.note}>The confidence score is an evidence score, not a statistical probability. Low-confidence reports suppress setup advice instead of filling the page with guesses.</div>
          </section>
        </div>
      </div>
    </div>
  );
}

function TrackReportMap({ session, telemetry }: { session: Session; telemetry?: Telemetry }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layersRef = useRef<Leaflet.Layer[]>([]);
  const trace = telemetry?.gps_trace ?? [];

  useEffect(() => {
    let active = true;
    (async () => {
      if (!container.current) return;
      const L = await import("leaflet");
      if (!active || !container.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(container.current, { zoomControl: true }).setView([35.72, -77.91], 8);
        L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          { maxZoom: 20, attribution: "Imagery © Esri and contributors" },
        ).addTo(mapRef.current);
      }
      const map = mapRef.current;
      layersRef.current.forEach((layer) => map.removeLayer(layer));
      layersRef.current = [];

      if (trace.length > 1) {
        const speeds = trace.map((point) => point.speed_mph).filter((value): value is number => Number.isFinite(value));
        const lowCut = speeds.length ? [...speeds].sort((a, b) => a - b)[Math.floor(speeds.length * 0.2)] : null;
        const highCut = speeds.length ? [...speeds].sort((a, b) => a - b)[Math.floor(speeds.length * 0.65)] : null;
        const base = L.polyline(trace.map((point) => [point.lat, point.lng]), { color: "#f2eadb", weight: 7, opacity: .55 }).addTo(map);
        layersRef.current.push(base);
        for (let index = 1; index < trace.length; index += 1) {
          const before = trace[index - 1];
          const point = trace[index];
          const speed = point.speed_mph;
          const color = speed == null || lowCut == null || highCut == null ? "#ffd43b" : speed <= lowCut ? "#e13b2d" : speed <= highCut ? "#ffd43b" : "#41b65a";
          const segment = L.polyline([[before.lat, before.lng], [point.lat, point.lng]], { color, weight: 4, opacity: .95 }).addTo(map);
          layersRef.current.push(segment);
        }
        map.fitBounds(base.getBounds(), { padding: [30, 30], maxZoom: 19 });
      } else {
        const turnPoints = Object.values(session.tracks?.turns ?? {}).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
        if (turnPoints.length) map.fitBounds(L.latLngBounds(turnPoints.map((point) => [point.lat, point.lng])), { padding: [50, 50], maxZoom: 19 });
      }

      Object.entries(session.tracks?.turns ?? {}).forEach(([number, point]) => {
        if (!/^[1-4]$/.test(number)) return;
        const marker = L.marker([point.lat, point.lng], {
          icon: L.divIcon({ className: "", html: `<div style="width:28px;height:28px;border-radius:50%;background:#111;color:#fff;border:2px solid #fff;display:grid;place-items:center;font-weight:900;box-shadow:0 2px 8px #000">${number}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        }).addTo(map);
        layersRef.current.push(marker);
      });

      const startFinish = session.tracks?.start_finish ?? [];
      if (startFinish.length === 2) {
        const line = L.polyline(startFinish.map((point) => [point.lat, point.lng]), { color: "#fff", weight: 5, dashArray: "7 5" }).addTo(map);
        layersRef.current.push(line);
      }

      window.setTimeout(() => map.invalidateSize(), 50);
    })();
    return () => { active = false; };
  }, [session.id, session.tracks, trace]);

  return (
    <section className={`${styles.card} ${styles.mapCard}`}>
      <div ref={container} className={styles.map} />
      <div className={styles.mapOverlay}>
        <div className={styles.legend}><strong>Red</strong><span>Largest speed loss</span></div>
        <div className={styles.legend}><strong>Yellow</strong><span>Moderate loss</span></div>
        <div className={styles.legend}><strong>Green</strong><span>Strongest area</span></div>
      </div>
    </section>
  );
}
