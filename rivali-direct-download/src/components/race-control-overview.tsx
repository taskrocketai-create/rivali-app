"use client";

import { ArrowRight, CloudSun, Gauge, MapPinned, Timer, Upload, Wrench } from "lucide-react";
import type { Kart, Racer, RaceSession, Track } from "@/types/domain";

type OverviewTab = "home" | "upload" | "debrief" | "drivers" | "karts" | "tracks" | "sessions" | "compare" | "profile";

const dougQuotes = [
  "Fast comes from getting one thing right, then doing it again.",
  "A bad lap still tells the truth. Listen to it.",
  "Don’t chase perfect. Chase the next honest tenth.",
  "Keep your head quiet and make the kart tell the truth.",
  "You brought the work. Now let the laps show it.",
];

function racedayQuote(seed: string) {
  const value = Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0);
  return dougQuotes[value % dougQuotes.length];
}

export function RaceControlOverview({ racers, karts, tracks, sessions, onNavigate }: {
  racers: Racer[]; karts: Kart[]; tracks: Track[]; sessions: RaceSession[];
  onNavigate: (tab: OverviewTab) => void;
}) {
  const latest = sessions[0];
  const conditions = latest?.conditions ?? {};
  const temp = typeof conditions.air_temp_f === "number" ? `${conditions.air_temp_f}°F` : "—";
  const trackCondition = typeof conditions.track_condition === "string" && conditions.track_condition ? conditions.track_condition : "Not recorded";
  const gap = latest?.best_lap_sec && latest.average_lap_sec ? latest.average_lap_sec - latest.best_lap_sec : null;
  const quote = racedayQuote(latest?.session_date ?? new Date().toISOString().slice(0, 10));
  return (
    <div className="doug-home">
      <section className="race-command-intro">
        <div className="crew-conversation">
          <div className="conversation-status"><span /> DOUG IS READY</div>
          <p className="doug-line">{latest ? `We continuing ${latest.tracks?.name ?? "the current Raceday"}, or starting a new one?` : "Tell me everything you know about the driver, kart, classes and track. Don’t organize it—I’ll handle that part."}</p>
          <div className="conversation-actions">
            <button onClick={() => onNavigate("upload")}><Upload /> Start a new Raceday</button>
            {latest && <button onClick={() => onNavigate("sessions")}><Timer /> Continue current Raceday</button>}
          </div>
          <blockquote className="doug-quote"><small>DOUG’S WORD FOR THE RACEDAY</small>“{quote}”</blockquote>
          <p className="crew-hint">One question at a time. Explanations only when you ask why.</p>
        </div>
      </section>
      <section className="raceday-context">
        <div className="context-heading"><span>CURRENT CONTEXT</span><button onClick={() => onNavigate("sessions")}>History <ArrowRight /></button></div>
        <div className="context-strip">
          <div><Gauge /><small>DRIVER</small><strong>{latest?.racers?.name ?? racers[0]?.name ?? "Not selected"}</strong></div>
          <div><Wrench /><small>KART</small><strong>{latest?.karts?.name ?? karts[0]?.name ?? "Not selected"}</strong></div>
          <button onClick={() => onNavigate("tracks")}><MapPinned /><small>TRACK</small><strong>{latest?.tracks?.name ?? tracks[0]?.name ?? "Not selected"}</strong></button>
          <div><CloudSun /><small>CONDITIONS</small><strong>{trackCondition}</strong><span>{temp}</span></div>
        </div>
      </section>
      {latest && <section className="doug-evidence">
        <div><small>BEST LAP</small><strong>{latest.best_lap_sec?.toFixed(3) ?? "—"}</strong><span>seconds</span></div>
        <div><small>BEST-TO-AVG</small><strong>{gap == null ? "—" : `+${gap.toFixed(3)}`}</strong><span>consistency gap</span></div>
        <div><small>LATEST RUN</small><strong>{latest.session_type}</strong><span>{latest.session_date}</span></div>
        <button onClick={() => onNavigate("upload")}><Upload /><strong>UPLOAD DATA</strong><ArrowRight /></button>
      </section>}
    </div>
  );
}
