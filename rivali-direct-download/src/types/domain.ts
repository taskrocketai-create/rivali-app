export type Racer = {
  id: string;
  name: string;
  experience_level: string | null;
  driver_weight_lb: number | null;
};
export type Kart = {
  id: string;
  racer_id: string;
  name: string;
  chassis_make: string | null;
  chassis_model: string | null;
  tire_compound: string | null;
};
export type LatLng = { lat: number; lng: number };
export type TurnMarker = LatLng & { radius_m: number };
export type Track = {
  id: string;
  name: string;
  location: string | null;
  surface_type: string | null;
  latitude: number | null;
  longitude: number | null;
  start_finish: LatLng[] | null;
  turns: Record<string, TurnMarker> | null;
};
export type RaceSession = {
  id: string;
  session_date: string;
  session_type: string;
  status: string;
  best_lap_sec: number | null;
  average_lap_sec: number | null;
  consistency_stdev_sec: number | null;
  lap_count: number | null;
  setup: {
    class_name?: string | null;
    tire_set_id?: string | null;
    dirty_tire_rule?: boolean;
    dirty_tire_cutoff?: string | null;
    tire_locked?: boolean;
    [key: string]: unknown;
  };
  conditions: Record<string, string | number | null>;
  raw_file_name: string;
  tracks: { name: string } | null;
  racers: { name: string } | null;
  karts: { name: string } | null;
  recommendations?: { recommendation: string; confidence: string }[];
};
export type VoiceDebrief = {
  id: string;
  session_id: string;
  status: string;
  transcript: string | null;
  error: string | null;
  created_at: string;
};
export type KnowledgeItem = {
  id: string;
  title: string;
  body: string;
  source_type: string;
  source_name: string | null;
  source_url: string | null;
  evidence_level: string;
  confidence: string;
  status: string;
  track_id: string | null;
  kart_id: string | null;
  tags: string[];
  updated_at: string;
};
export type KnowledgeUploadJob = {
  id: string;
  original_filename: string;
  status: "queued" | "uploading" | "transcribing" | "extracting" | "completed" | "failed";
  knowledge_points_added: number;
  error: string | null;
  source_platform: string | null;
  created_at: string;
};
