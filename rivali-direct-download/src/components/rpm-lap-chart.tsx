"use client";

import { useMemo, useState } from "react";

type RpmLap = {
  lap_number: number;
  min_rpm: number;
  max_rpm: number;
  average_rpm: number;
  sample_count: number;
  trace?: [number, number][];
};

export default function RpmLapChart({ laps }: { laps: RpmLap[] }) {
  const withTrace = useMemo(() => laps.filter((lap) => (lap.trace?.length ?? 0) > 1), [laps]);
  const [selectedLap, setSelectedLap] = useState<number | null>(null);
  const lap = withTrace.find((item) => item.lap_number === selectedLap) ?? withTrace[0];
  if (!lap?.trace) return null;
  const width = 740;
  const height = 225;
  const left = 55;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const minTime = lap.trace[0][0];
  const maxTime = lap.trace[lap.trace.length - 1][0];
  const span = Math.max(0.001, maxTime - minTime);
  const rpmCeiling = Math.max(1000, Math.ceil(lap.max_rpm / 1000) * 1000);
  const x = (time: number) => left + ((time - minTime) / span) * (width - left - right);
  const y = (rpm: number) => top + (1 - rpm / rpmCeiling) * (height - top - bottom);
  const path = lap.trace.map(([time, rpm], index) => `${index === 0 ? "M" : "L"}${x(time).toFixed(1)},${y(rpm).toFixed(1)}`).join(" ");
  return (
    <div style={{ marginTop: 14 }}>
      <label htmlFor="rpm-lap-picker" style={{ display: "block", marginBottom: 8 }}>Recorded RPM trace</label>
      <select id="rpm-lap-picker" value={lap.lap_number} onChange={(event) => setSelectedLap(Number(event.target.value))} style={{ marginBottom: 10, padding: 8, maxWidth: "100%" }}>
        {withTrace.map((item) => <option key={item.lap_number} value={item.lap_number}>Lap {item.lap_number}</option>)}
      </select>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Recorded engine RPM for lap ${lap.lap_number}, from ${lap.min_rpm} to ${lap.max_rpm} RPM`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const rpm = rpmCeiling * fraction;
          return <g key={fraction}>
            <line x1={left} y1={y(rpm)} x2={width - right} y2={y(rpm)} stroke="currentColor" strokeOpacity={0.18} />
            <text x={left - 7} y={y(rpm) + 4} fontSize={12} textAnchor="end" fill="currentColor">{Math.round(rpm).toLocaleString()}</text>
          </g>;
        })}
        <path d={path} fill="none" stroke="#f97316" strokeWidth={2} strokeLinejoin="round" />
        <text x={left} y={height - 9} fontSize={12} fill="currentColor">0 sec</text>
        <text x={width - right} y={height - 9} fontSize={12} textAnchor="end" fill="currentColor">{maxTime.toFixed(2)} sec</text>
      </svg>
      <p style={{ fontSize: 12, opacity: 0.8 }}>XRK recorded RPM, displayed at approximately 5 samples/second. Lap alignment verified by timing; visual comparison to RS3 pending.</p>
    </div>
  );
}
