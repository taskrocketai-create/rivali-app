"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, FileText, Send, ShieldCheck } from "lucide-react";
import type { RaceSession } from "@/types/domain";

type TelemetryRow = {
  session_id: string;
  laps?: Array<Record<string, unknown>> | null;
  channel_manifest?: string[] | null;
  corner_analysis?: Record<string, unknown> | null;
};

type DebriefRow = {
  session_id: string;
  status: string;
  transcript: string | null;
  created_at: string;
};

function hasAny(manifest: string[], needles: string[]) {
  const joined = manifest.join(" ").toLowerCase();
  return needles.some((needle) => joined.includes(needle));
}

function confidenceLabel(score: number) {
  if (score >= 80) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

export function ReportServiceClient({
  sessions,
  telemetry,
  debriefs,
}: {
  sessions: RaceSession[];
  telemetry: TelemetryRow[];
  debriefs: DebriefRow[];
}) {
  const completed = sessions.filter((session) => session.status === "completed");
  const [selectedId, setSelectedId] = useState(completed[0]?.id ?? sessions[0]?.id ?? "");
  const [approved, setApproved] = useState<Record<string, boolean>>({});

  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  const selectedTelemetry = telemetry.find((row) => row.session_id === selected?.id);
  const selectedDebrief = debriefs.find((row) => row.session_id === selected?.id);

  const review = useMemo(() => {
    if (!selected) return null;
    const manifest = selectedTelemetry?.channel_manifest ?? [];
    const lapCount = selected.lap_count ?? selectedTelemetry?.laps?.length ?? 0;
    const hasGps = hasAny(manifest, ["gps latitude", "gps longitude", "gps speed"]);
    const hasRpm = hasAny(manifest, ["rpm"]);
    const hasLatG = hasAny(manifest, ["lateral", "lat acc", "g force"]);
    const hasBrake = hasAny(manifest, ["brake", "pressure"]);
    const hasSteering = hasAny(manifest, ["steering"]);
    const hasTireTemp = hasAny(manifest, ["tire temp", "tyre temp", "infrared"]);
    const hasDebrief = Boolean(selectedDebrief?.transcript?.trim());
    const setupIncluded = Boolean(
      selected.setup && Object.entries(selected.setup).some(([key, value]) =>
        !["telemetry_attached", "voice_intake"].includes(key) && value !== null && value !== "" && value !== false,
      ),
    );

    let dataScore = 20;
    if (lapCount >= 3) dataScore += 20;
    if (lapCount >= 6) dataScore += 10;
    if (hasGps) dataScore += 20;
    if (hasRpm) dataScore += 10;
    if (hasLatG) dataScore += 10;
    if (hasDebrief) dataScore += 10;
    dataScore = Math.min(100, dataScore);

    let interpretationScore = dataScore;
    if (!hasBrake) interpretationScore -= 10;
    if (!hasSteering) interpretationScore -= 10;
    if (!hasTireTemp) interpretationScore -= 5;
    if (!setupIncluded) interpretationScore -= 5;
    interpretationScore = Math.max(10, Math.min(100, interpretationScore));

    const missing = [
      !hasBrake ? "brake pressure" : null,
      !hasSteering ? "steering angle" : null,
      !hasTireTemp ? "tire temperature" : null,
    ].filter(Boolean) as string[];

    const lowConfidence = interpretationScore < 55;
    const recommendation = selected.recommendations?.[0]?.recommendation ?? null;
    const recommendationConfidence = selected.recommendations?.[0]?.confidence ?? null;

    return {
      lapCount,
      hasDebrief,
      setupIncluded,
      dataScore,
      interpretationScore,
      missing,
      lowConfidence,
      recommendation,
      recommendationConfidence,
    };
  }, [selected, selectedDebrief, selectedTelemetry]);

  if (!selected || !review) {
    return <div className="card"><h2>No reports ready yet</h2><p className="muted">Upload and process a MyChron session first.</p></div>;
  }

  const canPublishInterpretation = !review.lowConfidence;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card stack">
        <div className="eyebrow">TRACKSIDE REPORT SERVICE</div>
        <h1>Rivali Report Ready</h1>
        <p className="muted">Review the interpretation confidence before anything reaches the racer.</p>
        <div className="field">
          <label>Session</label>
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.session_date} · {session.racers?.name ?? "Driver"} · {session.tracks?.name ?? "Track"} · {session.session_type}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid-3">
        <div className="card">
          <div className="eyebrow">BEST LAP</div>
          <h2>{selected.best_lap_sec ? `${Number(selected.best_lap_sec).toFixed(3)}s` : "Not available"}</h2>
          <p className="muted">{review.lapCount} lap{review.lapCount === 1 ? "" : "s"} available</p>
        </div>
        <div className="card">
          <div className="eyebrow">DATA QUALITY</div>
          <h2>{review.dataScore}% · {confidenceLabel(review.dataScore)}</h2>
          <p className="muted">Measures completeness and reliability of the underlying run data.</p>
        </div>
        <div className="card">
          <div className="eyebrow">INTERPRETATION CONFIDENCE</div>
          <h2>{review.interpretationScore}% · {confidenceLabel(review.interpretationScore)}</h2>
          <p className="muted">Measures how strongly the available evidence supports a cause-oriented interpretation.</p>
        </div>
      </div>

      <div className="card stack">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {canPublishInterpretation ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />}
          <h2>{canPublishInterpretation ? "Interpretation may be published" : "Observation only"}</h2>
        </div>
        {canPublishInterpretation ? (
          <p>Rivali has enough supporting data to publish a weighted interpretation, provided you agree with the summary below.</p>
        ) : (
          <div className="notice">
            Rivali found usable observations, but the available channels do not support a reliable setup diagnosis. The client report should describe what happened and what additional data would be needed. It should not invent a likely fix.
          </div>
        )}
        <div className="grid-3">
          <div><strong>Driver debrief</strong><p className="muted">{review.hasDebrief ? "Included" : "Not recorded"}</p></div>
          <div><strong>Setup details</strong><p className="muted">{review.setupIncluded ? "Included" : "Not provided"}</p></div>
          <div><strong>Missing useful channels</strong><p className="muted">{review.missing.length ? review.missing.join(", ") : "None of the core channels"}</p></div>
        </div>
      </div>

      {selectedDebrief?.transcript && (
        <div className="card stack">
          <div className="eyebrow">DRIVER DEBRIEF</div>
          <p>{selectedDebrief.transcript}</p>
        </div>
      )}

      <div className="card stack">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><FileText size={22} /><h2>Interpretation summary</h2></div>
        {review.recommendation ? (
          <>
            <p>{review.recommendation}</p>
            <small className="muted">Recommendation engine confidence: {review.recommendationConfidence ?? "not rated"}</small>
          </>
        ) : (
          <p className="muted">No grounded recommendation has been generated for this session yet.</p>
        )}
      </div>

      <div className="card stack">
        <h2>Approval</h2>
        <p className="muted">Nothing is sent to the customer until you approve it.</p>
        {approved[selected.id] ? (
          <div className="notice"><CheckCircle2 size={18} /> Approved. Delivery integration is the next step.</div>
        ) : (
          <button
            className="button primary"
            type="button"
            onClick={() => setApproved((current) => ({ ...current, [selected.id]: true }))}
          >
            <Send size={18} /> Approve report
          </button>
        )}
      </div>
    </div>
  );
}
