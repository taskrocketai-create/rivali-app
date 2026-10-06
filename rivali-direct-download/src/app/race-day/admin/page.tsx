import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RivaliLogo } from "@/components/rivali-logo";
import { RaceDayAdminClient } from "./race-day-admin-client";

export const dynamic = "force-dynamic";

export default async function RaceDayAdminPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const [tracks, raceDays, passes, approvals] = await Promise.all([
    supabase.from("tracks").select("id,name,start_finish,turns").order("name"),
    supabase.from("race_days").select("id,name,event_date,status,default_price_cents,expires_at,track_id,tracks(id,name)").order("event_date", { ascending: false }).limit(20),
    supabase.from("race_day_passes").select("id,race_day_id,code,status,price_cents,class_name,driver_name,phone,email,claimed_at,created_at,race_days(name,event_date,tracks(name))").order("created_at", { ascending: false }).limit(100),
    supabase.from("sessions").select("id,session_date,session_type,report_status,best_lap_sec,racers(name),race_day_pass_id").eq("report_status", "pending_approval").order("created_at", { ascending: false }).limit(30),
  ]);

  return (
    <div className="app-body">
      <header className="app-header">
        <div className="shell app-header-inner">
          <RivaliLogo compact />
          <nav className="app-nav">
            <Link href="/dashboard">Race shop</Link>
            <Link href="/reports">Reports</Link>
            <Link href="/race-day">Driver view</Link>
          </nav>
        </div>
      </header>
      <main className="shell app-main">
        <RaceDayAdminClient
          userId={userId}
          tracks={tracks.data ?? []}
          initialRaceDays={(raceDays.data ?? []) as never}
          initialPasses={(passes.data ?? []) as never}
          approvals={(approvals.data ?? []) as never}
        />
      </main>
    </div>
  );
}
