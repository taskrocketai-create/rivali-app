import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Doug's voice service is not configured." }, { status: 503 });

  const safetyId = createHash("sha256").update(`rivali:${userId}`).digest("hex");
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": safetyId,
    },
    body: JSON.stringify({ session: { type: "realtime", model: "gpt-realtime-2.1" } }),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message ?? "Could not start Doug's call.";
    return NextResponse.json({ error: message }, { status: response.status });
  }
  return NextResponse.json({ value: payload.value });
}
