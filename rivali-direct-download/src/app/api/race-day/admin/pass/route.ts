import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendTextMessage } from "@/lib/twilio";

const schema = z.object({
  raceDayId: z.string().uuid(),
  className: z.string().min(1).max(120),
  priceCents: z.number().int().min(0).max(1000000),
  phone: z.string().max(40).optional().default(""),
});

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(8), (value) => alphabet[value % alphabet.length]).join("");
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Race Day pass request." }, { status: 400 });

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: day, error: dayError } = await supabase
    .from("race_days")
    .select("id,name,event_date,expires_at,tracks(name)")
    .eq("id", parsed.data.raceDayId)
    .eq("user_id", userId)
    .single();
  if (dayError || !day) return NextResponse.json({ error: "Race Day not found." }, { status: 404 });

  let created = null;
  let insertError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 4 && !created; attempt++) {
    const code = makeCode();
    const result = await supabase
      .from("race_day_passes")
      .insert({
        user_id: userId,
        race_day_id: day.id,
        code,
        status: "paid",
        price_cents: parsed.data.priceCents,
        class_name: parsed.data.className,
        phone: parsed.data.phone || null,
        expires_at: day.expires_at,
      })
      .select("id,race_day_id,code,status,price_cents,class_name,driver_name,phone,email,claimed_at,created_at,race_days(name,event_date,tracks(name))")
      .single();
    created = result.data;
    insertError = result.error;
    if (result.error?.code !== "23505") break;
  }
  if (!created) return NextResponse.json({ error: insertError?.message ?? "Could not create Race Day pass." }, { status: 500 });

  let delivery = { sent: false, reason: "No phone number entered." };
  if (parsed.data.phone) {
    const origin = new URL(request.url).origin;
    delivery = await sendTextMessage(
      parsed.data.phone,
      `Rivali Race Day Pass for ${parsed.data.className}. Open ${origin}/race-day and enter code ${created.code}. Good for today's event only.`,
    );
  }

  return NextResponse.json({ ok: true, pass: created, delivery });
}
