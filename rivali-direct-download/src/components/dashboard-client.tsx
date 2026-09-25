"use client";
import { useMemo, useState, type FormEvent } from "react";
import {
  Upload,
  Users,
  Wrench,
  MapPinned,
  History,
  Mic,
  Gauge,
  Home,
  BarChart3,
  UserRound,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  Kart,
  PendingImport,
  Racer,
  RaceSession,
  Track,
} from "@/types/domain";
import { TrackMapEditor } from "./track-map-editor";
import { VoiceDebriefRecorder } from "./voice-debrief";
import { RaceControlOverview } from "./race-control-overview";
import type { DougAction } from "./doug-call";
import { FloatingDoug } from "./floating-doug";

type Tab = "home" | "upload" | "debrief" | "drivers" | "karts" | "tracks" | "sessions" | "compare" | "profile";
const tabItems: [Tab, string, typeof Upload][] = [
  ["home", "Race control", Gauge],
  ["upload", "Upload session", Upload],
  ["debrief", "Voice debrief", Mic],
  ["drivers", "Drivers", Users],
  ["karts", "Karts", Wrench],
  ["tracks", "GPS track map", MapPinned],
  ["sessions", "Session history", History],
];

export function DashboardClient({
  racers: initialRacers,
  karts: initialKarts,
  tracks: initialTracks,
  sessions: initialSessions,
  pendingImports: initialPendingImports,
}: {
  racers: Racer[];
  karts: Kart[];
  tracks: Track[];
  sessions: RaceSession[];
  pendingImports: PendingImport[];
}) {
  const [tab, setTab] = useState<Tab>("home");
  const [racers, setRacers] = useState(initialRacers);
  const [karts, setKarts] = useState(initialKarts);
  const [tracks, setTracks] = useState(initialTracks);
  const [sessions, setSessions] = useState(initialSessions);
  const [pendingImports, setPendingImports] = useState(initialPendingImports);
  const [selectedPendingId, setSelectedPendingId] = useState("");
  const [attachSessionId, setAttachSessionId] = useState("");
  const [shortcutToken, setShortcutToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [weatherBusy, setWeatherBusy] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [airTempF, setAirTempF] = useState("");
  const [humidityPct, setHumidityPct] = useState("");
  const [weatherNotes, setWeatherNotes] = useState("");
  const [dirtyTireRule, setDirtyTireRule] = useState(false);
  const [tireLocked, setTireLocked] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState(initialSessions[0]?.id ?? "");
  const [pendingDougAction, setPendingDougAction] = useState<DougAction | null>(null);
  const supabase = createClient();
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0];
  const attachableSessions = sessions.filter((session) => session.setup?.telemetry_attached !== true);
  const selectedAttachSession = sessions.find((session) => session.id === attachSessionId);
  const racedayContext = useMemo(() => JSON.stringify({
    latestSession: activeSession ? { date: activeSession.session_date, type: activeSession.session_type, driver: activeSession.racers?.name, kart: activeSession.karts?.name, track: activeSession.tracks?.name, setup: activeSession.setup, conditions: activeSession.conditions, bestLapSeconds: activeSession.best_lap_sec } : null,
    savedDrivers: racers.map((item) => ({ id: item.id, name: item.name })),
    savedKarts: karts.map((item) => ({ id: item.id, racerId: item.racer_id, name: item.name })),
    savedTracks: tracks.map((item) => ({ id: item.id, name: item.name, latitude: item.latitude, longitude: item.longitude })),
  }), [activeSession, racers, karts, tracks]);
  const dougGuidance = useMemo(() => {
    const mappedTrack = tracks.find((track) => track.latitude != null && track.longitude != null);
    const turnCount = mappedTrack?.turns ? Object.keys(mappedTrack.turns).filter((key) => /^[1-4]$/.test(key)).length : 0;
    const layoutReady = Boolean(mappedTrack?.start_finish && mappedTrack.start_finish.length >= 2 && turnCount === 4);
    const meta = (mappedTrack?.turns as Record<string, unknown> | null)?._rivali as { groove?: unknown[] } | undefined;
    if (!racers.length) return "First things first: save the driver, then we can make every result mean something.";
    if (!karts.length) return "Get the kart saved. I’ll keep its setup and results together from there.";
    if (!tracks.length) return "Add today’s track so we do not lose the context that matters later.";
    if (!mappedTrack) return "Pin the track on the map. That gives us weather and a home for the race-day data.";
    if (!layoutReady) return "Before the racing gets busy, let’s walk the track and save the turn zones.";
    if (!meta?.groove?.length) return "A slow groove pass now will give us a useful baseline when the track changes.";
    if (!activeSession) return "When the first run comes off the track, open a session and we’ll keep the whole story together.";
    return "Stay on the job. After each run, send the data and tell me what the kart did while it is still fresh.";
  }, [activeSession, karts.length, racers.length, tracks]);

  async function confirmDougAction() {
    if (!pendingDougAction) return;
    const action = pendingDougAction;
    setBusy(true);
    setMessage("");
    try {
      if (action.kind === "create_voice_session") {
        const user_id = await ownerId();
        const id = crypto.randomUUID();
        let trackId = action.trackId;
        if (!trackId && action.newTrack) {
          const { data: createdTrack, error: trackError } = await supabase
            .from("tracks")
            .insert({ user_id, name: action.newTrack.name, location: action.newTrack.location, latitude: action.newTrack.latitude, longitude: action.newTrack.longitude })
            .select("id,name,location,surface_type,latitude,longitude,start_finish,turns")
            .single();
          if (trackError) throw trackError;
          trackId = createdTrack.id;
          setTracks((current) => [...current, createdTrack as Track]);
        }
        if (!trackId) throw new Error("Doug needs a saved track before he can create this session.");
        const { data, error } = await supabase
          .from("sessions")
          .insert({
            id,
            user_id,
            racer_id: action.racerId,
            kart_id: action.kartId,
            track_id: trackId,
            session_date: action.sessionDate,
            session_type: action.sessionType,
            raw_file_name: "Voice intake — awaiting MyChron data",
            raw_storage_path: `${user_id}/voice-intake/${id}.pending`,
            setup: { class_name: action.className ?? null, notes: action.setupNotes ?? null, voice_intake: true, telemetry_attached: false },
            conditions: { voice_notes: action.conditions ?? null },
            handling_feedback: { voice_notes: action.handlingNotes ?? null },
            status: "queued",
          })
          .select("id,session_date,session_type,status,best_lap_sec,average_lap_sec,consistency_stdev_sec,lap_count,setup,conditions,raw_file_name,tracks(id,name),racers(id,name),karts(id,name),recommendations(recommendation,confidence)")
          .single();
        if (error) throw error;
        setSessions((current) => [data as unknown as RaceSession, ...current]);
        setActiveSessionId(id);
        setTab("upload");
        setMessage("Doug saved this session. Attach the MyChron file when the run is complete.");
      } else if (action.kind === "select_entry") {
        const query = action.target.toLowerCase();
        const match = sessions.find((session) =>
          [session.setup.class_name, session.racers?.name, session.karts?.name]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        );
        if (!match) throw new Error(`I couldn't find a saved entry matching “${action.target}”.`);
        setActiveSessionId(match.id);
        setMessage(`${action.target} is now the active entry.`);
      } else {
        if (!activeSession) throw new Error("Upload or select a session before changing its setup.");
        const now = new Date().toISOString();
        const existingLog = Array.isArray(activeSession.setup.change_log) ? activeSession.setup.change_log : [];
        const setup = action.kind === "record_setup_change"
          ? { ...activeSession.setup, change_log: [...existingLog, { change: action.change, recorded_at: now, source: "doug" }] }
          : { ...activeSession.setup, dirty_tire_rule: true, tire_locked: true, tire_set_id: action.tireSet, tire_locked_at: now };
        const { data, error } = await supabase
          .from("sessions")
          .update({ setup })
          .eq("id", activeSession.id)
          .select("id,setup")
          .single();
        if (error) throw error;
        setSessions((current) => current.map((session) => session.id === data.id ? { ...session, setup: data.setup } : session));
        setMessage(action.kind === "record_setup_change" ? "Setup change saved." : `Dirty Tires locked: ${action.tireSet}. Chassis adjustments remain available.`);
      }
      setPendingDougAction(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Doug could not complete that action.");
    } finally {
      setBusy(false);
    }
  }
  async function ownerId() {
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims?.sub)
      throw new Error("Your session expired. Sign in again.");
    return data.claims.sub;
  }
  async function addRacer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const user_id = await ownerId();
      const { data, error } = await supabase
        .from("racers")
        .insert({
          user_id,
          name: form.get("name"),
          driver_weight_lb: Number(form.get("weight_lb")) || null,
          experience_level: form.get("experience_level") || null,
        })
        .select("id,name,experience_level,driver_weight_lb")
        .single();
      if (error) throw error;
      setRacers([...racers, data]);
      event.currentTarget.reset();
      setMessage("Driver saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save driver.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addKart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const user_id = await ownerId();
      const { data, error } = await supabase
        .from("karts")
        .insert({
          user_id,
          racer_id: form.get("racer_id"),
          name: form.get("name"),
          chassis_make: form.get("chassis_make") || null,
          chassis_model: form.get("chassis_model") || null,
          tire_compound: form.get("tire_compound") || null,
        })
        .select("id,racer_id,name,chassis_make,chassis_model,tire_compound")
        .single();
      if (error) throw error;
      setKarts([...karts, data]);
      event.currentTarget.reset();
      setMessage("Kart saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save kart.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function addTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const user_id = await ownerId();
      const { data, error } = await supabase
        .from("tracks")
        .insert({
          user_id,
          name: form.get("name"),
          location: form.get("location") || null,
          surface_type: form.get("surface_type") || null,
        })
        .select("id,name,location,surface_type,latitude,longitude,start_finish,turns")
        .single();
      if (error) throw error;
      setTracks([...tracks, data]);
      event.currentTarget.reset();
      setMessage("Track saved. Use GPS Track Map to mark the racing surface.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save track.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadCurrentWeather(trackId: string) {
    setSelectedTrackId(trackId);
    if (!trackId) return;
    const track = tracks.find((item) => item.id === trackId);
    if (track?.latitude == null || track?.longitude == null) return setMessage("Search and save this track on the GPS Track Map before using automatic weather.");
    setWeatherBusy(true);
    setMessage("Loading current track weather...");
    try {
      const response = await fetch(`/api/weather?latitude=${track.latitude}&longitude=${track.longitude}`);
      const weather = await response.json();
      if (!response.ok) throw new Error(weather.error ?? "Current weather lookup failed.");
      setAirTempF(String(weather.temperatureF ?? ""));
      setHumidityPct(String(weather.humidityPct ?? ""));
      setWeatherNotes([`Auto weather ${weather.observedAt ?? ""} ${weather.timezone ?? ""}`.trim(), `wind ${weather.windSpeedMph ?? "?"} mph at ${weather.windDirectionDeg ?? "?"}°`, `gusts ${weather.windGustMph ?? "?"} mph`, `cloud cover ${weather.cloudCoverPct ?? "?"}%`, `precipitation ${weather.precipitationIn ?? 0} in`, `weather code ${weather.weatherCode ?? "?"}`].join("; "));
      setMessage("Current weather loaded from the track coordinates. Adjust it if track-side conditions differ.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Current weather lookup failed.");
    } finally { setWeatherBusy(false); }
  }
  async function updateBaseLapGoal(sessionId: string, baseLapSec: number) {
    if (!Number.isFinite(baseLapSec) || baseLapSec <= 0) throw new Error("Enter a lap goal greater than zero.");
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error("Session not found.");
    const setup = { ...session.setup, base_lap_sec: baseLapSec };
    const { data, error } = await supabase.from("sessions")
      .update({ setup })
      .eq("id", sessionId)
      .select("id,setup")
      .single();
    if (error) throw error;
    setSessions((current) => current.map((item) => item.id === data.id ? { ...item, setup: data.setup } : item));
    setMessage(`Base lap goal updated to ${baseLapSec.toFixed(3)} seconds.`);
  }
  async function uploadSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const file = form.get("file") as File;
    const pending = pendingImports.find((item) => item.id === selectedPendingId);
    const existingSession = sessions.find((item) => item.id === attachSessionId);
    let uploadedPath = "";
    let createdSessionId = "";
    try {
      if (!pending && !file?.name.toLowerCase().endsWith(".xrk"))
        throw new Error("Choose a MyChron .xrk file.");
      if (!pending && file.size > 100 * 1024 * 1024)
        throw new Error("The maximum file size is 100 MB.");
      const user_id = await ownerId();
      const id = existingSession?.id ?? crypto.randomUUID();
      const rawFileName = pending?.raw_file_name ?? file.name;
      if (pending) {
        uploadedPath = pending.raw_storage_path;
      } else {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        uploadedPath = `${user_id}/${id}/${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("telemetry")
          .upload(uploadedPath, file, {
            contentType: "application/octet-stream",
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }
      const existingSetup = existingSession?.setup ?? {};
      const existingConditions = existingSession?.conditions ?? {};
      const baseLapValue = Number(form.get("base_lap_sec"));
      const setup = {
        ...(existingSession?.setup ?? {}),
        class_name: form.get("class_name") || existingSetup.class_name || null,
        base_lap_sec: Number.isFinite(baseLapValue) && baseLapValue > 0 ? baseLapValue : existingSetup.base_lap_sec || null,
        tire_set_id: form.get("tire_set_id") || existingSetup.tire_set_id || null,
        dirty_tire_rule: dirtyTireRule || Boolean(existingSetup.dirty_tire_rule),
        dirty_tire_cutoff: dirtyTireRule ? form.get("dirty_tire_cutoff") || null : existingSetup.dirty_tire_cutoff || null,
        tire_locked: (dirtyTireRule && tireLocked) || Boolean(existingSetup.tire_locked),
        lf_pressure_psi: Number(form.get("lf_pressure_psi")) || existingSetup.lf_pressure_psi || null,
        rf_pressure_psi: Number(form.get("rf_pressure_psi")) || existingSetup.rf_pressure_psi || null,
        lr_pressure_psi: Number(form.get("lr_pressure_psi")) || existingSetup.lr_pressure_psi || null,
        rr_pressure_psi: Number(form.get("rr_pressure_psi")) || existingSetup.rr_pressure_psi || null,
        rear_sprocket: Number(form.get("rear_sprocket")) || existingSetup.rear_sprocket || null,
        notes: form.get("setup_notes") || existingSetup.notes || null,
        telemetry_attached: true,
      };
      const conditions = {
        ...(existingSession?.conditions ?? {}),
        air_temp_f: Number(form.get("air_temp_f")) || existingConditions.air_temp_f || null,
        humidity_pct: Number(form.get("humidity_pct")) || existingConditions.humidity_pct || null,
        track_condition: form.get("track_condition") || existingConditions.track_condition || null,
        weather_notes: form.get("weather_notes") || existingConditions.weather_notes || null,
      };
      const sessionPayload = {
        ...(existingSession ? {} : {
          id,
          user_id,
          racer_id: form.get("racer_id"),
          kart_id: form.get("kart_id"),
          track_id: form.get("track_id"),
          session_date: form.get("session_date"),
          session_type: form.get("session_type"),
        }),
        raw_file_name: rawFileName,
        raw_storage_path: uploadedPath,
        setup,
        conditions,
        status: "queued",
      };
      const sessionQuery = existingSession
        ? supabase.from("sessions").update(sessionPayload).eq("id", id)
        : supabase.from("sessions").insert(sessionPayload);
      const { data: session, error: sessionError } = await sessionQuery
        .select("id,session_date,session_type,status,best_lap_sec,average_lap_sec,consistency_stdev_sec,lap_count,setup,conditions,raw_file_name,tracks(id,name),racers(id,name),karts(id,name),recommendations(recommendation,confidence)")
        .single();
      if (sessionError) throw sessionError;
      if (!existingSession) createdSessionId = id;
      const { error: jobError } = await supabase
        .from("processing_jobs")
        .upsert({ user_id, session_id: id, status: "queued", error: null, locked_at: null }, { onConflict: "session_id" });
      if (jobError) throw jobError;
      if (pending) {
        const { error: pendingError } = await supabase
          .from("pending_imports")
          .update({ status: "imported", imported_session_id: id, imported_at: new Date().toISOString() })
          .eq("id", pending.id);
        if (pendingError) throw pendingError;
        setPendingImports((current) => current.filter((item) => item.id !== pending.id));
        setSelectedPendingId("");
      }
      setSessions((current) => existingSession
        ? current.map((item) => item.id === id ? session as unknown as RaceSession : item)
        : [session as unknown as RaceSession, ...current]);
      setActiveSessionId(id);
      setAttachSessionId("");
      event.currentTarget.reset();
      setDirtyTireRule(false);
      setTireLocked(false);
      setMessage(existingSession ? "MyChron data attached to the pre-race session and queued for analysis." : "Session uploaded and queued for analysis.");
    } catch (error) {
      if (createdSessionId)
        await supabase.from("sessions").delete().eq("id", createdSessionId);
      if (uploadedPath && !pending)
        await supabase.storage.from("telemetry").remove([uploadedPath]);
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  async function createShortcutToken() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/shortcut-token", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not create Shortcut token.");
      setShortcutToken(result.token);
      setMessage("Shortcut token created. Copy it now; Rivali will not show this token again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create Shortcut token.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <aside className="tabs">
        {tabItems.map(([id, label, Icon]) => (
          <button
            key={id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => {
              setTab(id);
              setMessage("");
            }}
          >
            <Icon size={18} /> <span>{label}</span>
          </button>
        ))}
      </aside>
      <section className="panel">
        {message && <div className="notice">{message}</div>}
        {pendingDougAction && (
          <div className="doug-confirm" role="dialog" aria-label="Confirm Doug's action">
            <div><small>DOUG WANTS TO</small><strong>{pendingDougAction.summary}</strong><p>{pendingDougAction.details}</p></div>
            <div className="doug-confirm-actions">
              <button className="button" onClick={() => setPendingDougAction(null)} disabled={busy}>Cancel</button>
              <button className="button primary" onClick={() => void confirmDougAction()} disabled={busy}>{busy ? "Saving…" : "Confirm"}</button>
            </div>
          </div>
        )}
        {tab === "home" && (
          <RaceControlOverview
            racers={racers}
            karts={karts}
            tracks={tracks}
            sessions={activeSession ? [activeSession, ...sessions.filter((session) => session.id !== activeSession.id)] : sessions}
            onNavigate={(destination) => setTab(destination)}
            onUpdateBaseLapGoal={updateBaseLapGoal}
          />
        )}
        {tab === "upload" && (
          <form className="card stack" onSubmit={uploadSession}>
            <h2>Upload a MyChron session</h2>
            {attachableSessions.length > 0 && (
              <div className="field">
                <label>Attach data to a saved pre-race baseline</label>
                <select value={attachSessionId} onChange={(event) => setAttachSessionId(event.target.value)}>
                  <option value="">Create a separate session instead</option>
                  {attachableSessions.map((session) => <option key={session.id} value={session.id}>{session.session_date} · {session.tracks?.name ?? "Track"} · {session.setup.class_name ?? session.session_type} · {session.racers?.name ?? "Driver"}</option>)}
                </select>
                {attachSessionId && <small className="muted">Rivali will preserve the baseline setup, class, goal lap, conditions, and driver notes already saved for this session.</small>}
              </div>
            )}
            <div className="shortcut-setup">
              <div>
                <strong>Send from the iPhone Share Sheet</strong>
                <p>Generate a token once, then use it in the “Send to Rivali” Shortcut as a Bearer token.</p>
              </div>
              <button className="button small secondary" type="button" disabled={busy} onClick={() => void createShortcutToken()}>
                Create Shortcut token
              </button>
              {shortcutToken && <code className="shortcut-token">{shortcutToken}</code>}
            </div>
            {pendingImports.length > 0 && (
              <div className="pending-imports">
                <strong>Files sent from your iPhone</strong>
                {pendingImports.map((item) => (
                  <button
                    key={item.id}
                    className={selectedPendingId === item.id ? "selected" : ""}
                    type="button"
                    onClick={() => setSelectedPendingId(item.id)}
                  >
                    <span>{item.raw_file_name}</span>
                    <small>{new Date(item.created_at).toLocaleString()}</small>
                  </button>
                ))}
              </div>
            )}
            {racers.length === 0 ||
            karts.length === 0 ||
            tracks.length === 0 ? (
              <div className="notice">
                Create a driver, kart, and track before uploading the first
                session.
              </div>
            ) : null}
            <div className="grid-3">
              <div className="field">
                <label>Driver</label>
                <select name="racer_id" required disabled={Boolean(attachSessionId)}>
                  <option value="">Select</option>
                  {racers.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Kart</label>
                <select name="kart_id" required disabled={Boolean(attachSessionId)}>
                  <option value="">Select</option>
                  {karts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Track</label>
                <select name="track_id" required value={selectedTrackId} disabled={Boolean(attachSessionId)} onChange={(event) => void loadCurrentWeather(event.target.value)}>
                  <option value="">Select</option>
                  {tracks.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Date</label>
                <input
                  name="session_date"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  required
                  disabled={Boolean(attachSessionId)}
                />
              </div>
              <div className="field">
                <label>Session type</label>
                <select name="session_type" disabled={Boolean(attachSessionId)}>
                  <option>practice</option>
                  <option>hot laps</option>
                  <option>heat</option>
                  <option>feature</option>
                </select>
              </div>
              <div className="field">
                <label>.xrk file</label>
                <input name="file" type="file" accept=".xrk" required={!selectedPendingId} disabled={Boolean(selectedPendingId)} />
                {selectedPendingId && <small>Using the selected iPhone upload.</small>}
              </div>
            </div>
            <div className="section-heading-row"><h3>Class and tire rules</h3></div>
            <div className="grid-3">
              <div className="field">
                <label>Class</label>
                <input name="class_name" placeholder="Clone Heavy" />
              </div>
              <div className="field">
                <label>Base lap goal (seconds)</label>
                <input key={attachSessionId} name="base_lap_sec" type="number" min="1" step="0.001" defaultValue={selectedAttachSession?.setup.base_lap_sec ?? 12.3} placeholder="12.300" />
                <small className="muted">Your off-the-trailer target for this class.</small>
              </div>
              <div className="field">
                <label>Tire set</label>
                <input name="tire_set_id" placeholder="Set 33-B" />
              </div>
              <label className="rule-toggle">
                <input
                  type="checkbox"
                  checked={dirtyTireRule}
                  onChange={(event) => {
                    setDirtyTireRule(event.target.checked);
                    if (!event.target.checked) setTireLocked(false);
                  }}
                />
                <span><strong>Dirty Tire Class</strong><small>Lock tire changes after the cutoff</small></span>
              </label>
            </div>
            {dirtyTireRule && (
              <div className={`dirty-tire-rule ${tireLocked ? "locked" : "armed"}`}>
                <div>
                  <strong>{tireLocked ? "DIRTY TIRE LOCKED" : "DIRTY TIRE RULE ARMED"}</strong>
                  <span>{tireLocked ? "Chassis adjustments allowed · Tire adjustments prohibited" : "Record when the tire set becomes locked"}</span>
                </div>
                <div className="dirty-tire-controls">
                  <label>
                    Cutoff
                    <select name="dirty_tire_cutoff" defaultValue="qualifying">
                      <option value="practice">After practice</option>
                      <option value="hot_laps">After hot laps</option>
                      <option value="heat">After heat</option>
                      <option value="qualifying">After qualifying</option>
                    </select>
                  </label>
                  <label className="lock-switch">
                    <input type="checkbox" checked={tireLocked} onChange={(event) => setTireLocked(event.target.checked)} />
                    Tire set is locked now
                  </label>
                </div>
              </div>
            )}
            <div className="section-heading-row"><h3>Conditions</h3><button className="button small secondary" type="button" disabled={!selectedTrackId || weatherBusy} onClick={() => void loadCurrentWeather(selectedTrackId)}>{weatherBusy ? "Loading weather..." : "Refresh track weather"}</button></div>
            <div className="grid-3">
              <div className="field">
                <label>Air temp °F</label>
                <input name="air_temp_f" type="number" step=".1" value={airTempF} onChange={(event) => setAirTempF(event.target.value)} />
              </div>
              <div className="field">
                <label>Humidity %</label>
                <input
                  name="humidity_pct"
                  type="number"
                  min="0"
                  max="100"
                  step=".1"
                  value={humidityPct}
                  onChange={(event) => setHumidityPct(event.target.value)}
                />
              </div>
              <div className="field">
                <label>Track condition</label>
                <select name="track_condition">
                  <option value="">Unknown</option>
                  <option>wet/heavy</option>
                  <option>tacky</option>
                  <option>transitioning</option>
                  <option>dry/slick</option>
                  <option>rubbered</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Weather notes</label>
              <input
                name="weather_notes"
                placeholder="Cloud cover, wind, recent watering..."
                value={weatherNotes}
                onChange={(event) => setWeatherNotes(event.target.value)}
              />
            </div>
            <h3>Current setup</h3>
            <div className="grid-3">
              <div className="field">
                <label>LF pressure</label>
                <input name="lf_pressure_psi" type="number" step=".1" disabled={tireLocked} />
              </div>
              <div className="field">
                <label>RF pressure</label>
                <input name="rf_pressure_psi" type="number" step=".1" disabled={tireLocked} />
              </div>
              <div className="field">
                <label>LR pressure</label>
                <input name="lr_pressure_psi" type="number" step=".1" disabled={tireLocked} />
              </div>
              <div className="field">
                <label>RR pressure</label>
                <input name="rr_pressure_psi" type="number" step=".1" disabled={tireLocked} />
              </div>
              <div className="field">
                <label>Rear sprocket</label>
                <input name="rear_sprocket" type="number" />
              </div>
              <div className="field">
                <label>Setup notes</label>
                <input name="setup_notes" />
              </div>
            </div>
            <button
              className="button"
              disabled={
                busy || !racers.length || !karts.length || !tracks.length
              }
            >
              {busy ? "Uploading..." : "Upload and analyze"}
            </button>
          </form>
        )}
        {tab === "drivers" && (
          <div className="grid-2">
            <form className="card" onSubmit={addRacer}>
              <h2>Add driver</h2>
              <div className="field">
                <label>Name</label>
                <input name="name" required />
              </div>
              <div className="field">
                <label>Weight (lb)</label>
                <input name="weight_lb" type="number" step=".1" />
              </div>
              <div className="field">
                <label>Experience</label>
                <select name="experience_level">
                  <option value="">Not set</option>
                  <option>rookie</option>
                  <option>intermediate</option>
                  <option>advanced</option>
                </select>
              </div>
              <button className="button" disabled={busy}>
                Save driver
              </button>
            </form>
            <div className="card">
              <h2>Drivers</h2>
              {racers.map((x) => (
                <div className="session-row" key={x.id}>
                  <strong>{x.name}</strong>
                  <span>
                    {x.driver_weight_lb ? `${x.driver_weight_lb} lb` : "—"}
                  </span>
                  <span>{x.experience_level ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "debrief" && <VoiceDebriefRecorder sessions={sessions} />}
        {tab === "karts" && (
          <div className="grid-2">
            <form className="card" onSubmit={addKart}>
              <h2>Add kart</h2>
              <div className="field">
                <label>Driver</label>
                <select name="racer_id" required>
                  <option value="">Select</option>
                  {racers.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Kart name</label>
                <input name="name" placeholder="Primary kart" required />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label>Chassis make</label>
                  <input name="chassis_make" />
                </div>
                <div className="field">
                  <label>Model</label>
                  <input name="chassis_model" />
                </div>
              </div>
              <div className="field">
                <label>Tire compound</label>
                <input name="tire_compound" />
              </div>
              <button className="button" disabled={busy}>
                Save kart
              </button>
            </form>
            <div className="card">
              <h2>Karts</h2>
              {karts.map((x) => (
                <div className="session-row" key={x.id}>
                  <strong>{x.name}</strong>
                  <span>{x.chassis_make ?? "—"}</span>
                  <span>{x.chassis_model ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "tracks" && (
          <div className="stack">
            <form className="card" onSubmit={addTrack}>
              <h2>Add track</h2>
              <div className="grid-3">
                <div className="field">
                  <label>Name</label>
                  <input name="name" required />
                </div>
                <div className="field">
                  <label>Location</label>
                  <input name="location" />
                </div>
                <div className="field">
                  <label>Surface</label>
                  <input name="surface_type" placeholder="Red clay" />
                </div>
              </div>
              <button className="button" disabled={busy}>
                Save track
              </button>
            </form>
            <TrackMapEditor
              tracks={tracks}
              sessions={sessions}
              onTrackUpdated={(updated) =>
                setTracks(
                  tracks.map((x) => (x.id === updated.id ? updated : x)),
                )
              }
            />
          </div>
        )}
        {tab === "sessions" && (
          <div className="card">
            <h2>Session history</h2>
            {sessions.length === 0 ? (
              <p className="muted">No sessions uploaded yet.</p>
            ) : (
              sessions.map((x) => (
                <div className="session-row" key={x.id}>
                  <div>
                    <strong>{x.tracks?.name ?? "Track"}</strong>
                    <br />
                    <small>{x.racers?.name ?? "Driver"}</small>
                  </div>
                  <span>{x.session_date}</span>
                  <span>{x.session_type}</span>
                  <span className={`status ${x.status}`}>
                    {x.status}
                    {x.best_lap_sec ? ` · ${x.best_lap_sec.toFixed(3)}s` : ""}
                  </span>
                  {x.setup?.dirty_tire_rule && (
                    <span className={`tire-rule-badge ${x.setup.tire_locked ? "locked" : "armed"}`}>
                      {x.setup.tire_locked ? "DIRTY TIRE LOCKED" : "DIRTY TIRE"}
                      {x.setup.tire_set_id ? ` · ${x.setup.tire_set_id}` : ""}
                    </span>
                  )}
                  {x.recommendations?.[0] && (
                    <small style={{ gridColumn: "1 / -1" }}>
                      <strong>
                        {x.recommendations[0].confidence} confidence:
                      </strong>{" "}
                      {x.recommendations[0].recommendation}
                    </small>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        {tab === "compare" && (
          <div className="card compare-panel">
            <div className="eyebrow">SESSION ANALYSIS</div>
            <h2>Compare laps</h2>
            <p className="muted">Select two processed sessions to compare best lap, average pace, consistency, setup, and conditions.</p>
            <div className="grid-2">
              <div className="field"><label>Baseline session</label><select><option>Select session</option>{sessions.map((x) => <option key={`a-${x.id}`}>{x.session_date} · {x.tracks?.name} · {x.session_type}</option>)}</select></div>
              <div className="field"><label>Comparison session</label><select><option>Select session</option>{sessions.map((x) => <option key={`b-${x.id}`}>{x.session_date} · {x.tracks?.name} · {x.session_type}</option>)}</select></div>
            </div>
            <div className="notice">Detailed overlay comparison will activate when two processed sessions are selected.</div>
          </div>
        )}
        {tab === "profile" && (
          <div className="profile-hub">
            <div className="card"><div className="eyebrow">RIVALI GARAGE</div><h2>Race profile</h2><p className="muted">Manage the drivers, karts, and tracks that feed every session analysis.</p></div>
            <div className="profile-grid">
              <button className="card" onClick={() => setTab("drivers")}><Users /><strong>Drivers</strong><span>{racers.length} saved</span></button>
              <button className="card" onClick={() => setTab("karts")}><Wrench /><strong>Karts</strong><span>{karts.length} saved</span></button>
              <button className="card" onClick={() => setTab("tracks")}><MapPinned /><strong>Tracks</strong><span>{tracks.length} saved</span></button>
              <button className="card" onClick={() => setTab("debrief")}><Mic /><strong>Debriefs</strong><span>Trackside notes</span></button>
            </div>
          </div>
        )}
      </section>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {[["home", "Home", Home], ["sessions", "Sessions", History], ["compare", "Compare", BarChart3], ["profile", "Profile", UserRound]].map(([id, label, Icon]) => {
          const NavIcon = Icon as typeof Home;
          return <button key={id as string} className={tab === id ? "active" : ""} onClick={() => { setTab(id as Tab); setMessage(""); }}><NavIcon /><span>{label as string}</span></button>;
        })}
      </nav>
      <FloatingDoug
        racedayContext={racedayContext}
        onNavigate={(destination) => setTab(destination)}
        onRequestAction={setPendingDougAction}
        attentionKey={pendingDougAction?.summary || message || dougGuidance}
        guidance={dougGuidance}
      />
    </div>
  );
}
