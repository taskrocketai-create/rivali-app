"use client";
import { useState, type FormEvent } from "react";
import {
  Upload,
  Users,
  Wrench,
  MapPinned,
  History,
  BookOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  Kart,
  KnowledgeItem,
  Racer,
  RaceSession,
  Track,
} from "@/types/domain";
import { TrackMapEditor } from "./track-map-editor";

type Tab = "upload" | "drivers" | "karts" | "tracks" | "knowledge" | "sessions";
const tabItems: [Tab, string, typeof Upload][] = [
  ["upload", "Upload session", Upload],
  ["drivers", "Drivers", Users],
  ["karts", "Karts", Wrench],
  ["tracks", "GPS track map", MapPinned],
  ["knowledge", "Knowledge base", BookOpen],
  ["sessions", "Session history", History],
];

export function DashboardClient({
  racers: initialRacers,
  karts: initialKarts,
  tracks: initialTracks,
  sessions: initialSessions,
  knowledge: initialKnowledge,
}: {
  racers: Racer[];
  karts: Kart[];
  tracks: Track[];
  sessions: RaceSession[];
  knowledge: KnowledgeItem[];
}) {
  const [tab, setTab] = useState<Tab>("upload");
  const [racers, setRacers] = useState(initialRacers);
  const [karts, setKarts] = useState(initialKarts);
  const [tracks, setTracks] = useState(initialTracks);
  const [sessions, setSessions] = useState(initialSessions);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const supabase = createClient();
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
        .select("id,name,location,surface_type,start_finish,turns")
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
  async function uploadSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const file = form.get("file") as File;
    let uploadedPath = "";
    let createdSessionId = "";
    try {
      if (!file?.name.toLowerCase().endsWith(".xrk"))
        throw new Error("Choose a MyChron .xrk file.");
      if (file.size > 100 * 1024 * 1024)
        throw new Error("The maximum file size is 100 MB.");
      const user_id = await ownerId();
      const id = crypto.randomUUID();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      uploadedPath = `${user_id}/${id}/${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("telemetry")
        .upload(uploadedPath, file, {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw uploadError;
      const setup = {
        lf_pressure_psi: Number(form.get("lf_pressure_psi")) || null,
        rf_pressure_psi: Number(form.get("rf_pressure_psi")) || null,
        lr_pressure_psi: Number(form.get("lr_pressure_psi")) || null,
        rr_pressure_psi: Number(form.get("rr_pressure_psi")) || null,
        rear_sprocket: Number(form.get("rear_sprocket")) || null,
        notes: form.get("setup_notes") || null,
      };
      const conditions = {
        air_temp_f: Number(form.get("air_temp_f")) || null,
        humidity_pct: Number(form.get("humidity_pct")) || null,
        track_condition: form.get("track_condition") || null,
        weather_notes: form.get("weather_notes") || null,
      };
      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .insert({
          id,
          user_id,
          racer_id: form.get("racer_id"),
          kart_id: form.get("kart_id"),
          track_id: form.get("track_id"),
          session_date: form.get("session_date"),
          session_type: form.get("session_type"),
          raw_file_name: file.name,
          raw_storage_path: uploadedPath,
          setup,
          conditions,
          status: "queued",
        })
        .select(
          "id,session_date,session_type,status,best_lap_sec,raw_file_name,tracks(name),racers(name),recommendations(recommendation,confidence)",
        )
        .single();
      if (sessionError) throw sessionError;
      createdSessionId = id;
      const { error: jobError } = await supabase
        .from("processing_jobs")
        .insert({ user_id, session_id: id, status: "queued" });
      if (jobError) throw jobError;
      setSessions([session as unknown as RaceSession, ...sessions]);
      event.currentTarget.reset();
      setMessage("Session uploaded and queued for analysis.");
    } catch (error) {
      if (createdSessionId)
        await supabase.from("sessions").delete().eq("id", createdSessionId);
      if (uploadedPath)
        await supabase.storage.from("telemetry").remove([uploadedPath]);
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }
  async function addKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get("source_file") as File;
    let sourceFilePath: string | null = null;
    try {
      const user_id = await ownerId();
      if (file?.size) {
        if (file.size > 25 * 1024 * 1024)
          throw new Error("Knowledge files must be 25 MB or smaller.");
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        sourceFilePath = `${user_id}/${crypto.randomUUID()}/${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from("knowledge")
          .upload(sourceFilePath, file, { upsert: false });
        if (uploadError) throw uploadError;
      }
      const { data, error } = await supabase
        .from("knowledge_items")
        .insert({
          user_id,
          title: form.get("title"),
          body: form.get("body"),
          source_type: form.get("source_type"),
          source_name: form.get("source_name") || null,
          source_url: form.get("source_url") || null,
          source_file_path: sourceFilePath,
          evidence_level: form.get("evidence_level"),
          confidence: form.get("confidence"),
          status: form.get("status"),
          track_id: form.get("track_id") || null,
          kart_id: form.get("kart_id") || null,
          class_name: form.get("class_name") || null,
          tire_compound: form.get("tire_compound") || null,
          tags: String(form.get("tags") || "")
            .split(",")
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
          effective_date: form.get("effective_date") || null,
        })
        .select(
          "id,title,body,source_type,source_name,source_url,evidence_level,confidence,status,track_id,kart_id,tags,updated_at",
        )
        .single();
      if (error) throw error;
      setKnowledge([data as KnowledgeItem, ...knowledge]);
      formElement.reset();
      setMessage("Knowledge item saved with its source and evidence rating.");
    } catch (error) {
      if (sourceFilePath)
        await supabase.storage.from("knowledge").remove([sourceFilePath]);
      setMessage(
        error instanceof Error ? error.message : "Could not save knowledge.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function archiveKnowledge(id: string) {
    const { error } = await supabase
      .from("knowledge_items")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return setMessage(error.message);
    setKnowledge(
      knowledge.map((item) =>
        item.id === id ? { ...item, status: "archived" } : item,
      ),
    );
    setMessage("Knowledge item archived. Its provenance remains preserved.");
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
            <Icon size={17} /> {label}
          </button>
        ))}
      </aside>
      <section className="panel">
        {message && <div className="notice">{message}</div>}
        {tab === "upload" && (
          <form className="card stack" onSubmit={uploadSession}>
            <h2>Upload a MyChron session</h2>
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
                <label>Kart</label>
                <select name="kart_id" required>
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
                <select name="track_id" required>
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
                />
              </div>
              <div className="field">
                <label>Session type</label>
                <select name="session_type">
                  <option>practice</option>
                  <option>hot laps</option>
                  <option>heat</option>
                  <option>feature</option>
                </select>
              </div>
              <div className="field">
                <label>.xrk file</label>
                <input name="file" type="file" accept=".xrk" required />
              </div>
            </div>
            <h3>Conditions</h3>
            <div className="grid-3">
              <div className="field">
                <label>Air temp °F</label>
                <input name="air_temp_f" type="number" step=".1" />
              </div>
              <div className="field">
                <label>Humidity %</label>
                <input
                  name="humidity_pct"
                  type="number"
                  min="0"
                  max="100"
                  step=".1"
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
              />
            </div>
            <h3>Current setup</h3>
            <div className="grid-3">
              <div className="field">
                <label>LF pressure</label>
                <input name="lf_pressure_psi" type="number" step=".1" />
              </div>
              <div className="field">
                <label>RF pressure</label>
                <input name="rf_pressure_psi" type="number" step=".1" />
              </div>
              <div className="field">
                <label>LR pressure</label>
                <input name="lr_pressure_psi" type="number" step=".1" />
              </div>
              <div className="field">
                <label>RR pressure</label>
                <input name="rr_pressure_psi" type="number" step=".1" />
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
        {tab === "knowledge" && (
          <div className="stack">
            <form className="card" onSubmit={addKnowledge}>
              <h2>Feed the knowledge base</h2>
              <p className="muted">
                Save the claim and its source separately. Mark disputed or
                unproven information honestly so Rivali never presents opinion
                as settled science.
              </p>
              <div className="grid-2">
                <div className="field">
                  <label>Title</label>
                  <input
                    name="title"
                    required
                    minLength={3}
                    placeholder="Low-humidity clay transition"
                  />
                </div>
                <div className="field">
                  <label>Source type</label>
                  <select name="source_type" defaultValue="manual">
                    <option value="manual">Manual entry</option>
                    <option value="manufacturer_manual">
                      Manufacturer manual
                    </option>
                    <option value="book">Book</option>
                    <option value="article">Article</option>
                    <option value="video">Video / transcript</option>
                    <option value="podcast">Podcast</option>
                    <option value="race_observation">Race observation</option>
                    <option value="test_result">Measured test result</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Knowledge, rule, or observation</label>
                <textarea
                  name="body"
                  rows={5}
                  minLength={10}
                  required
                  placeholder="State exactly what was learned, including limits and exceptions."
                />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Source name</label>
                  <input
                    name="source_name"
                    placeholder="Author, racer, manual..."
                  />
                </div>
                <div className="field">
                  <label>Source URL</label>
                  <input name="source_url" type="url" />
                </div>
                <div className="field">
                  <label>Source file</label>
                  <input
                    name="source_file"
                    type="file"
                    accept=".pdf,.txt,.md,.csv,.docx"
                  />
                </div>
              </div>
              <div className="grid-3">
                <div className="field">
                  <label>Evidence level</label>
                  <select name="evidence_level" defaultValue="anecdotal">
                    <option value="opinion">Opinion</option>
                    <option value="anecdotal">Anecdotal experience</option>
                    <option value="manufacturer">Manufacturer guidance</option>
                    <option value="measured">Measured observation</option>
                    <option value="controlled_test">Controlled test</option>
                  </select>
                </div>
                <div className="field">
                  <label>Confidence</label>
                  <select name="confidence" defaultValue="medium">
                    <option>low</option>
                    <option>medium</option>
                    <option>high</option>
                  </select>
                </div>
                <div className="field">
                  <label>Status</label>
                  <select name="status" defaultValue="draft">
                    <option>draft</option>
                    <option>active</option>
                    <option>disputed</option>
                  </select>
                </div>
              </div>
              <h3>Where it applies</h3>
              <div className="grid-3">
                <div className="field">
                  <label>Track</label>
                  <select name="track_id">
                    <option value="">All tracks</option>
                    {tracks.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Kart / chassis</label>
                  <select name="kart_id">
                    <option value="">All karts</option>
                    {karts.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Class</label>
                  <input name="class_name" placeholder="All classes" />
                </div>
                <div className="field">
                  <label>Tire compound</label>
                  <input name="tire_compound" placeholder="All compounds" />
                </div>
                <div className="field">
                  <label>Tags</label>
                  <input name="tags" placeholder="clay, stagger, loose-exit" />
                </div>
                <div className="field">
                  <label>Effective date</label>
                  <input name="effective_date" type="date" />
                </div>
              </div>
              <button className="button" disabled={busy}>
                {busy ? "Saving..." : "Add knowledge"}
              </button>
            </form>
            <div className="card">
              <h2>Stored knowledge</h2>
              {knowledge.length === 0 ? (
                <p className="muted">No knowledge items yet.</p>
              ) : (
                knowledge.map((item) => (
                  <article
                    key={item.id}
                    style={{
                      borderBottom: "1px solid var(--line)",
                      padding: "16px 0",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 16,
                      }}
                    >
                      <div>
                        <strong>{item.title}</strong>
                        <div className={`status ${item.status}`}>
                          {item.status} · {item.evidence_level} ·{" "}
                          {item.confidence} confidence
                        </div>
                      </div>
                      {item.status !== "archived" && (
                        <button
                          type="button"
                          className="button ghost small"
                          onClick={() => archiveKnowledge(item.id)}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                    <p>{item.body}</p>
                    {item.tags.length > 0 && (
                      <small className="muted">
                        Tags: {item.tags.join(", ")}
                      </small>
                    )}
                  </article>
                ))
              )}
            </div>
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
      </section>
    </div>
  );
}
