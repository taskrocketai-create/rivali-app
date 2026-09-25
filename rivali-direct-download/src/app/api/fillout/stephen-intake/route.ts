import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Row = { id: string; name: string };
type FieldMap = Record<string, string>;

const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const asText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return asText(object.value ?? object.text ?? object.label ?? object.name ?? "");
  }
  return "";
};

function collectFields(input: unknown, fields: FieldMap, depth = 0) {
  if (depth > 8 || input == null) return;
  if (Array.isArray(input)) {
    input.forEach((item) => collectFields(item, fields, depth + 1));
    return;
  }
  if (typeof input !== "object") return;
  const object = input as Record<string, unknown>;
  const label = asText(object.name ?? object.label ?? object.question ?? object.title ?? object.fieldName);
  const value = asText(object.value ?? object.answer ?? object.response ?? object.text ?? object.answers);
  if (label && value) fields[normalize(label)] = value;
  ["questions", "responses", "fields", "data", "submission", "answers"].forEach((key) => collectFields(object[key], fields, depth + 1));
}

function first(fields: FieldMap, ...aliases: string[]) {
  for (const alias of aliases) {
    const exact = fields[normalize(alias)];
    if (exact) return exact;
  }
  for (const alias of aliases) {
    const match = Object.entries(fields).find(([key]) => key.includes(normalize(alias)) || normalize(alias).includes(key));
    if (match?.[1]) return match[1];
  }
  return "";
}

function matchingRow(rows: Row[], requestedName: string) {
  const wanted = normalize(requestedName);
  return rows.find((row) => normalize(row.name) === wanted) ?? rows.find((row) => normalize(row.name).includes(wanted) || wanted.includes(normalize(row.name)));
}

function sessionType(value: string): "practice" | "hot laps" | "heat" | "feature" {
  const text = normalize(value);
  if (text.includes("feature")) return "feature";
  if (text.includes("heat")) return "heat";
  if (text.includes("hot")) return "hot laps";
  return "practice";
}

function dateValue(value: string) {
  const direct = value.match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
  if (direct) return direct;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function validSecret(actual: string, supplied: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expectedSecret = process.env.FILLOUT_WEBHOOK_SECRET;
  const userId = process.env.FILLOUT_RIVALI_USER_ID;
  if (!expectedSecret || !userId)
    return NextResponse.json({ error: "Fillout intake is not configured on the server." }, { status: 503 });

  const authorization = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const suppliedSecret = request.headers.get("x-rivali-fillout-secret") ?? authorization ?? new URL(request.url).searchParams.get("secret") ?? "";
  if (!validSecret(expectedSecret, suppliedSecret))
    return NextResponse.json({ error: "Unauthorized Fillout intake." }, { status: 401 });

  const payload = await request.json().catch(() => null);
  if (!payload) return NextResponse.json({ error: "Fillout sent an invalid JSON payload." }, { status: 400 });
  const fields: FieldMap = {};
  collectFields(payload, fields);
  const driverName = first(fields, "driver", "driver name", "racer");
  const kartName = first(fields, "kart", "kart name", "chassis");
  const trackName = first(fields, "track", "track name");
  if (!driverName || !kartName || !trackName)
    return NextResponse.json({ error: "The form must include Driver, Kart, and Track fields.", receivedFields: Object.keys(fields) }, { status: 422 });

  const admin = createAdminClient();
  const [racers, karts, tracks] = await Promise.all([
    admin.from("racers").select("id,name").eq("user_id", userId),
    admin.from("karts").select("id,name").eq("user_id", userId),
    admin.from("tracks").select("id,name").eq("user_id", userId),
  ]);
  if (racers.error || karts.error || tracks.error)
    return NextResponse.json({ error: racers.error?.message ?? karts.error?.message ?? tracks.error?.message ?? "Could not load Rivali profiles." }, { status: 500 });
  const racer = matchingRow((racers.data ?? []) as Row[], driverName);
  const kart = matchingRow((karts.data ?? []) as Row[], kartName);
  const track = matchingRow((tracks.data ?? []) as Row[], trackName);
  if (!racer || !kart || !track)
    return NextResponse.json({ error: "Match Stephen's Driver, Kart, and Track names to saved Rivali profiles before submitting.", missing: { driver: !racer, kart: !kart, track: !track } }, { status: 422 });

  const submissionId = asText((payload as Record<string, unknown>).submissionId ?? (payload as Record<string, unknown>).submission_id ?? (payload as Record<string, unknown>).id) || randomUUID();
  const rawStoragePath = `${userId}/fillout-baseline/${submissionId}.pending`;
  const existing = await admin.from("sessions").select("id").eq("raw_storage_path", rawStoragePath).maybeSingle();
  if (existing.data) return NextResponse.json({ ok: true, duplicate: true, sessionId: existing.data.id });
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });

  const baseLap = Number(first(fields, "base lap goal", "base lap time", "target lap", "off the trailer goal")) || 12.3;
  const setup = {
    class_name: first(fields, "class", "racing class") || null,
    base_lap_sec: baseLap,
    tire_set_id: first(fields, "tire set", "tire id") || null,
    fillout_intake: true,
    fillout_submission_id: submissionId,
    telemetry_attached: false,
    fillout_answers: fields,
  };
  const conditions = {
    track_condition: first(fields, "track condition", "track surface") || null,
    air_temp_f: Number(first(fields, "air temperature", "air temp")) || null,
    humidity_pct: Number(first(fields, "humidity")) || null,
    weather_notes: first(fields, "weather", "conditions notes") || null,
  };
  const handlingFeedback = { notes: first(fields, "driver feedback", "handling feedback", "what did the kart do") || null };
  const { data: session, error } = await admin.from("sessions").insert({
    user_id: userId,
    racer_id: racer.id,
    kart_id: kart.id,
    track_id: track.id,
    session_date: dateValue(first(fields, "date", "race date", "session date")),
    session_type: sessionType(first(fields, "session type", "run type")),
    raw_file_name: "Fillout baseline — awaiting MyChron data",
    raw_storage_path: rawStoragePath,
    setup,
    conditions,
    handling_feedback: handlingFeedback,
    status: "queued",
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, sessionId: session.id });
}
