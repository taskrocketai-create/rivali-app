"use client";

import { ArrowRight, Check, CloudSun, Footprints, Gauge, MapPinned, Route, Timer, Upload, Wrench } from "lucide-react";
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
  const baseLap = typeof latest?.setup?.base_lap_sec === "number" ? latest.setup.base_lap_sec : null;
  const goalGap = latest?.best_lap_sec && baseLap ? latest.best_lap_sec - baseLap : null;
  const quote = racedayQuote(latest?.session_date ?? new Date().toISOString().slice(0, 10));
  const activeTrack = latest?.tracks?.name ? tracks.find((track) => track.name === latest.tracks?.name) : tracks[0];
  const numericTurns = activeTrack?.turns ? Object.keys(activeTrack.turns).filter((key) => /^[1-4]$/.test(key)).length : 0;
  const hasLayout = Boolean(activeTrack?.start_finish && activeTrack.start_finish.length >= 2 && numericTurns === 4);
  const trackMeta = (activeTrack?.turns as Record<string, unknown> | null)?._rivali as { groove?: unknown[] } | undefined;
  const hasGroove = Boolean(trackMeta?.groove && trackMeta.groove.length > 1);
  const hasWeather = typeof conditions.air_temp_f === "number";
  const guide = !racers.length
    ? { title: "Save the driver first", detail: "Doug needs a driver before he can tie notes and results to the right person.", tab: "drivers" as OverviewTab, action: "Add driver" }
    : !karts.length
      ? { title: "Add the kart", detail: "Save the chassis once so every run has a home.", tab: "karts" as OverviewTab, action: "Add kart" }
      : !tracks.length
        ? { title: "Add today’s track", detail: "The location unlocks the map and automatic weather context.", tab: "tracks" as OverviewTab, action: "Add track" }
        : !activeTrack?.latitude || !activeTrack.longitude
          ? { title: "Pin the track on the map", detail: "Save its location now so Rivali can pull the right weather for every later session.", tab: "tracks" as OverviewTab, action: "Open map" }
          : !hasLayout
            ? { title: "Walk this track before the first real run", detail: "Mark start/finish and the four turn apexes. Entry and exit points are saved too for later comparison.", tab: "tracks" as OverviewTab, action: "Start track walk" }
            : !hasGroove
              ? { title: "Map the preferred groove", detail: "A controlled slow pass gives Doug a baseline for where the kart should be working tonight.", tab: "tracks" as OverviewTab, action: "Start groove pass" }
              : !latest
                ? { title: "Open the first session", detail: "Add the driver, kart, class, conditions, then send your MyChron data after the run.", tab: "upload" as OverviewTab, action: "Open session" }
                : !hasWeather
                  ? { title: "Save this session’s weather", detail: "Refresh the track weather before the next upload so the conditions stay useful later.", tab: "upload" as OverviewTab, action: "Open conditions" }
                  : { title: "The baseline is set—get the next run in here", detail: "After the kart comes off the track, upload the MyChron file and tell Doug what it did.", tab: "upload" as OverviewTab, action: "Upload session" };
  const steps = [
    { label: "Track location", ready: Boolean(activeTrack?.latitude && activeTrack?.longitude), tab: "tracks" as OverviewTab, icon: MapPinned },
    { label: "Walk / turn zones", ready: hasLayout, tab: "tracks" as OverviewTab, icon: Footprints },
    { label: "Preferred groove", ready: hasGroove, tab: "tracks" as OverviewTab, icon: Route },
    { label: "Session weather", ready: hasWeather, tab: "upload" as OverviewTab, icon: CloudSun },
    { label: "MyChron data", ready: Boolean(latest), tab: "upload" as OverviewTab, icon: Upload },
  ];
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
      <section className="doug-next-step" aria-label="Doug's race-day guidance">
        <div className="doug-next-copy">
          <small>DOUG&apos;S NEXT MOVE</small>
          <strong>{guide.title}</strong>
          <p>{guide.detail}</p>
        </div>
        <button className="button primary" onClick={() => onNavigate(guide.tab)}>{guide.action}<ArrowRight /></button>
        <div className="raceday-reminders" aria-label="Race-day reminders">
          {steps.map(({ label, ready, tab, icon: Icon }) => (
            <button key={label} className={ready ? "complete" : "needed"} onClick={() => onNavigate(tab)}>
              <span>{ready ? <Check /> : <Icon />}</span><strong>{label}</strong><small>{ready ? "Saved" : "Still useful"}</small>
            </button>
          ))}
        </div>
      </section>
      {latest && <section className="doug-evidence">
        <div><small>BEST LAP</small><strong>{latest.best_lap_sec?.toFixed(3) ?? "—"}</strong><span>seconds</span></div>
        <div><small>BASE LAP GOAL</small><strong>{baseLap?.toFixed(3) ?? "—"}</strong><span>{goalGap == null ? "set before first run" : goalGap <= 0 ? `${Math.abs(goalGap).toFixed(3)} under goal` : `+${goalGap.toFixed(3)} to goal`}</span></div>
        <div><small>BEST-TO-AVG</small><strong>{gap == null ? "—" : `+${gap.toFixed(3)}`}</strong><span>consistency gap</span></div>
        <div><small>LATEST RUN</small><strong>{latest.session_type}</strong><span>{latest.session_date}</span></div>
        <button onClick={() => onNavigate("upload")}><Upload /><strong>UPLOAD DATA</strong><ArrowRight /></button>
      </section>}
    </div>
  );
}
