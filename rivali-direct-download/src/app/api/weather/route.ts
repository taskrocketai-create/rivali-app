import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseNumber = (value: string | null, name: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(name + " is required.");
  return parsed;
};

export async function GET(request: NextRequest) {
  try {
    const latitude = parseNumber(request.nextUrl.searchParams.get("latitude"), "Latitude");
    const longitude = parseNumber(request.nextUrl.searchParams.get("longitude"), "Longitude");
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
      throw new Error("Track coordinates are outside the valid range.");

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation,weather_code");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set("precipitation_unit", "inch");
    url.searchParams.set("timezone", "auto");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    if (!response.ok) throw new Error("Weather service did not return conditions.");
    const payload = await response.json();
    const current = payload.current;
    if (!current) throw new Error("Weather service returned no current conditions.");

    return NextResponse.json({
      temperatureF: current.temperature_2m,
      humidityPct: current.relative_humidity_2m,
      windSpeedMph: current.wind_speed_10m,
      windDirectionDeg: current.wind_direction_10m,
      windGustMph: current.wind_gusts_10m,
      cloudCoverPct: current.cloud_cover,
      precipitationIn: current.precipitation,
      weatherCode: current.weather_code,
      observedAt: current.time,
      timezone: payload.timezone,
      source: "Open-Meteo",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Weather lookup failed." },
      { status: 400 },
    );
  }
}

