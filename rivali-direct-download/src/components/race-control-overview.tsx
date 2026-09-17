"use client";

import {
  ArrowRight,
  CloudSun,
  Flag,
  Gauge,
  MapPinned,
  Mic,
  Wrench,
  Timer,
  Upload,
} from "lucide-react";
import type { Kart, Racer, RaceSession, Track } from "@/types/domain";

type OverviewTab = "upload" | "debrief" | "tracks" | "sessions";

function lap(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(3)}`;
}

export function RaceControlOverview({
  racers,
  karts,
  tracks,
  sessions,
  onNavigate,
}: {
  racers: Racer[];
  karts: Kart[];
  tracks: Track[];
  sessions: RaceSession[];
  onNavigate: (tab: OverviewTab) => void;
}) {
  const latest = sessions[0];
  const conditions = latest?.conditions ?? {};
  const temp = typeof conditions.air_temp_f === "number" ? `${conditions.air_temp_f}°F` : "—";
  const trackCondition = typeof conditions.track_condition === "string" && conditions.track_condition
    ? conditions.track_condition
    : "Not recorded";
  const gap = latest?.best_lap_sec && latest.average_lap_sec
    ? latest.average_lap_sec - latest.best_lap_sec
    : null;

  return (
    <div className="race-control">
      <section className="race-hero">
        <div>
          <div className="eyebrow">RACE CONTROL · LIVE WORKSPACE</div>
          <h1 className="desktop-race-title">Find the next tenth.</h1>
          <h1 className="mobile-race-title">Race Control</h1>
          <p className="desktop-race-subtitle">Turn every lap, setup change, and driver comment into a faster decision.</p>
          <p className="mobile-race-subtitle">Drivers · Data · Stronger Together</p>
        </div>
        <div className="race-status">
          <span className="status-light" />
          <div><small>SYSTEM STATUS</small><strong>READY</strong></div>
        </div>
      </section>

      <section className="garage-strip" aria-label="Race shop totals">
        <button onClick={() => onNavigate("sessions")}><small>SESSIONS</small><strong>{sessions.length}</strong><span>View history <ArrowRight size={14} /></span></button>
        <div><small>DRIVERS</small><strong>{racers.length}</strong><span>Race roster</span></div>
        <div><small>KARTS</small><strong>{karts.length}</strong><span>Garage</span></div>
        <button onClick={() => onNavigate("tracks")}><small>TRACKS</small><strong>{tracks.length}</strong><span>GPS maps <ArrowRight size={14} /></span></button>
      </section>

      <div className="race-grid">
        <section className="current-session race-panel">
          <div className="panel-kicker"><Flag size={17} /> CURRENT SESSION</div>
          {latest ? (
            <>
              <div className="session-headline">
                <div><h2>{latest.session_type}</h2><p>{latest.session_date} · {latest.tracks?.name ?? "Track"}</p></div>
                <span className={`session-state ${latest.status}`}>{latest.status}</span>
              </div>
              <div className="session-chips">
                <div><Gauge /><small>DRIVER</small><strong>{latest.racers?.name ?? "—"}</strong></div>
                <div><Wrench /><small>KART</small><strong>{latest.karts?.name ?? "—"}</strong></div>
                <div><MapPinned /><small>TRACK</small><strong>{latest.tracks?.name ?? "—"}</strong></div>
                <div><CloudSun /><small>WEATHER</small><strong>{temp}</strong><span>{trackCondition}</span></div>
              </div>
            </>
          ) : (
            <div className="empty-session"><h2>Ready for the first run.</h2><p>Upload a MyChron session to create the first race report.</p><button className="race-link" onClick={() => onNavigate("upload")}>Upload session <ArrowRight size={16} /></button></div>
          )}
        </section>

        <section className="track-visual race-panel">
          <div className="panel-kicker"><MapPinned size={17} /> TRACK MAP</div>
          <button className="track-canvas" onClick={() => onNavigate("tracks")} aria-label="Open GPS track map">
            <span className="oval outer" /><span className="oval racing-line" /><span className="oval inner" />
            <span className="start-line" /><span className="turn-label t1">T1</span><span className="turn-label t2">T2</span><span className="turn-label t3">T3</span><span className="turn-label t4">T4</span>
            <span className="track-name">{latest?.tracks?.name ?? "SELECT A TRACK"}<small>{latest ? "GPS LAYOUT" : "MAP WORKSPACE"}</small></span>
          </button>
        </section>
      </div>

      <section className="performance-grid">
        <div className="metric-card"><Timer /><small>BEST LAP</small><strong>{lap(latest?.best_lap_sec)}</strong><span>seconds</span></div>
        <div className="metric-card"><Timer /><small>LAST LAP</small><strong>—</strong><span>awaiting live timing</span></div>
        <div className="metric-card"><Gauge /><small>BEST-TO-AVG</small><strong>{gap == null ? "—" : `+${gap.toFixed(3)}`}</strong><span>consistency gap</span></div>
        <div className="metric-card"><CloudSun /><small>CONDITIONS</small><strong>{trackCondition}</strong><span>{temp}</span></div>
      </section>

      <section className="race-actions">
        <button className="primary-race-action" onClick={() => onNavigate("upload")}><Upload /><span><small>ADD NEW DATA</small><strong>UPLOAD SESSION</strong></span><ArrowRight /></button>
        <button className="secondary-race-action" onClick={() => onNavigate("debrief")}><Mic /><span><small>CAPTURE DRIVER FEEDBACK</small><strong>VOICE DEBRIEF</strong></span><ArrowRight /></button>
      </section>
    </div>
  );
}
