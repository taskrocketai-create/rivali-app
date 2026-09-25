"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { createClient } from "@/lib/supabase/client";
import type { LatLng, RaceSession, Track, TurnMarker } from "@/types/domain";

type Mode = "start" | "1" | "2" | "3" | "4" | "groove" | null;
type TracePoint = { lat: number; lng: number; time: number; speed_mph?: number };
type GeoPoint = { lat: number; lng: number; accuracy_ft: number; captured_at: string };
type WalkLayout = { points: Record<string, GeoPoint>; saved_at?: string };
type SearchResult = { id: string; label: string; latitude: number; longitude: number; type: string };
const CORE_WALK_STEPS = [
  { key: "start_finish_a", label: "Start / finish · first point" },
  { key: "start_finish_b", label: "Start / finish · second point" },
  { key: "turn_1_apex", label: "Turn 1 · apex" },
  { key: "turn_2_apex", label: "Turn 2 · apex" },
  { key: "turn_3_apex", label: "Turn 3 · apex" },
  { key: "turn_4_apex", label: "Turn 4 · apex" },
];
const FEET_PER_METER = 3.28084;
const feetToMeters = (feet: number) => feet / FEET_PER_METER;
const metersToFeet = (meters: number) => Math.round(meters * FEET_PER_METER);
const distanceFeet = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const latitudeFeet = (a.lat - b.lat) * 364000;
  const longitudeFeet = (a.lng - b.lng) * 364000 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot(latitudeFeet, longitudeFeet);
};

export function TrackMapEditor({
  tracks,
  sessions,
  onTrackUpdated,
}: {
  tracks: Track[];
  sessions: RaceSession[];
  onTrackUpdated: (track: Track) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const leafletRef = useRef<typeof Leaflet | null>(null);
  const layers = useRef<Leaflet.Layer[]>([]);
  const searchMarker = useRef<Leaflet.Marker | null>(null);
  const [trackId, setTrackId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [startFinish, setStartFinish] = useState<LatLng[]>([]);
  const [turns, setTurns] = useState<Record<string, TurnMarker>>({});
  const [radiusFeet, setRadiusFeet] = useState(60);
  const radiusRef = useRef(feetToMeters(radiusFeet));
  const [trace, setTrace] = useState<TracePoint[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [walk, setWalk] = useState<WalkLayout>({ points: {} });
  const [walkStep, setWalkStep] = useState("");
  const [groove, setGroove] = useState<GeoPoint[]>([]);
  const [captureMode, setCaptureMode] = useState<"walk" | "groove" | null>(null);
  const [latestFixes, setLatestFixes] = useState<GeoPoint[]>([]);
  const watchRef = useRef<number | null>(null);
  const [message, setMessage] = useState(
    "Select a processed session to load its recorded GPS trace.",
  );
  const supabase = createClient();
  const grooveInsight = useMemo(() => {
    const speedSamples = trace.filter((point) => typeof point.speed_mph === "number" && Number.isFinite(point.speed_mph));
    if (!speedSamples.length) return null;
    const slowest = [...speedSamples].sort((a, b) => (a.speed_mph ?? Infinity) - (b.speed_mph ?? Infinity)).slice(0, 4);
    const offGroove = groove.length > 1
      ? speedSamples.map((point) => ({ point, distance: Math.min(...groove.map((reference) => distanceFeet(point, reference))) })).filter((item) => item.distance > 35)
      : [];
    return { slowest, offGroove, sampleCount: speedSamples.length };
  }, [groove, trace]);
  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
  }, []);
  const drawLayout = useCallback(() => {
    const L = leafletRef.current,
      map = mapRef.current;
    if (!L || !map) return;
    layers.current.forEach((layer) => map.removeLayer(layer));
    layers.current = [];
    if (trace.length) {
      const line = L.polyline(
        trace.map((x) => [x.lat, x.lng]),
        { color: "#e03426", weight: 3, opacity: 0.9 },
      ).addTo(map);
      layers.current.push(line);
      map.fitBounds(line.getBounds(), { padding: [20, 20] });
      const slowest = trace.filter((point) => typeof point.speed_mph === "number").sort((a, b) => (a.speed_mph ?? Infinity) - (b.speed_mph ?? Infinity)).slice(0, 4);
      slowest.forEach((point, index) => {
        const marker = L.circleMarker([point.lat, point.lng], { radius: 6, color: "#f59e0b", weight: 2, fillColor: "#111", fillOpacity: 0.9 })
          .bindTooltip(`Speed dip ${index + 1}: ${point.speed_mph?.toFixed(1)} mph`, { permanent: false })
          .addTo(map);
        layers.current.push(marker);
      });
    }
    if (groove.length > 1) {
      const line = L.polyline(groove.map((x) => [x.lat, x.lng]), { color: "#22c55e", weight: 4, opacity: 0.9, dashArray: "6 5" }).addTo(map);
      layers.current.push(line);
    }
    Object.entries(walk.points).forEach(([label, point]) => {
      const marker = L.circleMarker([point.lat, point.lng], { radius: 5, color: "#22c55e", fillOpacity: 1 }).addTo(map).bindTooltip(label.replaceAll("_", " "), { permanent: false });
      layers.current.push(marker);
    });
    if (startFinish.length === 2) {
      const line = L.polyline(
        startFinish.map((x) => [x.lat, x.lng]),
        { color: "#ffd43b", weight: 5 },
      ).addTo(map);
      layers.current.push(line);
    }
    Object.entries(turns).forEach(([number, point]) => {
      const marker = L.marker([point.lat, point.lng], {
        draggable: true,
        icon: L.divIcon({
          className: "",
          html: `<div style="width:28px;height:28px;border-radius:50%;background:#a72a20;color:white;border:2px solid white;display:grid;place-items:center;font-weight:900">${number}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).addTo(map);
      marker.on("dragend", () => {
        const next = marker.getLatLng();
        setTurns((current) => ({
          ...current,
          [number]: { lat: next.lat, lng: next.lng, radius_m: point.radius_m },
        }));
      });
      const circle = L.circle([point.lat, point.lng], {
        radius: point.radius_m,
        color: "#f2eadb",
        weight: 1,
        fillOpacity: 0.08,
      }).addTo(map);
      layers.current.push(marker, circle);
    });
  }, [startFinish, trace, turns, groove, walk, setTurns]);
  useEffect(() => {
    radiusRef.current = feetToMeters(radiusFeet);
  }, [radiusFeet]);
  useEffect(() => {
    let active = true;
    (async () => {
      if (!container.current || mapRef.current) return;
      const L = await import("leaflet");
      if (!active || !container.current) return;
      leafletRef.current = L;
      const map = L.map(container.current).setView([35.72, -77.91], 8);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 20, attribution: "Imagery © Esri and contributors" },
      ).addTo(map);
      map.on("click", (event) => {
        setMode((current) => {
          if (!current) return current;
          const point = { lat: event.latlng.lat, lng: event.latlng.lng };
          if (current === "groove") {
            setGroove((previous) => [...previous, { ...point, accuracy_ft: 0, captured_at: new Date().toISOString() }]);
            return current;
          }
          if (current === "start") {
            setStartFinish((previous) =>
              previous.length >= 1 ? [previous[0], point] : [point],
            );
          } else
            setTurns((previous) => ({
              ...previous,
              [current]: { ...point, radius_m: radiusRef.current },
            }));
          return current === "start" ? current : null;
        });
      });
      mapRef.current = map;
      setMapReady(true);
    })();
    return () => {
      active = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (mapReady) drawLayout();
  }, [drawLayout, mapReady]);
  async function loadTrace() {
    if (!sessionId) return setMessage("Choose a processed session.");
    setMessage("Loading GPS trace...");
    const { data, error } = await supabase
      .from("session_telemetry")
      .select("gps_trace")
      .eq("session_id", sessionId)
      .single();
    if (error) return setMessage(error.message);
    const trace = (data?.gps_trace ?? []) as TracePoint[];
    if (!trace.length)
      return setMessage(
        "That session has no GPS trace yet. Wait for processing or use another file.",
      );
    setTrace(trace);
    setMessage(`Loaded ${trace.length} GPS points.`);
  }
  function chooseTrack(id: string) {
    setTrackId(id);
    const track = tracks.find((x) => x.id === id);
    const sf = track?.start_finish ?? [];
    const markers = track?.turns ?? {};
    setStartFinish(sf);
    setTurns(markers);
    const metadata = (markers as Record<string, unknown>)._rivali as { walk?: WalkLayout; groove?: GeoPoint[] } | undefined;
    setWalk(metadata?.walk ?? { points: {} });
    setGroove(metadata?.groove ?? []);
    const savedRadius = Object.values(markers)[0]?.radius_m;
    if (savedRadius) setRadiusFeet(metersToFeet(savedRadius));
    if (track?.latitude != null && track?.longitude != null) mapRef.current?.setView([track.latitude, track.longitude], 17);
    setMessage(
      track?.start_finish
        ? "Loaded the saved layout. Drag or replace any marker."
        : "Load a session, then define the start/finish line and four turn centers.",
    );
  }
  function stopCapture() {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    setCaptureMode(null);
  }
  function startCapture(next: "walk" | "groove") {
    if (!trackId) return setMessage("Choose the track before starting GPS capture.");
    if (!navigator.geolocation) return setMessage("Location is not supported by this device.");
    stopCapture();
    setCaptureMode(next);
    if (next === "walk") {
      const firstMissing = CORE_WALK_STEPS.find((step) => !walk.points[step.key]);
      setWalkStep(firstMissing?.key ?? CORE_WALK_STEPS[0].key);
    }
    setMessage(next === "walk" ? "GPS walk running. Move to a point, wait for accuracy to settle, then mark it." : "Groove capture running. Make one smooth, slow pass on the preferred line, then stop capture.");
    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point: GeoPoint = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy_ft: Math.round(position.coords.accuracy * FEET_PER_METER), captured_at: new Date(position.timestamp).toISOString() };
        setLatestFixes((current) => [...current.slice(-7), point]);
        if (next === "groove") setGroove((current) => [...current, point].slice(-600));
      },
      (error) => { stopCapture(); setMessage(error.code === 1 ? "Location permission was denied." : "GPS capture stopped because the phone could not get a location."); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  function markWalkPoint() {
    if (!walkStep) return setMessage("Choose the point you are marking first.");
    if (!latestFixes.length) return setMessage("Wait for a GPS reading before marking this point.");
    const sample = latestFixes.slice(-5);
    const point: GeoPoint = {
      lat: sample.reduce((sum, item) => sum + item.lat, 0) / sample.length,
      lng: sample.reduce((sum, item) => sum + item.lng, 0) / sample.length,
      accuracy_ft: Math.round(sample.reduce((sum, item) => sum + item.accuracy_ft, 0) / sample.length),
      captured_at: new Date().toISOString(),
    };
    const currentStep = CORE_WALK_STEPS.find((step) => step.key === walkStep);
    const nextStep = CORE_WALK_STEPS.find((step) => step.key !== walkStep && !walk.points[step.key]);
    setWalk((current) => ({ ...current, points: { ...current.points, [walkStep]: point } }));
    setWalkStep(nextStep?.key ?? "");
    const accuracyNote = point.accuracy_ft > 30 ? ` Accuracy is about ${point.accuracy_ft} ft—re-mark it if you can get into clearer sky.` : ` Accuracy is about ${point.accuracy_ft} ft.`;
    setMessage(nextStep ? `${currentStep?.label ?? "Point"} saved.${accuracyNote} Next: ${nextStep.label}.` : `Core track walk complete.${accuracyNote} Tap Save track layout below.`);
  }
  async function searchTracks() {
    if (searchQuery.trim().length < 3) return setMessage("Enter at least three characters to search.");
    setSearching(true);
    setMessage("Searching for the track...");
    try {
      const response = await fetch(`/api/track-search?q=${encodeURIComponent(searchQuery.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Track search failed.");
      setSearchResults(payload.results ?? []);
      setMessage(payload.results?.length ? "Choose the correct result to center the satellite map." : "No matches found. Try the track name plus city and state.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Track search failed.");
    } finally { setSearching(false); }
  }
  async function chooseSearchResult(result: SearchResult) {
    const map = mapRef.current, L = leafletRef.current;
    if (map && L) {
      map.setView([result.latitude, result.longitude], 18);
      searchMarker.current?.remove();
      searchMarker.current = L.marker([result.latitude, result.longitude]).addTo(map).bindPopup(result.label).openPopup();
    }
    setSearchResults([]);
    if (!trackId) {
      const existing = tracks.find((track) =>
        [track.name, track.location].filter(Boolean).some((value) => value!.toLowerCase().includes(result.label.split(",")[0].toLowerCase())),
      );
      if (existing) {
        chooseTrack(existing.id);
        setMessage("That saved track is now selected on the map.");
        return;
      }
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      const userId = claimsData?.claims?.sub;
      if (claimsError || !userId) return setMessage("Sign in again before saving this track.");
      const name = result.label.split(",")[0].trim() || "Saved track";
      const { data, error } = await supabase.from("tracks").insert({
        user_id: userId,
        name,
        location: result.label,
        surface_type: "dirt",
        latitude: result.latitude,
        longitude: result.longitude,
      }).select("id,name,location,surface_type,latitude,longitude,start_finish,turns").single();
      if (error) return setMessage(error.message);
      const created = data as Track;
      setTrackId(created.id);
      setStartFinish([]);
      setTurns({});
      setWalk({ points: {} });
      setGroove([]);
      onTrackUpdated(created);
      return setMessage(`${created.name} was added and selected. Draw the preferred groove right on the satellite image, then save it.`);
    }
    const { data, error } = await supabase.from("tracks").update({ location: result.label, latitude: result.latitude, longitude: result.longitude }).eq("id", trackId).select("id,name,location,surface_type,latitude,longitude,start_finish,turns").single();
    if (error) return setMessage(error.message);
    onTrackUpdated(data as Track);
    setMessage("Track location saved. Session weather can now use these coordinates.");
  }
  function useCurrentLocation() {
    if (!navigator.geolocation) return setMessage("Location is not supported by this device.");
    setSearching(true);
    setMessage("Locating you at the track...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const result: SearchResult = {
          id: "device-location",
          label: "Current trackside location",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          type: "device",
        };
        void chooseSearchResult(result).finally(() => setSearching(false));
      },
      (error) => {
        setSearching(false);
        setMessage(error.code === 1 ? "Location permission was denied. Search by track name instead." : "Could not determine your location. Try track search instead.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }
  async function save() {
    if (!trackId) return setMessage("Choose a track first.");
    const numericTurns = Object.fromEntries(Object.entries(turns).filter(([key]) => ["1", "2", "3", "4"].includes(key))) as Record<string, TurnMarker>;
    const walkStartFinish = ["start_finish_a", "start_finish_b"].map((key) => walk.points[key]).filter(Boolean).map((point) => ({ lat: point.lat, lng: point.lng }));
    const walkedTurns = Object.fromEntries([1, 2, 3, 4].map((turn) => {
      const apex = walk.points[`turn_${turn}_apex`];
      return apex ? [String(turn), { lat: apex.lat, lng: apex.lng, radius_m: feetToMeters(radiusFeet) }] : [];
    }).filter((entry) => entry.length)) as Record<string, TurnMarker>;
    const finalStartFinish = walkStartFinish.length === 2 ? walkStartFinish : startFinish;
    const finalTurns = Object.keys(walkedTurns).length === 4 ? walkedTurns : numericTurns;
    const hasLayout = finalStartFinish.length === 2 && Object.keys(finalTurns).length === 4;
    if (!hasLayout && groove.length < 2)
      return setMessage("Draw at least two preferred-groove points, or set the complete start/finish and turn layout.");
    const normalized = Object.fromEntries(
      Object.entries(finalTurns).map(([key, value]) => [
        key,
        { ...value, radius_m: feetToMeters(radiusFeet) },
      ]),
    );
    const storedTurns = { ...normalized, _rivali: { walk: { ...walk, saved_at: new Date().toISOString() }, groove } };
    const { data, error } = await supabase
      .from("tracks")
      .update({ start_finish: hasLayout ? finalStartFinish : startFinish, turns: storedTurns })
      .eq("id", trackId)
      .select("id,name,location,surface_type,latitude,longitude,start_finish,turns")
      .single();
    if (error) return setMessage(error.message);
    onTrackUpdated(data as Track);
    if (hasLayout) setStartFinish(finalStartFinish);
    setTurns(normalized);
    setMessage(hasLayout ? "Track layout and preferred groove saved for future sessions." : "Preferred groove saved for future sessions.");
  }
  const completedCoreSteps = CORE_WALK_STEPS.filter((step) => walk.points[step.key]).length;
  const currentWalkLabel = CORE_WALK_STEPS.find((step) => step.key === walkStep)?.label;
  return (
    <div className="card">
      <h2>Satellite GPS layout</h2>
      <p className="muted">
        Use MyChron GPS data as the racing line. Draw the start/finish line
        across the track, then place the center of Turns 1–4.
      </p>
      <div className="field">
        <label>Find a track on the satellite map</label>
        <div className="search-row">
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchTracks(); } }} placeholder="Track name, city, and state" />
          <button className="button small" type="button" disabled={searching} onClick={searchTracks}>{searching ? "Working..." : "Search"}</button>
          <button className="button small secondary" type="button" disabled={searching} onClick={useCurrentLocation}>Use my location</button>
        </div>
        {searchResults.length > 0 && <div className="search-results">{searchResults.map((result) => <button key={result.id} type="button" onClick={() => chooseSearchResult(result)}><strong>{result.label.split(",")[0]}</strong><span>{result.label}</span></button>)}</div>}
      </div>
      <div className="grid-2">
        <div className="field">
          <label>Track</label>
          <select value={trackId} onChange={(e) => chooseTrack(e.target.value)}>
            <option value="">Select track</option>
            {tracks.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Processed session</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            >
              <option value="">Select session</option>
              {sessions
                .filter((x) => x.status === "completed")
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.session_date} · {x.tracks?.name}
                  </option>
                ))}
            </select>
            <button className="button small" type="button" onClick={loadTrace}>
              Load
            </button>
          </div>
        </div>
      </div>
      <div className="notice">{message}</div>
      {grooveInsight && (
        <div className="notice">
          <strong>Speed / groove check</strong><br />
          Lowest sampled speed: {grooveInsight.slowest.map((point) => `${point.speed_mph?.toFixed(1)} mph`).join(", ")}. Orange points on the map mark those dips.
          {groove.length > 1 && <> {grooveInsight.offGroove.length} of {grooveInsight.sampleCount} GPS samples were more than 35 ft from the saved preferred groove.</>}
        </div>
      )}
      <div ref={container} className="map" />
      <div className="gps-capture">
        <div>
          <strong>Phone track walk</strong>
          <p>Choose the track, start the walk, then walk to each spot and tap one big button. Rivali saves the core layout in six quick stops.</p>
        </div>
        <div className="gps-capture-actions">
          <button type="button" className={captureMode === "walk" ? "active" : ""} onClick={() => startCapture("walk")}>{completedCoreSteps ? "Continue track walk" : "Start track walk"}</button>
          <button type="button" onClick={stopCapture} disabled={captureMode !== "walk"}>Pause walk</button>
          <button type="button" onClick={() => { setWalk({ points: {} }); setWalkStep(""); }} disabled={!completedCoreSteps}>Start over</button>
        </div>
        <div className="walk-next-step">
          <div><small>NEXT STOP</small><strong>{currentWalkLabel ?? (completedCoreSteps === CORE_WALK_STEPS.length ? "Core track walk complete" : "Start the walk")}</strong><span>{completedCoreSteps} of {CORE_WALK_STEPS.length} saved</span></div>
          <button type="button" className="button primary" onClick={markWalkPoint} disabled={captureMode !== "walk" || !walkStep}>{currentWalkLabel ? `Mark: ${currentWalkLabel}` : "Walk complete"}</button>
        </div>
        <div className="walk-progress">{CORE_WALK_STEPS.map((step, index) => <span key={step.key} className={walk.points[step.key] ? "complete" : step.key === walkStep ? "current" : ""}>{index + 1}</span>)}</div>
        <small className="muted">If a point reports more than about 30 ft accuracy, use Start over or correct it later on the map.</small>
      </div>
      <div className="gps-capture">
        <div>
          <strong>Preferred groove</strong>
          <p>On desktop, click along the preferred line directly on the satellite image. The green dashed line is what Rivali will use later to compare where the kart slows. A phone GPS pass is optional.</p>
        </div>
        <div className="gps-capture-actions">
          <button type="button" className={mode === "groove" ? "active" : ""} onClick={() => { if (!trackId) return setMessage("Find or select the track first."); setMode("groove"); setMessage("Click along the preferred groove on the satellite image. Click Finish drawing when the line is complete."); }}>{mode === "groove" ? "Drawing on map" : "Draw on satellite map"}</button>
          <button type="button" onClick={() => { setMode(null); setMessage("Preferred groove drawing finished. Save it when it looks right."); }} disabled={mode !== "groove"}>Finish drawing</button>
          <button type="button" className={captureMode === "groove" ? "active" : ""} onClick={() => { setGroove([]); startCapture("groove"); }}>{captureMode === "groove" ? "Groove pass running" : "Start groove pass"}</button>
          <button type="button" onClick={stopCapture} disabled={captureMode !== "groove"}>Finish & preview groove</button>
          <button type="button" onClick={() => setGroove([])} disabled={!groove.length}>Clear groove</button>
        </div>
        <small className="muted">{groove.length} GPS points in the current groove pass. Phone GPS can drift 10 to 30 feet; use the satellite map to review it before saving.</small>
      </div>
      <details className="manual-map-tools">
        <summary>Manual map corrections (optional)</summary>
        <p className="muted">Use these only if GPS was poor or you want to fine-tune the saved layout on the satellite map.</p>
      <div className="map-controls">
        <button
          className={mode === "start" ? "active" : ""}
          onClick={() => {
            setStartFinish([]);
            setMode("start");
            setMessage(
              "Tap two points across the track. The second tap completes the line.",
            );
          }}
        >
          Start / finish
        </button>
        {[1, 2, 3, 4].map((number) => (
          <button
            key={number}
            className={mode === String(number) ? "active" : ""}
            onClick={() => {
              setMode(String(number) as Mode);
              setMessage(`Tap the center of Turn ${number}.`);
            }}
          >
            Turn {number}
          </button>
        ))}
        <button
          onClick={() => {
            setStartFinish([]);
            setTurns({});
            setMode(null);
          }}
        >
          Clear markers
        </button>
      </div>
      </details>
      <div className="grid-2">
        <div className="field">
          <label>Turn-zone radius (feet)</label>
          <input
            type="number"
            min="10"
            max="300"
            step="5"
            value={radiusFeet}
            onChange={(e) => setRadiusFeet(Number(e.target.value))}
          />
          <small className="muted">Start near 60 ft. Increase it until the circle covers the full corner without reaching the straightaways.</small>
        </div>
        <button className="button" type="button" onClick={save}>
          Save groove / layout
        </button>
      </div>
    </div>
  );
}
