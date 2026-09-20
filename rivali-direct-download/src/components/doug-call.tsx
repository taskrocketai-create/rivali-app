"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { tool } from "@openai/agents";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { z } from "zod";

type CallState = "idle" | "connecting" | "listening" | "speaking" | "error";

const DOUG_INSTRUCTIONS = `You are Doug, Rivali's AI crew chief. You are a fictional middle-aged Southern former dirt oval champion and kart-racing legend. You are experienced, observant, encouraging, no-nonsense, and concise.

CONVERSATION RULES:
- Sound like a real crew chief on an earbud call, not an assistant reading a form.
- Ask one short, driver-friendly question at a time. Use plain racing language, not database or engineering language.
- Make questions easy to answer out loud: offer two or three familiar choices when that helps, such as “practice, heat, or feature?” Never make the driver recite a long list.
- “I don’t know,” “not sure,” and “same as last time” are valid answers. Capture what is known, mark the rest as unknown, and only circle back if it materially affects the next decision.
- Ask for the fact that matters, not a label the driver may not know. Say “What was the kart doing—tight, loose, or both at different spots?” instead of asking for a technical diagnosis.
- For numbers, ask for one simple thing at a time and accept an approximate answer: “About what was the right-rear pressure?” Never ask for four tire pressures in one sentence.
- When a driver gives several facts at once, briefly repeat the important pieces in ordinary words, then ask only the next missing item.
- Do not explain why you asked unless the driver asks why.
- Start a new Raceday by inviting the driver to tell you everything they know about the driver, kart, classes, track, conditions, setup and goals. Let them finish, organize it silently, then ask only material missing questions.
- New-raceday intake order: confirm driver and kart, confirm track, identify the run type/class, capture the one goal or concern, then gather setup/conditions only as needed. Do not interrogate the driver before getting the session started.
- Keep normal replies to one or two short sentences.
- Use occasional dry Southern sarcasm or mild dirt-track language only during low-pressure moments. Never force a joke.
- Immediately stop joking when the driver reports safety concerns, mechanical problems, unexpected handling, lost pace, or anxiety about the kart.
- Be encouraging without empty praise. Use evidence when available.
- Never invent telemetry, measurements, setup history or rules. Say when data is missing.
- For a Dirty Tire class after lock, never recommend tire changes. Tires are locked; recommend only class-legal chassis adjustments.
- Recommend one controlled change at a time unless alternatives are requested.
- If a statement could cause an unsafe return to the track, tell the driver to stop and inspect the kart.
- Rivali is an Italian name created in the South by a good old former racer. You may make a brief joke about that occasionally, never repeatedly.
- Your name is Doug. Do not call yourself Wade or any other name.`;

type DougScreen = "home" | "raceday" | "upload" | "evidence" | "track_map" | "garage" | "drivers" | "karts" | "history" | "compare" | "profile";
type AppTab = "home" | "upload" | "debrief" | "drivers" | "karts" | "tracks" | "sessions" | "compare" | "profile";

export type DougAction =
  | { kind: "create_voice_session"; summary: string; details: string; racerId: string; kartId: string; trackId?: string; newTrack?: { name: string; location: string; latitude: number; longitude: number }; sessionDate: string; sessionType: "practice" | "hot laps" | "heat" | "feature"; className?: string; conditions?: string; setupNotes?: string; handlingNotes?: string }
  | { kind: "select_entry"; summary: string; details: string; target: string }
  | { kind: "record_setup_change"; summary: string; details: string; change: string }
  | { kind: "lock_dirty_tires"; summary: string; details: string; tireSet: string };

const screenToTab: Record<DougScreen, AppTab> = {
  home: "home", raceday: "home", upload: "upload", evidence: "sessions",
  track_map: "tracks", garage: "profile", drivers: "drivers", karts: "karts",
  history: "sessions", compare: "compare", profile: "profile",
};

export function DougCall({ racedayContext, onNavigate, onRequestAction }: {
  racedayContext: string;
  onNavigate: (tab: AppTab) => void;
  onRequestAction: (action: DougAction) => void;
}) {
  const sessionRef = useRef<RealtimeSession | null>(null);
  const [state, setState] = useState<CallState>("idle");
  const [muted, setMuted] = useState(false);
  const [caption, setCaption] = useState("Call Doug and talk normally through your phone or earbud.");

  useEffect(() => () => sessionRef.current?.close(), []);

  async function startCall() {
    setState("connecting");
    setCaption("Connecting Doug…");
    try {
      const response = await fetch("/api/realtime-token", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.value) throw new Error(payload.error ?? "Could not connect Doug.");
      const openScreen = tool({
        name: "open_screen",
        description: "Navigate the Rivali app to the screen the driver requests. Use this immediately when the driver asks to show, open, view, upload, compare, or manage something.",
        parameters: z.object({
          screen: z.enum(["home", "raceday", "upload", "evidence", "track_map", "garage", "drivers", "karts", "history", "compare", "profile"]),
          reason: z.string().max(120),
        }),
        execute: async ({ screen }) => {
          onNavigate(screenToTab[screen]);
          setCaption(`Doug opened ${screen.replaceAll("_", " ")}.`);
          return `Opened the ${screen.replaceAll("_", " ")} screen successfully.`;
        },
      });
      const prepareAction = tool({
        name: "prepare_action",
        description: "Prepare a data-changing Rivali action for driver confirmation. Never claim the action is complete. Use create_voice_session only after Doug has gathered the driver's race-day intake and matched the driver, kart, and track to IDs provided in CURRENT RACEDAY CONTEXT. Use it to create the new session before telemetry is uploaded.",
        parameters: z.object({
          action: z.enum(["create_voice_session", "select_entry", "record_setup_change", "lock_dirty_tires"]),
          summary: z.string().min(1).max(100),
          details: z.string().min(1).max(240),
          racer_id: z.string().uuid().optional(),
          kart_id: z.string().uuid().optional(),
          track_id: z.string().uuid().optional(),
          new_track_name: z.string().max(180).optional(),
          new_track_location: z.string().max(300).optional(),
          new_track_latitude: z.number().min(-90).max(90).optional(),
          new_track_longitude: z.number().min(-180).max(180).optional(),
          session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          session_type: z.enum(["practice", "hot laps", "heat", "feature"]).optional(),
          class_name: z.string().max(120).optional(),
          conditions: z.string().max(500).optional(),
          setup_notes: z.string().max(1000).optional(),
          handling_notes: z.string().max(1000).optional(),
          target: z.string().max(120).optional(),
          change: z.string().max(240).optional(),
          tire_set: z.string().max(120).optional(),
        }),
        execute: async ({ action, summary, details, racer_id, kart_id, track_id, new_track_name, new_track_location, new_track_latitude, new_track_longitude, session_date, session_type, class_name, conditions, setup_notes, handling_notes, target, change, tire_set }) => {
          const hasNewTrack = Boolean(new_track_name && new_track_location && new_track_latitude != null && new_track_longitude != null);
          if (action === "create_voice_session" && (!racer_id || !kart_id || (!track_id && !hasNewTrack) || !session_date || !session_type))
            return "Ask only for the missing driver, kart, track, date, or session type. For a new track, use find_track and pass its returned name, location, latitude and longitude.";
          if (action === "select_entry" && !target) return "Ask which class entry the driver wants before preparing the action.";
          if (action === "record_setup_change" && !change) return "Ask what changed before preparing the action.";
          if (action === "lock_dirty_tires" && !tire_set) return "Ask which tire set is being committed before preparing the action.";
          let prepared: DougAction;
          if (action === "create_voice_session")
            prepared = { kind: "create_voice_session", summary, details, racerId: racer_id!, kartId: kart_id!, trackId: track_id, newTrack: hasNewTrack ? { name: new_track_name!, location: new_track_location!, latitude: new_track_latitude!, longitude: new_track_longitude! } : undefined, sessionDate: session_date!, sessionType: session_type!, className: class_name, conditions, setupNotes: setup_notes, handlingNotes: handling_notes };
          else if (action === "select_entry")
            prepared = { kind: "select_entry", summary, details, target: target! };
          else if (action === "record_setup_change")
            prepared = { kind: "record_setup_change", summary, details, change: change! };
          else
            prepared = { kind: "lock_dirty_tires", summary, details, tireSet: tire_set! };
          onRequestAction(prepared);
          setCaption(`${summary} — waiting for your confirmation.`);
          return "The confirmation card is on screen. Ask the driver to confirm it there. Do not say it has been saved yet.";
        },
      });
      const agent = new RealtimeAgent({
        name: "Doug",
        voice: "cedar",
        instructions: `${DOUG_INSTRUCTIONS}\n- Respond quickly: one short question or one short confirmation, then stop talking.\n- Use open_screen when the driver asks to see or open something.\n- For a new Raceday, use find_track if the track is not already saved or the location is uncertain. Use get_weather whenever you have track coordinates, then include the returned weather summary in the saved session conditions.\n- End every complete new Raceday intake with prepare_action action=create_voice_session. Use the exact saved IDs from CURRENT RACEDAY CONTEXT, or the new-track fields returned by find_track. This creates a saved session awaiting MyChron data.\n- Use prepare_action for anything that changes race data. Never say it is saved until the driver confirms the on-screen card.\n\nCURRENT RACEDAY CONTEXT:\n${racedayContext}`,
        tools: [openScreen, prepareAction,
          tool({
            name: "find_track",
            description: "Find a U.S. race track by name and city/state. Use when the driver names a track that is not clearly in the saved track list, or when a saved track needs coordinates.",
            parameters: z.object({ query: z.string().min(3).max(180) }),
            execute: async ({ query }) => {
              const response = await fetch(`/api/track-search?q=${encodeURIComponent(query)}`);
              const payload = await response.json();
              if (!response.ok) return `Track search failed: ${payload.error ?? "service unavailable"}. Ask the driver to choose from their saved tracks or try city and state.`;
              const results = (payload.results ?? []).slice(0, 4).map((item: { label: string; latitude: number; longitude: number }) => ({ name: item.label, latitude: item.latitude, longitude: item.longitude }));
              return results.length ? JSON.stringify(results) : "No track matches found. Ask for the track name plus city and state.";
            },
          }),
          tool({
            name: "get_weather",
            description: "Get current weather for a known track latitude and longitude. Use before preparing a new Raceday session whenever coordinates are available.",
            parameters: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }),
            execute: async ({ latitude, longitude }) => {
              const response = await fetch(`/api/weather?latitude=${latitude}&longitude=${longitude}`);
              const weather = await response.json();
              if (!response.ok) return `Weather lookup failed: ${weather.error ?? "service unavailable"}.`;
              return `Current weather: ${weather.temperatureF}°F, ${weather.humidityPct}% humidity, wind ${weather.windSpeedMph} mph at ${weather.windDirectionDeg}°, gusts ${weather.windGustMph} mph, cloud cover ${weather.cloudCoverPct}%, precipitation ${weather.precipitationIn} in. Observed ${weather.observedAt} ${weather.timezone ?? ""}.`;
            },
          })],
      });
      const session = new RealtimeSession(agent, { model: "gpt-realtime-2.1" });
      session.on("audio_start", () => setState("speaking"));
      session.on("audio_stopped", () => setState("listening"));
      session.on("agent_end", (_context, _agent, output) => {
        if (output) setCaption(output);
      });
      session.on("transport_event", (event) => {
        const item = event as unknown as { type?: string; transcript?: string };
        if (item.type === "conversation.item.input_audio_transcription.completed" && item.transcript) setCaption(`You: ${item.transcript}`);
      });
      session.on("error", (event) => {
        console.error("Doug realtime error", event.error);
        setState("error");
        setCaption("Doug lost the connection. End the call and try again.");
      });
      await session.connect({ apiKey: payload.value });
      sessionRef.current = session;
      setState("listening");
      session.sendMessage("Start the call now. Greet the driver briefly as Doug, then ask whether we are continuing the current Raceday or starting a new one.");
    } catch (error) {
      setState("error");
      setCaption(error instanceof Error ? error.message : "Could not connect Doug.");
    }
  }

  function endCall() {
    sessionRef.current?.close();
    sessionRef.current = null;
    setMuted(false);
    setState("idle");
    setCaption("Call ended. Doug will be ready when you are.");
  }

  function toggleMute() {
    const next = !muted;
    sessionRef.current?.mute(next);
    setMuted(next);
  }

  const active = state === "listening" || state === "speaking";
  return (
    <div className={`doug-call ${state}`}>
      <div className="doug-caption" aria-live="polite"><small>{state === "speaking" ? "DOUG" : active ? "LISTENING" : "EARBUD CALL"}</small><span>{caption}</span></div>
      {!active ? (
        <button className="talk-to-doug" onClick={() => void startCall()} disabled={state === "connecting"}>
          <span className="mic-pulse"><Phone /></span><span><small>{state === "connecting" ? "CONNECTING" : "ONE TAP TO CONNECT"}</small><strong>{state === "connecting" ? "CALLING DOUG…" : "CALL DOUG"}</strong></span>
        </button>
      ) : (
        <div className="live-call-controls">
          <button className={muted ? "muted" : ""} onClick={toggleMute}>{muted ? <MicOff /> : <Mic />}<span>{muted ? "Unmute" : "Mute"}</span></button>
          <div className="call-live"><i />{state === "speaking" ? "Doug is talking" : "Doug is listening"}</div>
          <button className="end-call" onClick={endCall}><PhoneOff /><span>End</span></button>
        </div>
      )}
    </div>
  );
}
