import { NextRequest, NextResponse } from "next/server";

type NominatimPlace = { place_id: number; display_name: string; lat: string; lon: string; type: string };
type PhotonPlace = { properties?: { osm_id?: number; name?: string; city?: string; state?: string; country?: string; type?: string }; geometry?: { coordinates?: [number, number] } };

const curatedTracks = [
  {
    aliases: ["tri county kartway", "tri-county kartway", "tricounty kartway"],
    result: { id: "rivali-tri-county-kartway", label: "Tri-County Kartway, 4157 NC Highway 581, Kenly, NC 27542", latitude: 35.560925, longitude: -78.05143, type: "raceway" },
  },
];

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 3) return NextResponse.json({ results: [] });
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const curated = curatedTracks
    .filter((track) => track.aliases.some((alias) => normalizedQuery.includes(alias.replace(/[^a-z0-9]+/g, " "))))
    .map((track) => track.result);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "us");
  try {
    const response = await fetch(url, { headers: { "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Rivali/1.0 (contact: ahoward@taskrocket.org)" }, cache: "no-store" });
    const places = response.ok ? (await response.json()) as NominatimPlace[] : [];
    if (places.length) return NextResponse.json({ provider: "openstreetmap", results: [...curated, ...places.map((place) => ({ id: `osm-${place.place_id}`, label: place.display_name, latitude: Number(place.lat), longitude: Number(place.lon), type: place.type }))] });

    const photon = new URL("https://photon.komoot.io/api/");
    photon.searchParams.set("q", query);
    photon.searchParams.set("limit", "6");
    photon.searchParams.set("lang", "en");
    const fallback = await fetch(photon, { headers: { "User-Agent": "Rivali/1.0 (contact: ahoward@taskrocket.org)" }, cache: "no-store" });
    if (!fallback.ok) throw new Error("Location providers unavailable");
    const payload = await fallback.json() as { features?: PhotonPlace[] };
    const results = (payload.features ?? []).flatMap((place, index) => {
      const coordinates = place.geometry?.coordinates;
      if (!coordinates) return [];
      const properties = place.properties ?? {};
      const label = [properties.name, properties.city, properties.state, properties.country].filter(Boolean).join(", ");
      return [{ id: `photon-${properties.osm_id ?? index}`, label: label || query, latitude: coordinates[1], longitude: coordinates[0], type: properties.type ?? "place" }];
    });
    return NextResponse.json({ provider: "photon", results: [...curated, ...results] });
  } catch (error) {
    if (curated.length) return NextResponse.json({ provider: "rivali", results: curated });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Track search is temporarily unavailable." }, { status: 502 });
  }
}
