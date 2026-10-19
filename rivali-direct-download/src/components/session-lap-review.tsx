"use client";
import { useMemo, useState } from "react";

type Lap = { lap_number?: number; lap_time_sec?: number; duration_sec?: number };
type Props = { laps: Lap[] | null; timingSource?: string; channelManifest?: string[] };

export default function SessionLapReview({ laps, timingSource, channelManifest = [] }: Props) {
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const [maxLapSeconds, setMaxLapSeconds] = useState(25);
  const clean = useMemo(() => (laps ?? []).map(lap => ({
    number: Number(lap.lap_number),
    time: Number(lap.lap_time_sec ?? lap.duration_sec),
  })).filter(lap => Number.isFinite(lap.number) && Number.isFinite(lap.time) && lap.time > 0), [laps]);
  const quick = clean.filter(lap => lap.time <= maxLapSeconds);
  const best = clean.length ? clean.reduce((a, b) => a.time < b.time ? a : b) : null;
  const active = clean.find(lap => lap.number === selectedLap) ?? best;
  const low = quick.length ? Math.floor(Math.min(...quick.map(l => l.time)) * 10) / 10 : 0;
  const high = quick.length ? Math.ceil(Math.max(...quick.map(l => l.time)) * 10) / 10 : 1;
  const span = Math.max(0.1, high - low);
  const w = 760, h = 225, pad = 32;
  const coords = quick.map((lap, i) => ({
    ...lap, x: pad + i * (w - 2 * pad) / Math.max(1, quick.length - 1),
    y: h - pad - (lap.time - low) * (h - 2 * pad) / span,
  }));
  const rpm = channelManifest.some(c => c.toLowerCase() === "rpm");
  return <section style={{ padding: 16, border: "1px solid #4b5563", borderRadius: 12, marginTop: 16 }}>
    <h3 style={{ marginTop: 0 }}>Lap-time review</h3>
    <p>Best recorded lap: <strong>{best ? `#${best.number} · ${best.time.toFixed(3)}s` : "unavailable"}</strong>.
      {active && <> Selected lap #{active.number}: <strong>{active.time.toFixed(3)}s</strong>
        {best && <> ({(active.time - best.time).toFixed(3)}s behind best)</>}</>}</p>
    <label>Show laps under {maxLapSeconds}s{" "}
      <input type="range" min={13} max={180} step={1} value={maxLapSeconds}
        onChange={e => setMaxLapSeconds(Number(e.target.value))} />
    </label>
    {coords.length > 1 ? <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", maxHeight: 260 }}
      role="img" aria-label="Lap time chart, select a point for lap details">
      <rect width={w} height={h} fill="#171b22" rx="8" />
      <path d={coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}
        stroke="#ff6844" strokeWidth="2.5" fill="none" />
      {coords.map(p => <circle key={p.number} cx={p.x} cy={p.y} r={p.number === active?.number ? 7 : 4}
        fill={p.number === active?.number ? "#ffffff" : "#ff6844"} stroke="#171b22" strokeWidth="1"
        style={{ cursor: "pointer" }} role="button" tabIndex={0}
        aria-label={`Lap ${p.number}, ${p.time.toFixed(3)} seconds`}
        onClick={() => setSelectedLap(p.number)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setSelectedLap(p.number); }} />)}
      <text x={pad} y={17} fill="#ddd" fontSize={12}>{high.toFixed(2)}s</text>
      <text x={pad} y={h - 8} fill="#ddd" fontSize={12}>{low.toFixed(2)}s</text>
    </svg> : <p>Not enough laps in this time range to plot.</p>}
    <p style={{ fontSize: 13, opacity: 0.85 }}>
      {timingSource?.includes("fallback") ? "Provisional lap numbering: compare with RS3 before sharing." : "Lap numbering follows the imported session."}
      {" "}RPM: {rpm ? "recorded" : "not recovered from this import"}. This chart describes lap times, not the cause of a change.
    </p>
  </section>;
}
