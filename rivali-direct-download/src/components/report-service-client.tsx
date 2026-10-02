"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, FileText, Send, ShieldCheck } from "lucide-react";
import type { RaceSession } from "@/types/domain";

type ReportAnalysis = {
  engine_version?: string;
  data_quality?: { score?: number; label?: string };
  interpretation_confidence?: { score?: number; label?: string };
  publish_mode?: "observation_only" | "weighted_interpretation" | string;
  recommendation_safe_to_publish?: boolean;
  measured_facts?: string[];
  primary_observation?: {
    segment?: string;
    entry_speed_spread_mph?: number;
    exit_speed_spread_mph?: number;
  } | null;
  interpretation?: string;
  likely_contributors?: Array<{ category: string; weight_pct: number }>;
  common_areas_to_check?: string[];
  missing_evidence?: string[];
  driver_debrief_present?: boolean;
  setup_included?: boolean;
  guardrail?: string;
};

type TelemetryRow = {
  session_id: string;
  laps?: Array<Record<string, unknown>> | null;
  channel_manifest?: string[] | null;
  corner_analysis?: Record<string, unknown> | null;
  report_analysis?: ReportAnalysis | null;
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

    const engine = selectedTelemetry?.report_analysis;
    if (engine?.data_quality?.score != null && engine?.interpretation_confidence?.score != null) {
      return {
        lapCount: selected.lap_count ?? selectedTelemetry?.laps?.length ?? 0,
        hasDebrief: engine.driver_debrief_present ?? Boolean(selectedDebrief?.transcript?.trim()),
        setupIncluded: engine.setup_included ?? false,
        dataScore: Number(engine.data_quality.score),
        interpretationScore: Number(engine.interpretation_confidence.score),
        missing: engine.missing_evidence ?? [],
        lowConfidence: engine.publish_mode === "observation_only" || engine.recommendation_safe_to_publish === false,
        recommendation: selected.recommendations?.[0]?.recommendation ?? null,
        recommendationConfidence: selected.recommendations?.[0]?.confidence ?? null,
        measuredFacts: engine.measured_facts ?? [],
        interpretation: engine.interpretation ?? null,
        likelyContributors: engine.likely_contributors ?? [],
        commonAreas: engine.common_areas_to_check ?? [],
        engineVersion: engine.engine_version ?? "trackside-v1",
      };
    }

    // Fallback for older sessions processed before the report engine existed.
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

    return {
      lapCount,
      hasDebrief,
      setupIncluded,
      dataScore,
      interpretationScore,
      missing,
      lowConfidence: interpretationScore < 55,
      recommendation: selected.recommendations?.[0]?.recommendation ?? null,
      recommendationConfidence: selected.recommendations?.[0]?.confidence ?? null,
      measuredFacts: [] as string[],
      interpretation: null as string | null,
      likelyContributors: [] as Array<{ category: string; weight_pct: number }>,
      commonAreas: [] as string[],
      engineVersion: "legacy",
    };
  }, [selected, selectedDebrief, selectedTelemetry]);

  if (!selected || !review) {
    return <div className="card"><h2>No reports ready yet</h2><p className="muted">Upload and process a MyChron session first.</p></div>;
  }

  const canPublishInterpretation = !review.lowConfidence;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card stack">
        <div className="eyebrow">$40 TRACKSIDE REPORT</div>
        <h1>Rivali Report Ready</h1>
        <p className="muted">Engine: {review.engineVersion}. Review the facts and confidence before anything reaches the racer.</p>
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
          <p className="muted">Completeness and reliability of the recorded run.</p>
        </div>
        <div className="card">
          <div className="eyebrow">INTERPRETATION CONFIDENCE</div>
          <h2>{review.interpretationScore}% · {confidenceLabel(review.interpretationScore)}</h2>
          <p className="muted">How strongly the evidence supports going beyond observation.</p>
        </div>
      </div>

      <div className="card stack">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {canPublishInterpretation ? <ShieldCheck size={22} /> : <AlertTriangle size={22} />}
          <h2>{canPublishInterpretation ? "Weighted interpretation allowed" : "Observation only"}</h2>
        </div>
        {canPublishInterpretation ? (
          <p>Rivali has enough supporting evidence to rank likely contributors. The percentages are evidence weights, not proof of cause.</p>
        ) : (
          <div className="notice">
            The data is not clear enough for a reliable cause-oriented diagnosis. The report should state only what Rivali measured and what additional evidence would help. No made-up fix.
          </div>
        )}
        <div className="grid-3">
          <div><strong>Driver debrief</strong><p className="muted">{review.hasDebrief ? "Included" : "Not recorded"}</p></div>
          <div><strong>Setup details</strong><p className="muted">{review.setupIncluded ? "Included" : "Not provided"}</p></div>
          <div><strong>Missing evidence</strong><p className="muted">{review.missing.length ? review.missing.join(", ") : "No major gaps flagged"}</p></div>
        </div>
      </div>

      {review.measuredFacts.length > 0 && (
        <div className="card stack">
          <div className="eyebrow">MEASURED / OBSERVED</div>
          {review.measuredFacts.map((fact) => <p key={fact}>{fact}</p>)}
        </div>
      )}

      {selectedDebrief?.transcript && (
        <div className="card stack">
          <div className="eyebrow">DRIVER DEBRIEF</div>
          <p>{selectedDebrief.transcript}</p>
        </div>
      )}

      {review.interpretation && (
        <div className="card stack">
          <div className="eyebrow">INTERPRETATION</div>
          <p>{review.interpretation}</p>
        </div>
      )}

      {canPublishInterpretation && review.likelyContributors.length > 0 && (
        <div className="card stack">
          <div className="eyebrow">LIKELY CONTRIBUTORS</div>
          {review.likelyContributors.map((item) => (
            <div key={item.category} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{item.category}</strong><span>{item.weight_pct}%</span>
            </div>
          ))}
          <small className="muted">Relative evidence weights only. They are not statistically proven causal probabilities.</small>
        </div>
      )}

      {canPublishInterpretation && review.commonAreas.length > 0 && (
        <div className="card stack">
          <div className="eyebrow">COMMON AREAS RACERS CHECK</div>
          <p>{review.commonAreas.join(" · ")}</p>
        </div>
      )}

      <div className="card stack">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><FileText size={22} /><h2>Archived comparison</h2></div>
        {review.recommendation ? (
          <>
            <p>{review.recommendation}</p>
            <small className="muted">Historical comparison confidence: {review.recommendationConfidence ?? "not rated"}</small>
          </>
        ) : (
          <p className="muted">No previous condition-matched comparison is available yet.</p>
        )}
      </div>

      <div className="card stack">
        <h2>Approval</h2>
        <p className="muted">Nothing goes to the customer until you approve it.</p>
        {approved[selected.id] ? (
          <div className="notice"><CheckCircle2 size={18} /> Approved. Payment/unlock and delivery come after the engine is validated.</div>
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
