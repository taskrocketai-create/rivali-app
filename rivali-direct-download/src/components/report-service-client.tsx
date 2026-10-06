"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { CheckCircle2, RotateCcw, Pencil, Send } from "lucide-react";
import styles from "./report-service.module.css";

type TracePoint = { lat: number; lng: number; time?: number; speed_mph?: number; lateral_g?: number };
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
  report_status?: string;
  race_day_pass_id?: string | null;
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
  corner_analysis: { diagnostic?: string; turns?: Record<string, unknown>; alignment?: { confidence?: string; score?: number; track_coverage_pct?: number; median_groove_distance_m?: number | null; reason?: string }; groove?: { median_deviation_m?: number | null; samples_within_reference_band_pct?: number }; lap_timing?: { source?: string; diagnostic?: string } } | null;
};
type Debrief = { session_id: string; transcript: string | null; created_at: string };
type ConfidenceBand = "high" | "medium" | "low";
type MapMode = "speed" | "lateral_g" | "time_loss" | "line";

const importantChannels = [
  ["GPS", ["gps latitude", "gps longitude"]],
  ["Speed", ["gps speed", "speed"]],
  ["RPM", ["rpm"]],
  ["Lateral G", ["lateral g", "latacc", "lat accel", "gps lateral"]],
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

export function ReportServiceClient({ sessions, telemetry, debriefs }: { sessions: Session[]; telemetry: Telemetry[]; debriefs: Debrief[] }) {
  const completed = useMemo(() => sessions.filter((session) => session.status === "completed"), [sessions]);
  const [sessionId, setSessionId] = useState(completed[0]?.id ?? sessions[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [approving, setApproving] = useState(false);
  const session = sessions.find((item) => item.id === sessionId) ?? completed[0] ?? sessions[0];
  const sessionTelemetry = telemetry.find((item) => item.session_id === session?.id);
  const debrief = debriefs.find((item) => item.session_id === session?.id);
  const recommendation = session?.recommendations?.[0];
  const manifest = sessionTelemetry?.channel_manifest ?? [];
  const alignmentScore = Number(sessionTelemetry?.corner_analysis?.alignment?.score ?? 0);

  const dataScore = useMemo(() => {
    if (!session) return 0;
    let score = 0;
    if (session.status === "completed") score += 25;
    if ((session.lap_count ?? 0) >= 5) score += 20;
    if ((session.lap_count ?? 0) >= 8) score += 5;
    if (hasChannel(manifest, ["gps latitude", "latitude"]) && hasChannel(manifest, ["gps longitude", "longitude"])) score += 10;
    if (Number.isFinite(alignmentScore)) score += Math.round(Math.max(0, Math.min(100, alignmentScore)) * 0.15);
    if (hasChannel(manifest, ["speed"])) score += 10;
    if (hasChannel(manifest, ["rpm"])) score += 10;
    if (hasChannel(manifest, ["lateral g", "latacc", "lat accel", "gps lateral"])) score += 10;
    return Math.min(100, score);
  }, [alignmentScore, manifest, session]);

  const interpretationScore = useMemo(() => {
    if (!session) return 0;
    let score = Math.round(dataScore * 0.62);
    if (debrief?.transcript) score += 12;
    if (recommendation?.confidence === "high") score += 18;
    else if (recommendation?.confidence === "medium") score += 10;
    else if (recommendation?.confidence === "low") score += 2;
    if (!hasChannel(manifest, ["steering"])) score -= 5;
    const drivingStyle = String(session.setup?.driving_style ?? "");
    if (!hasChannel(manifest, ["brake"])) score -= drivingStyle === "full_throttle_brake_drag" ? 10 : 4;
    return Math.max(0, Math.min(100, score));
  }, [dataScore, debrief?.transcript, manifest, recommendation?.confidence, session]);

  const dataBand = scoreBand(dataScore);
  const interpretationBand = scoreBand(interpretationScore);
  const safeToPublish = dataScore >= 50 && interpretationScore >= 50 && alignmentScore >= 55 && Boolean(recommendation?.recommendation);
  const debriefReady = !session?.race_day_pass_id || Boolean(debrief?.transcript);
  const canApprove = safeToPublish && debriefReady && session?.report_status === "pending_approval";
  const missingChannels = importantChannels.filter(([, needles]) => !hasChannel(manifest, needles)).map(([label]) => label);
  const issue = session ? summarizeIssue(session, sessionTelemetry) : "No session selected";

  async function approveReport() {
    if (!session) return;
    setApproving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/reports/${session.id}/approve`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not approve this report.");
      session.report_status = result.report?.report_status ?? "approved";
      setMessage(result.delivery?.sent
        ? `Report approved and texted to ${result.driverName ?? "the driver"}.`
        : `Report approved for delivery. ${result.delivery?.reason ?? "The driver can view it in Race Day now."}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not approve this report.");
    } finally {
      setApproving(false);
    }
  }

  if (!session) return <div className={`${styles.card} ${styles.empty}`}>Upload and process a MyChron session to build the first Rivali report.</div>;

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
            {sessions.map((item) => <option key={item.id} value={item.id}>{item.session_date} · {item.racers?.name ?? "Driver"} · {item.tracks?.name ?? "Track"}</option>)}
          </select>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}

      <div className={styles.grid}>
        <TrackReportMap session={session} telemetry={sessionTelemetry} sessions={sessions} allTelemetry={telemetry} />

        <div className={styles.stack}>
          <section className={`${styles.card} ${styles.summary}`}>
            <div><div className={styles.eyebrow}>BIGGEST ISSUE</div><h2 className={styles.headline}>{issue}</h2></div>
            <div className={styles.statusLine}>
              <span className={styles.pill}>{session.racers?.name ?? "Driver"}</span>
              <span className={styles.pill}>{session.tracks?.name ?? "Track"}</span>
              <span className={styles.pill}>{session.setup?.class_name ? String(session.setup.class_name) : session.session_type}</span>
            </div>
            <div className={styles.confidenceGrid}>
              <div className={styles.confidence}><span>Data Quality Confidence</span><strong className={confidenceClass(dataBand)}>{bandLabel(dataBand)} · {dataScore}%</strong></div>
              <div className={styles.confidence}><span>Interpretation Confidence</span><strong className={confidenceClass(interpretationBand)}>{bandLabel(interpretationBand)} · {interpretationScore}%</strong></div>
            </div>
            <div className={`${styles.safe} ${safeToPublish ? styles.safeYes : styles.safeNo}`}>Recommendation safe to publish: {safeToPublish ? "YES" : "NO"}</div>
            <div className={styles.lapTable}>
              <div className={styles.lapStat}><span>Best lap</span><strong>{session.best_lap_sec?.toFixed(3) ?? "—"}</strong></div>
              <div className={styles.lapStat}><span>Average</span><strong>{session.average_lap_sec?.toFixed(3) ?? "—"}</strong></div>
              <div className={styles.lapStat}><span>Clean laps</span><strong>{session.lap_count ?? "—"}</strong></div>
            </div>
            <div className={styles.section}><h3>Rivali interpretation</h3><p>{safeToPublish ? recommendation?.recommendation : "More data is needed before making a setup interpretation. Rivali will report what was observed without inventing a cause or setup change."}</p></div>
            {debrief?.transcript && <div className={styles.section}><h3>Driver debrief</h3><p className={styles.debrief}>“{debrief.transcript}”</p></div>}
            <div className={styles.section}>
              <h3>Available channels</h3>
              <div className={styles.channels}>{importantChannels.map(([label, needles]) => { const present = hasChannel(manifest, needles); return <span key={label} className={`${styles.chip} ${present ? "" : styles.missing}`}>{present ? "✓" : "✕"} {label}</span>; })}</div>
            </div>
            <div className={styles.section}>
              <h3>Factors affecting confidence</h3>
              <div className={styles.facts}>
                <div className={styles.fact}><span>Driver debrief</span><strong>{debrief?.transcript ? "Included" : "Missing"}</strong></div>
                <div className={styles.fact}><span>Corner driving style</span><strong>{String(session.setup?.driving_style ?? "Not recorded").replaceAll("_", " ")}</strong></div>
                <div className={styles.fact}><span>GPS / track alignment</span><strong>{sessionTelemetry?.corner_analysis?.alignment?.confidence ?? "Unknown"} · {alignmentScore || 0}%</strong></div>
                <div className={styles.fact}><span>Median groove deviation</span><strong>{sessionTelemetry?.corner_analysis?.alignment?.median_groove_distance_m == null ? "Unknown" : `${sessionTelemetry.corner_analysis.alignment.median_groove_distance_m.toFixed(1)} m`}</strong></div>
                <div className={styles.fact}><span>Missing channels</span><strong>{missingChannels.length ? missingChannels.join(", ") : "None critical"}</strong></div>
                <div className={styles.fact}><span>Timing source</span><strong>{sessionTelemetry?.corner_analysis?.lap_timing?.source ?? "Unknown"}</strong></div>
              </div>
            </div>
            <div className={styles.actions}>
              <button className="button" type="button" onClick={() => setMessage("Edit workflow is next. No report has been sent.")}><Pencil size={17}/> Edit</button>
              <button className="button" type="button" onClick={() => setMessage("Re-analysis requested in preview only. The current worker has not been re-queued.")}><RotateCcw size={17}/> Re-run</button>
              <button className={`button primary ${styles.primary}`} type="button" disabled={!canApprove || approving} onClick={() => void approveReport()}>
                {session.report_status === "sent"
                  ? <><CheckCircle2 size={18}/> Sent to driver</>
                  : session.report_status === "approved"
                    ? <><CheckCircle2 size={18}/> Approved for delivery</>
                    : canApprove
                    ? <><Send size={18}/> {approving ? "Approving..." : "Approve for delivery"}</>
                    : <><CheckCircle2 size={18}/> {!debriefReady ? "Driver debrief required" : safeToPublish ? "Not in approval queue" : "More data required"}</>}
              </button>
            </div>
            <div className={styles.note}>The confidence score is an evidence score, not a statistical probability. Low-confidence reports suppress setup advice instead of filling the page with guesses.</div>
          </section>
        </div>
      </div>
    </div>
  );
}

function distanceMeters(a: TracePoint, b: TracePoint) {
  const latM = (a.lat - b.lat) * 111320;
  const lngM = (a.lng - b.lng) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(latM, lngM);
}

function estimatedLateralG(trace: TracePoint[], index: number) {
  const direct = trace[index]?.lateral_g;
  if (Number.isFinite(direct)) return Math.abs(direct as number);
  if (index < 1 || index >= trace.length - 1) return null;
  const a = trace[index - 1], b = trace[index], c = trace[index + 1];
  const ab = distanceMeters(a, b), bc = distanceMeters(b, c), ac = distanceMeters(a, c);
  if (ab < .2 || bc < .2 || ac < .2) return null;
  const x1 = (a.lng - b.lng) * 111320 * Math.cos(b.lat * Math.PI / 180);
  const y1 = (a.lat - b.lat) * 111320;
  const x2 = (c.lng - b.lng) * 111320 * Math.cos(b.lat * Math.PI / 180);
  const y2 = (c.lat - b.lat) * 111320;
  const twiceArea = Math.abs(x1 * y2 - y1 * x2);
  if (twiceArea < .03) return 0;
  const radius = (ab * bc * ac) / (2 * twiceArea);
  if (!Number.isFinite(radius) || radius < 2) return null;
  const speedMps = (b.speed_mph ?? 0) * 0.44704;
  const g = (speedMps * speedMps) / (radius * 9.80665);
  return Number.isFinite(g) && g <= 4 ? g : null;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

function nearestReferenceSpeed(point: TracePoint, reference: TracePoint[]) {
  if (!reference.length) return null;
  const stride = Math.max(1, Math.floor(reference.length / 500));
  let bestDistance = Infinity;
  let bestSpeed: number | null = null;
  for (let index = 0; index < reference.length; index += stride) {
    const candidate = reference[index];
    if (!Number.isFinite(candidate.speed_mph)) continue;
    const distance = distanceMeters(point, candidate);
    if (distance < bestDistance) { bestDistance = distance; bestSpeed = candidate.speed_mph as number; }
  }
  return bestDistance <= 15 ? bestSpeed : null;
}

function TrackReportMap({ session, telemetry, sessions, allTelemetry }: { session: Session; telemetry?: Telemetry; sessions: Session[]; allTelemetry: Telemetry[] }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const layersRef = useRef<Leaflet.Layer[]>([]);
  const [mode, setMode] = useState<MapMode>("speed");
  const comparisonSessions = useMemo(() => sessions.filter((item) => item.id !== session.id && item.status === "completed" && item.tracks?.id && item.tracks.id === session.tracks?.id && allTelemetry.some((row) => row.session_id === item.id && (row.gps_trace?.length ?? 0) > 1)), [allTelemetry, session.id, session.tracks?.id, sessions]);
  const [referenceId, setReferenceId] = useState("");
  useEffect(() => { setReferenceId(comparisonSessions[0]?.id ?? ""); setMode("speed"); }, [session.id]);

  const trace = telemetry?.gps_trace ?? [];
  const referenceSession = comparisonSessions.find((item) => item.id === referenceId);
  const referenceTrace = allTelemetry.find((item) => item.session_id === referenceId)?.gps_trace ?? [];
  const lateralValues = useMemo(() => trace.map((_, index) => estimatedLateralG(trace, index)), [trace]);
  const lateralPeak = Math.max(0, ...lateralValues.filter((value): value is number => value != null));

  useEffect(() => {
    let active = true;
    (async () => {
      if (!container.current) return;
      const L = await import("leaflet");
      if (!active || !container.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(container.current, { zoomControl: true }).setView([35.72, -77.91], 8);
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, attribution: "Imagery © Esri and contributors" }).addTo(mapRef.current);
      }
      const map = mapRef.current;
      layersRef.current.forEach((layer) => map.removeLayer(layer));
      layersRef.current = [];

      if (trace.length > 1) {
        const base = L.polyline(trace.map((point) => [point.lat, point.lng]), { color: "#f2eadb", weight: 7, opacity: .5 }).addTo(map);
        layersRef.current.push(base);
        if (mode === "line") {
          const current = L.polyline(trace.map((point) => [point.lat, point.lng]), { color: "#e13b2d", weight: 4, opacity: .95 }).addTo(map).bindTooltip("Current run");
          layersRef.current.push(current);
          if (referenceTrace.length > 1) {
            const reference = L.polyline(referenceTrace.map((point) => [point.lat, point.lng]), { color: "#60a5fa", weight: 4, opacity: .9, dashArray: "7 5" }).addTo(map).bindTooltip("Reference run");
            layersRef.current.push(reference);
          }
        } else {
          const speeds = trace.map((point) => point.speed_mph).filter((value): value is number => Number.isFinite(value));
          const lowCut = percentile(speeds, .2), highCut = percentile(speeds, .65);
          const validGs = lateralValues.filter((value): value is number => value != null);
          const gLow = percentile(validGs, .35), gHigh = percentile(validGs, .72);
          const losses = mode === "time_loss" && referenceTrace.length ? trace.map((point, index) => {
            if (!index || !Number.isFinite(point.speed_mph)) return 0;
            const refSpeed = nearestReferenceSpeed(point, referenceTrace);
            if (!refSpeed || refSpeed <= 0 || (point.speed_mph ?? 0) <= 0) return 0;
            const segmentM = distanceMeters(trace[index - 1], point);
            return Math.max(0, segmentM * (1 / ((point.speed_mph as number) * .44704) - 1 / (refSpeed * .44704)));
          }) : [];
          const lossMid = percentile(losses.filter((value) => value > 0), .5), lossHigh = percentile(losses.filter((value) => value > 0), .82);

          for (let index = 1; index < trace.length; index += 1) {
            const before = trace[index - 1], point = trace[index];
            let color = "#ffd43b";
            let label = "";
            if (mode === "speed") {
              const speed = point.speed_mph;
              color = speed == null || lowCut == null || highCut == null ? "#ffd43b" : speed <= lowCut ? "#e13b2d" : speed <= highCut ? "#ffd43b" : "#41b65a";
              label = speed == null ? "Speed unavailable" : `${speed.toFixed(1)} mph`;
            } else if (mode === "lateral_g") {
              const g = lateralValues[index];
              color = g == null || gLow == null || gHigh == null ? "#777" : g >= gHigh ? "#e13b2d" : g >= gLow ? "#ffd43b" : "#41b65a";
              label = g == null ? "Lateral G unavailable" : `${g.toFixed(2)} g`;
            } else {
              const loss = losses[index] ?? 0;
              color = lossHigh != null && loss >= lossHigh ? "#e13b2d" : lossMid != null && loss >= lossMid ? "#ffd43b" : "#41b65a";
              label = referenceTrace.length ? `Estimated local loss ${loss.toFixed(3)} s` : "Choose a reference run";
            }
            const segment = L.polyline([[before.lat, before.lng], [point.lat, point.lng]], { color, weight: 5, opacity: .95 }).addTo(map).bindTooltip(label);
            layersRef.current.push(segment);
          }
        }
        map.fitBounds(base.getBounds(), { padding: [30, 30], maxZoom: 19 });
      } else {
        const turnPoints = Object.entries(session.tracks?.turns ?? {}).filter(([key]) => /^[1-4]$/.test(key)).map(([, point]) => point).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
        if (turnPoints.length) map.fitBounds(L.latLngBounds(turnPoints.map((point) => [point.lat, point.lng])), { padding: [50, 50], maxZoom: 19 });
      }

      Object.entries(session.tracks?.turns ?? {}).forEach(([number, point]) => {
        if (!/^[1-4]$/.test(number)) return;
        const marker = L.marker([point.lat, point.lng], { icon: L.divIcon({ className: "", html: `<div style="width:28px;height:28px;border-radius:50%;background:#111;color:#fff;border:2px solid #fff;display:grid;place-items:center;font-weight:900;box-shadow:0 2px 8px #000">${number}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(map);
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
  }, [lateralValues, mode, referenceTrace, session.id, session.tracks, trace]);

  const needsReference = mode === "time_loss" || mode === "line";
  return (
    <section className={`${styles.card} ${styles.mapCard}`}>
      <div className={styles.mapControls}>
        <div className={styles.modeButtons}>
          <button type="button" className={mode === "speed" ? styles.activeMode : ""} onClick={() => setMode("speed")}>Speed</button>
          <button type="button" className={mode === "lateral_g" ? styles.activeMode : ""} onClick={() => setMode("lateral_g")}>Lateral G</button>
          <button type="button" className={mode === "time_loss" ? styles.activeMode : ""} disabled={!referenceId} onClick={() => setMode("time_loss")}>Time Loss</button>
          <button type="button" className={mode === "line" ? styles.activeMode : ""} disabled={!referenceId} onClick={() => setMode("line")}>Line Comparison</button>
        </div>
        <select aria-label="Reference run" value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>
          <option value="">No reference run</option>
          {comparisonSessions.map((item) => <option key={item.id} value={item.id}>{item.session_date} · {item.racers?.name ?? "Driver"} · {item.best_lap_sec?.toFixed(3) ?? "—"}</option>)}
        </select>
      </div>
      <div ref={container} className={styles.map} />
      <div className={styles.mapOverlay}>
        {mode === "speed" && <><div className={styles.legend}><strong>Red</strong><span>Lowest speed</span></div><div className={styles.legend}><strong>Yellow</strong><span>Middle range</span></div><div className={styles.legend}><strong>Green</strong><span>Highest speed</span></div></>}
        {mode === "lateral_g" && <><div className={styles.legend}><strong>Peak</strong><span>{lateralPeak ? `${lateralPeak.toFixed(2)} g` : "No value"}</span></div><div className={styles.legend}><strong>Map meaning</strong><span>Red = highest load</span></div><div className={styles.legend}><strong>Source</strong><span>{trace.some((point) => Number.isFinite(point.lateral_g)) ? "Recorded G" : "GPS-derived estimate"}</span></div></>}
        {mode === "time_loss" && <><div className={styles.legend}><strong>Red</strong><span>Largest local loss</span></div><div className={styles.legend}><strong>Reference</strong><span>{referenceSession?.racers?.name ?? "Select run"}</span></div><div className={styles.legend}><strong>Method</strong><span>Spatial speed delta</span></div></>}
        {mode === "line" && <><div className={styles.legend}><strong>Red line</strong><span>Current run</span></div><div className={styles.legend}><strong>Blue line</strong><span>Reference run</span></div><div className={styles.legend}><strong>Reference</strong><span>{referenceSession?.racers?.name ?? "Select run"}</span></div></>}
      </div>
      {needsReference && !referenceId && <div className={styles.mapWarning}>Choose a completed run from the same track to unlock this comparison.</div>}
      {mode === "lateral_g" && !trace.some((point) => Number.isFinite(point.lateral_g)) && <div className={styles.mapWarning}>Lateral G is estimated from GPS speed and path curvature. Rivali labels it as an estimate rather than pretending it is a direct sensor measurement.</div>}
    </section>
  );
}
