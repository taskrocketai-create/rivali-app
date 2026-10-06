import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendTextMessage } from "@/lib/twilio";

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const approvedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .update({ report_status: "approved", report_approved_at: approvedAt })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .eq("report_status", "pending_approval")
    .select("id,report_status,report_approved_at,race_day_pass_id,racers(name),race_day_passes(phone,class_name)")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "This report is not waiting for approval." }, { status: 409 });

  const racePass = one(data.race_day_passes as unknown as { phone?: string | null; class_name?: string | null } | { phone?: string | null; class_name?: string | null }[]);
  const racer = one(data.racers as unknown as { name?: string | null } | { name?: string | null }[]);
  let delivery = { sent: false, reason: "No driver phone number on this pass." };

  if (racePass?.phone) {
    const origin = new URL(request.url).origin;
    delivery = await sendTextMessage(
      racePass.phone,
      `Your Rivali report for ${racePass.class_name ?? "today's class"} is approved and ready. Open ${origin}/race-day to view it.`,
    );
    if (delivery.sent) {
      await supabase.from("sessions").update({
        report_status: "sent",
        report_sent_at: new Date().toISOString(),
      }).eq("id", sessionId).eq("user_id", userId);
    }
  }

  return NextResponse.json({
    ok: true,
    report: { id: data.id, report_status: delivery.sent ? "sent" : "approved", report_approved_at: approvedAt },
    delivery,
    driverName: racer?.name ?? null,
  });
}
