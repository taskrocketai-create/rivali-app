"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { createClient } from "@/lib/supabase/client";
import type { LatLng, RaceSession, Track, TurnMarker } from "@/types/domain";

type Mode = "start" | "1" | "2" | "3" | "4" | null;
type TracePoint = { lat: number; lng: number; time: number };
type SearchResult = { id: string; label: string; latitude: number; longitude: number; type: string };

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
  const [radius, setRadius] = useState(18);
  const radiusRef = useRef(radius);
  const [trace, setTrace] = useState<TracePoint[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState(
    "Select a processed session to load its recorded GPS trace.",
  );
  const supabase = createClient();
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
    }
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
  }, [startFinish, trace, turns, setTurns]);
  useEffect(() => {
    radiusRef.current = radius;
  }, [radius]);
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
    if (track?.latitude != null && track?.longitude != null) mapRef.current?.setView([track.latitude, track.longitude], 17);
    setMessage(
      track?.start_finish
        ? "Loaded the saved layout. Drag or replace any marker."
        : "Load a session, then define the start/finish line and four turn centers.",
    );
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
    if (!trackId) return setMessage("Map centered. Select the saved track above to attach this location to it.");
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
    if (startFinish.length !== 2 || Object.keys(turns).length !== 4)
      return setMessage("Set two start/finish points and all four turns.");
    const normalized = Object.fromEntries(
      Object.entries(turns).map(([key, value]) => [
        key,
        { ...value, radius_m: radius },
      ]),
    );
    const { data, error } = await supabase
      .from("tracks")
      .update({ start_finish: startFinish, turns: normalized })
      .eq("id", trackId)
      .select("id,name,location,surface_type,latitude,longitude,start_finish,turns")
      .single();
    if (error) return setMessage(error.message);
    onTrackUpdated(data as Track);
    setTurns(normalized);
    setMessage("Track layout saved for future sessions.");
  }
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
      <div ref={container} className="map" />
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
      <div className="grid-2">
        <div className="field">
          <label>Turn-zone radius (meters)</label>
          <input
            type="number"
            min="3"
            max="100"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </div>
        <button className="button" type="button" onClick={save}>
          Save track layout
        </button>
      </div>
    </div>
  );
}
