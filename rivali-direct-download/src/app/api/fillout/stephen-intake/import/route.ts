import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processFilloutSubmission } from "../route";

export const runtime = "nodejs";

type FilloutList = { responses?: unknown[] };

export async function POST() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const signedInUserId = claimsData?.claims?.sub;
  const ownerId = process.env.FILLOUT_RIVALI_USER_ID;
  if (!signedInUserId || !ownerId || signedInUserId !== ownerId)
    return NextResponse.json({ error: "Only the Rivali account owner can import the Stephen intake." }, { status: 403 });

  const apiKey = process.env.FILLOUT_API_KEY;
  const formId = process.env.FILLOUT_FORM_ID ?? "6F1XYFGZiius";
  if (!apiKey)
    return NextResponse.json({ error: "Add FILLOUT_API_KEY in Vercel before importing the existing response." }, { status: 503 });

  const response = await fetch(`https://api.fillout.com/v1/api/forms/${encodeURIComponent(formId)}/submissions?limit=1&sort=desc`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
  });
  if (!response.ok)
    return NextResponse.json({ error: "Fillout could not provide the saved response. Check FILLOUT_API_KEY and FILLOUT_FORM_ID.", status: response.status }, { status: 502 });

  const data = await response.json() as FilloutList;
  const latest = data.responses?.[0];
  if (!latest) return NextResponse.json({ error: "No completed responses were found for the Stephen intake form." }, { status: 404 });
  return processFilloutSubmission(latest);
}
