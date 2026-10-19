"use client";

import { useMemo, useState } from "react";

/** Measured samples only. All selected laps must use a shared distance origin. */
export type LapTrace = {
  id: string;
  label: string;
  samples: Array<{
    distanceM: number;
    latitude: number;
    longitude: number;
    speedMph?: number | null;
    rpm?: number | null;
    elapsedS?: number | null;
  }>;
};

type Props = { laps: LapTrace[]; width?: number; height?: number };

function valid(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function nearest(samples: LapTrace["samples"], distanceM: number) {
  return samples.reduce<typeof samples[number] | null>(
    (best, current) =>
      !best || Math.abs(current.distanceM - distanceM) < Math.abs(best.distanceM - distanceM)
        ? current : best, null);
}

/** Track scrubber: pointer, keyboard and slider drive the same distance state. */
export default function InteractiveTrackOverlay({ laps, width = 720, height = 460 }: Props) {
  const [distanceM, setDistanceM] = useState(0);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const usable = useMemo(() => laps.map(lap => ({
    ...lap,
    samples: lap.samples.filter(s =>
      valid(s.distanceM) && valid(s.latitude) && valid(s.longitude) &&
      Math.abs(s.latitude) <= 90 && Math.abs(s.longitude) <= 180),
  })).filter(lap => lap.samples.length > 1), [laps]);
  const selected = usable.filter(lap => activeIds.length === 0 || activeIds.includes(lap.id));
  const all = selected.flatMap(lap => lap.samples);
  const minLat = Math.min(...all.map(s => s.latitude));
  const maxLat = Math.max(...all.map(s => s.latitude));
  const minLon = Math.min(...all.map(s => s.longitude));
  const maxLon = Math.max(...all.map(s => s.longitude));
  const meanLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos(meanLat * Math.PI / 180);
  const lonSpan = (maxLon - minLon) * cosLat || 1e-8;
  const latSpan = maxLat - minLat || 1e-8;
  const scale = Math.min((width - 48) / lonSpan, (height - 48) / latSpan);
  const project = (s: { latitude: number; longitude: number }) => ({
    x: 24 + ((s.longitude - minLon) * cosLat * scale) +
      ((width - 48) - lonSpan * scale) / 2,
    y: height - 24 - ((s.latitude - minLat) * scale) -
      ((height - 48) - latSpan * scale) / 2,
  });
  const maxDistance = Math.max(0, ...selected.map(lap => Math.max(...lap.samples.map(s => s.distanceM))));
  const safeDistance = Math.min(distanceM, maxDistance);
  const colors = ["#ff6247", "#38bdf8", "#b4ef6d", "#eab5ff", "#ffd166", "#eeeeee"];
  function scrub(clientX: number, clientY: number, element: SVGSVGElement) {
    const rect = element.getBoundingClientRect();
    const x = (clientX - rect.left) * width / rect.width;
    const y = (clientY - rect.top) * height / rect.height;
    const closest = all.reduce<{ d: number; distanceM: number } | null>((best, s) => {
      const p = project(s);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      return !best || d < best.d ? { d, distanceM: s.distanceM } : best;
    }, null);
    if (closest) setDistanceM(closest.distanceM);
  }
  if (!usable.length) return <p role="status">No validated GPS traces available for interactive track analysis.</p>;
  return <section aria-label="Interactive lap track overlay" style={{ display: "grid", gap: 12 }}>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {usable.map((lap, i) => <label key={lap.id} style={{ color: colors[i % colors.length] }}>
        <input type="checkbox" checked={activeIds.length === 0 || activeIds.includes(lap.id)}
          onChange={() => setActiveIds(previous => {
            const current = previous.length ? previous : usable.map(l => l.id);
            const next = current.includes(lap.id) ? current.filter(id => id !== lap.id) : [...current, lap.id];
            return next.length === usable.length ? [] : next;
          })} /> {lap.label}
      </label>)}
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="GPS racing lines. Drag to scrub distance."
      style={{ width: "100%", background: "#15191e", borderRadius: 12, touchAction: "none", cursor: "crosshair" }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e.clientX, e.clientY, e.currentTarget); }}
      onPointerMove={e => { if (e.buttons) scrub(e.clientX, e.clientY, e.currentTarget); }}>
      {selected.map((lap, i) => <polyline key={lap.id} fill="none"
        stroke={colors[usable.findIndex(l => l.id === lap.id) % colors.length]}
        strokeWidth={2} points={lap.samples.map(s => { const p = project(s); return `${p.x},${p.y}`; }).join(" ")} />)}
      {selected.map(lap => {
        const sample = nearest(lap.samples, safeDistance);
        if (!sample) return null;
        const p = project(sample);
        return <circle key={lap.id} cx={p.x} cy={p.y} r={6} fill="#fff" stroke="#111" strokeWidth={2} />;
      })}
    </svg>
    <label>Track position: {safeDistance.toFixed(1)} m
      <input aria-label="Track distance" type="range" min={0} max={maxDistance} step={0.1}
        value={safeDistance} onChange={e => setDistanceM(Number(e.target.value))}
        style={{ width: "100%" }} />
    </label>
    <div aria-live="polite" style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
      {selected.map(lap => {
        const s = nearest(lap.samples, safeDistance);
        return <div key={lap.id}><strong>{lap.label}</strong>: {s && valid(s.speedMph) ? `${s.speedMph.toFixed(1)} mph` : "speed unavailable"}
          {" · "}{s && valid(s.rpm) ? `${Math.round(s.rpm)} RPM` : "RPM unavailable"}
          {" · "}{s && valid(s.elapsedS) ? `${s.elapsedS.toFixed(3)} s` : "time unavailable"}</div>;
      })}
    </div>
    <small>GPS lines are measurements, not a recommended groove. Comparison requires aligned lap distances and verified start/finish.</small>
  </section>;
}
