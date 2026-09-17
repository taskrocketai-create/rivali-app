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
- Ask one short question at a time. Do not explain why you asked unless the driver asks why.
- Start a new Raceday by inviting the driver to tell you everything they know about the driver, kart, classes, track, conditions, setup and goals. Let them finish, organize it silently, then ask only material missing questions.
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

const screenToTab: Record<DougScreen, AppTab> = {
  home: "home", raceday: "home", upload: "upload", evidence: "sessions",
  track_map: "tracks", garage: "profile", drivers: "drivers", karts: "karts",
  history: "sessions", compare: "compare", profile: "profile",
};

export function DougCall({ racedayContext, onNavigate }: { racedayContext: string; onNavigate: (tab: AppTab) => void }) {
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
      const agent = new RealtimeAgent({
        name: "Doug",
        voice: "cedar",
        instructions: `${DOUG_INSTRUCTIONS}\n- You can control Rivali with open_screen. When the driver asks to see or open something, call the tool instead of merely describing where it is. After navigating, say one short sentence about what is on screen.\n- Use upload when the driver wants to add a MyChron file. Use evidence or history for prior sessions, compare for comparisons, track_map for GPS layout, and garage for saved equipment.\n\nCURRENT RACEDAY CONTEXT:\n${racedayContext}`,
        tools: [openScreen],
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
}"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { tool } from "@openai/agents";
import { RealtimeAgent, RealtimeSession } from "@openai/agents/realtime";
import { z } from "zod";

type CallState = "idle" | "connecting" | "listening" | "speaking" | "error";

const DOUG_INSTRUCTIONS = `You are Doug, Rivali's AI crew chief. You are a fictional middle-aged Southern former dirt oval champion and kart-racing legend. You are experienced, observant, encouraging, no-nonsense, and concise.

CONVERSATION RULES:
- Sound like a real crew chief on an earbud call, not an assistant reading a form.
- Ask one short question at a time. Do not explain why you asked unless the driver asks why.
- Start a new Raceday by inviting the driver to tell you everything they know about the driver, kart, classes, track, conditions, setup and goals. Let them finish, organize it silently, then ask only material missing questions.
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
  | { kind: "start_raceday"; summary: string; details: string }
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
        description: "Prepare a data-changing Rivali action for driver confirmation. Never claim the action is complete. Use this for starting a Raceday, switching the active class entry, recording a setup change, or locking a Dirty Tire set.",
        parameters: z.object({
          action: z.enum(["start_raceday", "select_entry", "record_setup_change", "lock_dirty_tires"]),
          summary: z.string().min(1).max(100),
          details: z.string().min(1).max(240),
          target: z.string().max(120).optional(),
          change: z.string().max(240).optional(),
          tire_set: z.string().max(120).optional(),
        }),
        execute: async ({ action, summary, details, target, change, tire_set }) => {
          if (action === "select_entry" && !target) return "Ask which class entry the driver wants before preparing the action.";
          if (action === "record_setup_change" && !change) return "Ask what changed before preparing the action.";
          if (action === "lock_dirty_tires" && !tire_set) return "Ask which tire set is being committed before preparing the action.";
          const prepared: DougAction = action === "select_entry"
            ? { kind: action, summary, details, target: target! }
            : action === "record_setup_change"
              ? { kind: action, summary, details, change: change! }
              : action === "lock_dirty_tires"
                ? { kind: action, summary, details, tireSet: tire_set! }
                : { kind: action, summary, details };
          onRequestAction(prepared);
          setCaption(`${summary} — waiting for your confirmation.`);
          return "The confirmation card is on screen. Ask the driver to confirm it there. Do not say it has been saved yet.";
        },
      });
      const agent = new RealtimeAgent({
        name: "Doug",
        voice: "cedar",
        instructions: `${DOUG_INSTRUCTIONS}\n- You can control Rivali with open_screen. When the driver asks to see or open something, call the tool instead of merely describing where it is. After navigating, say one short sentence about what is on screen.\n- Use prepare_action for anything that changes race data. Never say a prepared action is complete until the driver confirms it on screen.\n- Use upload when the driver wants to add a MyChron file. Use evidence or history for prior sessions, compare for comparisons, track_map for GPS layout, and garage for saved equipment.\n\nCURRENT RACEDAY CONTEXT:\n${racedayContext}`,
        tools: [openScreen, prepareAction],
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
          <span className="mic-pulse"><Phone /></span><span><small>{state === "connecting" ? "CONNECTING" : "ONE TAP TO CONNECT"}</small><strong>{state === "connecting" ? "CALLING DOUW…" : "CALL DOUG"}</strong></span>
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
- Ask one short question at a time. Do not explain why you asked unless the driver asks why.
- Start a new Raceday by inviting the driver to tell you everything they know about the driver, kart, classes, track, conditions, setup and goals. Let them finish, organize it silently, then ask only material missing questions.
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
  | { kind: "start_raceday"; summary: string; details: string }
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
        description: "Prepare a data-changing Rivali action for driver confirmation. Never claim the action is complete. Use this for starting a Raceday, switching the active class entry, recording a setup change, or locking a Dirty Tire set.",
        parameters: z.object({
          action: z.enum(["start_raceday", "select_entry", "record_setup_change", "lock_dirty_tires"]),
          summary: z.string().min(1).max(100),
          details: z.string().min(1).max(240),
          target: z.string().max(120).optional(),
          change: z.string().max(240).optional(),
          tire_set: z.string().max(120).optional(),
        }),
        execute: async ({ action, summary, details, target, change, tire_set }) => {
          if (action === "select_entry" && !target) return "Ask which class entry the driver wants before preparing the action.";
          if (action === "record_setup_change" && !change) return "Ask what changed before preparing the action.";
          if (action === "lock_dirty_tires" && !tire_set) return "Ask which tire set is being committed before preparing the action.";
          const prepared: DougAction = action === "select_entry"
            ? { kind: action, summary, details, target: target! }
            : action === "record_setup_change"
              ? { kind: action, summary, details, change: change! }
              : action === "lock_dirty_tires"
                ? { kind: action, summary, details, tireSet: tire_set! }
                : { kind: action, summary, details };
          onRequestAction(prepared);
          setCaption(`${summary} — waiting for your confirmation.`);
          return "The confirmation card is on screen. Ask the driver to confirm it there. Do not say it has been saved yet.";
        },
      });
      const agent = new RealtimeAgent({
        name: "Doug",
        voice: "cedar",
        instructions: `${DOUG_INSTRUCTIONS}\n- You can control Rivali with open_screen. When the driver asks to see or open something, call the tool instead of merely describing where it is. After navigating, say one short sentence about what is on screen.\n- Use prepare_action for anything that changes race data. Never say a prepared action is complete until the driver confirms it on screen.\n- Use upload when the driver wants to add a MyChron file. Use evidence or history for prior sessions, compare for comparisons, track_map for GPS layout, and garage for saved equipment.\n\nCURRENT RACEDAY CONTEXT:\n${racedayContext}`,
        tools: [openScreen, prepareAction],
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
          <span className="mic-pulse"><Phone /></span><span><small>{state === "connecting" ? "CONNECTING" : "ONE TAP TO CONNECT"}</small><strong>{state === "connecting" ? "CALLING DOUW…" : "CALL DOUG"}</strong></span>
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
